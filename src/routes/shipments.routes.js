
import express from "express";
import pool from "../db.js";
import {
  authMiddleware,
  roleMiddleware
} from "../authMiddleware.js";

const router = express.Router();

// Haftalık sevkiyatları oluştur.
// Bugün dahil önümüzdeki 7 günün aktif rota takvimlerini kontrol eder.
router.post(
  "/generate-week",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `WITH dates AS (
           SELECT
             (
               (now() AT TIME ZONE 'Europe/Istanbul')::date
               + day_offset
             )::date AS shipment_date
           FROM generate_series(0, 6) AS day_offset
         )
         INSERT INTO shipments (
           route_id,
           route_schedule_id,
           shipment_date,
           status
         )
         SELECT
           rs.route_id,
           rs.id,
           dates.shipment_date,
           'PLANNED'
         FROM route_schedules rs
         CROSS JOIN dates
         INNER JOIN routes r
           ON r.id = rs.route_id
         WHERE rs.active = TRUE
           AND r.active = TRUE
           AND rs.delivery_day =
               EXTRACT(ISODOW FROM dates.shipment_date)::int
         ON CONFLICT DO NOTHING
         RETURNING *`
      );

      return res.json({
        message: "Haftalık sevkiyat planı oluşturuldu",
        created_count: result.rows.length,
        shipments: result.rows
      });
    } catch (error) {
      console.error("Haftalık sevkiyat oluşturma hatası:", error);

      return res.status(500).json({
        message: "Haftalık sevkiyatlar oluşturulamadı"
      });
    }
  }
);

// Manuel sevkiyat oluştur
router.post(
  "/",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    try {
      const {
        route_id,
        shipment_date,
        vehicle_id,
        vehicle_plate,
        driver_name,
        distributor_name
      } = req.body;

      const routeId = Number(route_id);

      if (
        !Number.isInteger(routeId) ||
        routeId <= 0 ||
        !shipment_date
      ) {
        return res.status(400).json({
          message: "Geçerli rota ve sevkiyat tarihi gereklidir"
        });
      }

      const schedule = await pool.query(
        `SELECT rs.id
         FROM route_schedules rs
         INNER JOIN routes r ON r.id = rs.route_id
         WHERE rs.route_id = $1
           AND rs.delivery_day =
               EXTRACT(ISODOW FROM $2::date)::int
           AND rs.active = TRUE
           AND r.active = TRUE`,
        [routeId, shipment_date]
      );

      if (schedule.rows.length === 0) {
        return res.status(400).json({
          message: "Bu rota seçilen tarihte teslimat yapmıyor"
        });
      }

      let selectedVehicle = null;

      if (vehicle_id !== undefined && vehicle_id !== null) {
        const vehicleId = Number(vehicle_id);

        if (!Number.isInteger(vehicleId) || vehicleId <= 0) {
          return res.status(400).json({
            message: "Geçerli bir araç ID'si gönderilmelidir"
          });
        }

        const vehicle = await pool.query(
          `SELECT id, plate
           FROM vehicles
           WHERE id = $1
             AND active = TRUE`,
          [vehicleId]
        );

        if (vehicle.rows.length === 0) {
          return res.status(400).json({
            message: "Araç bulunamadı veya pasif durumda"
          });
        }

        selectedVehicle = vehicle.rows[0];
      }

      const result = await pool.query(
        `INSERT INTO shipments (
           route_id,
           route_schedule_id,
           shipment_date,
           vehicle_id,
           vehicle_plate,
           driver_name,
           distributor_name
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          routeId,
          schedule.rows[0].id,
          shipment_date,
          selectedVehicle?.id || null,
          selectedVehicle?.plate || vehicle_plate || null,
          driver_name || null,
          distributor_name || null
        ]
      );

      return res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error("Sevkiyat oluşturma hatası:", error);

      if (error.code === "23505") {
        return res.status(409).json({
          message: "Bu rota ve tarih için sevkiyat veya araç ataması zaten mevcut"
        });
      }

      return res.status(500).json({
        message: "Sevkiyat oluşturulamadı"
      });
    }
  }
);

// Sevkiyata personel ata.
// DRIVER ve DISTRIBUTOR rollerindeki aktif kullanıcılar kabul edilir.
const assignPersonnel = async (req, res) => {
  let client;
  let transactionStarted = false;

  try {
    const shipmentId = Number(req.params.id);

    const personnelIds =
      req.body.personnel_ids ?? req.body.driver_ids;

    if (!Number.isInteger(shipmentId) || shipmentId <= 0) {
      return res.status(400).json({
        message: "Geçersiz sevkiyat numarası"
      });
    }

    if (
      !Array.isArray(personnelIds) ||
      personnelIds.length === 0 ||
      !personnelIds.every(
        id => Number.isInteger(id) && id > 0
      )
    ) {
      return res.status(400).json({
        message: "En az bir geçerli personel ID'si gönderilmelidir"
      });
    }

    const uniqueIds = [...new Set(personnelIds)];

    client = await pool.connect();

    await client.query("BEGIN");
    transactionStarted = true;

    const shipment = await client.query(
      `SELECT id
       FROM shipments
       WHERE id = $1
       FOR UPDATE`,
      [shipmentId]
    );

    if (shipment.rows.length === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(404).json({
        message: "Sevkiyat bulunamadı"
      });
    }

    const personnel = await client.query(
      `SELECT id, name, email, role
       FROM users
       WHERE id = ANY($1::int[])
         AND role IN ('DRIVER', 'DISTRIBUTOR')
         AND active = TRUE`,
      [uniqueIds]
    );

    if (personnel.rows.length !== uniqueIds.length) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(400).json({
        message: "Personellerden biri geçersiz, pasif veya uygun rolde değil"
      });
    }

    for (const personId of uniqueIds) {
      await client.query(
        `INSERT INTO shipment_drivers (
           shipment_id,
           user_id,
           assigned_by
         )
         VALUES ($1, $2, $3)
         ON CONFLICT (shipment_id, user_id)
         DO NOTHING`,
        [shipmentId, personId, req.user.id]
      );
    }

    const assignments = await client.query(
      `SELECT
         u.id,
         u.name,
         u.email,
         u.role,
         sd.assigned_at,
         sd.assigned_by
       FROM shipment_drivers sd
       INNER JOIN users u ON u.id = sd.user_id
       WHERE sd.shipment_id = $1
       ORDER BY u.name`,
      [shipmentId]
    );

    await client.query("COMMIT");
    transactionStarted = false;

    return res.json({
      message: "Personel atamaları kaydedildi",
      shipment_id: shipmentId,
      personnel: assignments.rows
    });
  } catch (error) {
    if (client && transactionStarted) {
      await client.query("ROLLBACK").catch(console.error);
    }

    console.error("Personel atama hatası:", error);

    return res.status(500).json({
      message: "Personel ataması yapılamadı"
    });
  } finally {
    client?.release();
  }
};

// Personel ekle
router.post(
  "/:id/personnel",
  authMiddleware,
  roleMiddleware("ADMIN"),
  assignPersonnel
);

// Eski endpoint'i geriye dönük uyumluluk için koru.
router.post(
  "/:id/distributors",
  authMiddleware,
  roleMiddleware("ADMIN"),
  assignPersonnel
);

// Sevkiyatın personel listesini tamamen değiştir.
router.put(
  "/:id/personnel",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    let client;
    let transactionStarted = false;

    try {
      const shipmentId = Number(req.params.id);
      const personnelIds =
        req.body.personnel_ids ?? req.body.driver_ids;

      if (!Number.isInteger(shipmentId) || shipmentId <= 0) {
        return res.status(400).json({
          message: "Geçersiz sevkiyat numarası"
        });
      }

      if (
        !Array.isArray(personnelIds) ||
        personnelIds.length === 0 ||
        !personnelIds.every(
          id => Number.isInteger(id) && id > 0
        )
      ) {
        return res.status(400).json({
          message: "En az bir geçerli personel seçmelisiniz"
        });
      }

      const uniqueIds = [...new Set(personnelIds)];

      client = await pool.connect();

      await client.query("BEGIN");
      transactionStarted = true;

      const shipment = await client.query(
        `SELECT id
         FROM shipments
         WHERE id = $1
         FOR UPDATE`,
        [shipmentId]
      );

      if (shipment.rows.length === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(404).json({
          message: "Sevkiyat bulunamadı"
        });
      }

      const personnel = await client.query(
        `SELECT id
         FROM users
         WHERE id = ANY($1::int[])
           AND role IN ('DRIVER', 'DISTRIBUTOR')
           AND active = TRUE`,
        [uniqueIds]
      );

      if (personnel.rows.length !== uniqueIds.length) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(400).json({
          message: "Personellerden biri geçersiz, pasif veya uygun rolde değil"
        });
      }

      await client.query(
        `DELETE FROM shipment_drivers
         WHERE shipment_id = $1`,
        [shipmentId]
      );

      for (const personId of uniqueIds) {
        await client.query(
          `INSERT INTO shipment_drivers (
             shipment_id,
             user_id,
             assigned_by
           )
           VALUES ($1, $2, $3)`,
          [shipmentId, personId, req.user.id]
        );
      }

      const assignments = await client.query(
        `SELECT
           u.id,
           u.name,
           u.email,
           u.role,
           sd.assigned_at,
           sd.assigned_by
         FROM shipment_drivers sd
         INNER JOIN users u ON u.id = sd.user_id
         WHERE sd.shipment_id = $1
         ORDER BY u.name`,
        [shipmentId]
      );

      await client.query("COMMIT");
      transactionStarted = false;

      return res.json({
        message: "Sevkiyat personel listesi güncellendi",
        shipment_id: shipmentId,
        personnel: assignments.rows
      });
    } catch (error) {
      if (client && transactionStarted) {
        await client.query("ROLLBACK").catch(console.error);
      }

      console.error("Personel güncelleme hatası:", error);

      return res.status(500).json({
        message: "Personel listesi güncellenemedi"
      });
    } finally {
      client?.release();
    }
  }
);

// Sevkiyata araç ata veya araç atamasını kaldır.
router.patch(
  "/:id/vehicle",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    try {
      const shipmentId = Number(req.params.id);
      const { vehicle_id } = req.body;

      if (!Number.isInteger(shipmentId) || shipmentId <= 0) {
        return res.status(400).json({
          message: "Geçersiz sevkiyat numarası"
        });
      }

      if (
        vehicle_id !== null &&
        vehicle_id !== undefined &&
        (
          !Number.isInteger(Number(vehicle_id)) ||
          Number(vehicle_id) <= 0
        )
      ) {
        return res.status(400).json({
          message: "Geçerli bir araç ID'si gönderilmelidir"
        });
      }

      const shipment = await pool.query(
        `SELECT id
         FROM shipments
         WHERE id = $1`,
        [shipmentId]
      );

      if (shipment.rows.length === 0) {
        return res.status(404).json({
          message: "Sevkiyat bulunamadı"
        });
      }

      let vehicle = null;

      if (vehicle_id !== null && vehicle_id !== undefined) {
        const vehicleResult = await pool.query(
          `SELECT id, plate
           FROM vehicles
           WHERE id = $1
             AND active = TRUE`,
          [Number(vehicle_id)]
        );

        if (vehicleResult.rows.length === 0) {
          return res.status(400).json({
            message: "Araç bulunamadı veya pasif durumda"
          });
        }

        vehicle = vehicleResult.rows[0];
      }

      const result = await pool.query(
        `UPDATE shipments
         SET vehicle_id = $1,
             vehicle_plate = $2
         WHERE id = $3
         RETURNING *`,
        [
          vehicle?.id || null,
          vehicle?.plate || null,
          shipmentId
        ]
      );

      return res.json({
        message: vehicle
          ? "Araç sevkiyata atandı"
          : "Sevkiyatın araç ataması kaldırıldı",
        shipment: result.rows[0]
      });
    } catch (error) {
      console.error("Araç atama hatası:", error);

      if (error.code === "23505") {
        return res.status(409).json({
          message: "Bu araç aynı tarihte başka bir sevkiyata atanmış"
        });
      }

      return res.status(500).json({
        message: "Araç ataması yapılamadı"
      });
    }
  }
);

// Sevkiyatları listele
router.get(
  "/",
  authMiddleware,
  async (req, res) => {
    try {
      let result;

      if (req.user.role === "ADMIN") {
        result = await pool.query(
          `SELECT
             s.*,
             r.name AS route_name,
             v.plate AS assigned_vehicle_plate,
             v.brand AS assigned_vehicle_brand,
             v.model AS assigned_vehicle_model,
             COALESCE(
               (
                 SELECT json_agg(
                   json_build_object(
                     'id', u.id,
                     'name', u.name,
                     'email', u.email,
                     'role', u.role
                   )
                   ORDER BY u.name
                 )
                 FROM shipment_drivers sd
                 INNER JOIN users u ON u.id = sd.user_id
                 WHERE sd.shipment_id = s.id
               ),
               '[]'::json
             ) AS personnel
           FROM shipments s
           INNER JOIN routes r
             ON s.route_id = r.id
           LEFT JOIN vehicles v
             ON v.id = s.vehicle_id
           ORDER BY s.shipment_date, s.id`
        );
      } else if (
        ["DRIVER", "DISTRIBUTOR"].includes(req.user.role)
      ) {
        result = await pool.query(
          `SELECT
             s.*,
             r.name AS route_name,
             v.plate AS assigned_vehicle_plate,
             v.brand AS assigned_vehicle_brand,
             v.model AS assigned_vehicle_model
           FROM shipments s
           INNER JOIN routes r
             ON s.route_id = r.id
           LEFT JOIN vehicles v
             ON v.id = s.vehicle_id
           INNER JOIN shipment_drivers sd
             ON sd.shipment_id = s.id
           WHERE sd.user_id = $1
           ORDER BY s.shipment_date, s.id`,
          [req.user.id]
        );
      } else {
        return res.status(403).json({
          message: "Sevkiyat listesini görme yetkiniz yok"
        });
      }

      return res.json(result.rows);
    } catch (error) {
      console.error("Sevkiyat listeleme hatası:", error);

      return res.status(500).json({
        message: "Sevkiyatlar alınamadı"
      });
    }
  }
);

// Sevkiyatı güncelle
router.put(
  "/:id",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    try {
      const shipmentId = Number(req.params.id);

      const {
        route_id,
        shipment_date,
        vehicle_id,
        vehicle_plate,
        driver_name,
        distributor_name
      } = req.body;

      if (
        !Number.isInteger(shipmentId) ||
        shipmentId <= 0 ||
        !Number.isInteger(Number(route_id)) ||
        Number(route_id) <= 0 ||
        !shipment_date
      ) {
        return res.status(400).json({
          message: "Sevkiyat bilgileri geçersiz"
        });
      }

      const schedule = await pool.query(
        `SELECT rs.id
         FROM route_schedules rs
         INNER JOIN routes r
           ON r.id = rs.route_id
         WHERE rs.route_id = $1
           AND rs.delivery_day =
               EXTRACT(ISODOW FROM $2::date)::int
           AND rs.active = TRUE
           AND r.active = TRUE`,
        [Number(route_id), shipment_date]
      );

      if (schedule.rows.length === 0) {
        return res.status(400).json({
          message: "Seçilen rota bu tarihte teslimat yapmıyor"
        });
      }

      let selectedVehicle = null;

      if (vehicle_id !== undefined && vehicle_id !== null) {
        const vehicleResult = await pool.query(
          `SELECT id, plate
           FROM vehicles
           WHERE id = $1
             AND active = TRUE`,
          [Number(vehicle_id)]
        );

        if (vehicleResult.rows.length === 0) {
          return res.status(400).json({
            message: "Araç bulunamadı veya pasif durumda"
          });
        }

        selectedVehicle = vehicleResult.rows[0];
      }

      const result = await pool.query(
        `UPDATE shipments
         SET route_id = $1,
             route_schedule_id = $2,
             shipment_date = $3,
             vehicle_id = $4,
             vehicle_plate = $5,
             driver_name = $6,
             distributor_name = $7
         WHERE id = $8
         RETURNING *`,
        [
          Number(route_id),
          schedule.rows[0].id,
          shipment_date,
          selectedVehicle?.id || null,
          selectedVehicle?.plate || vehicle_plate || null,
          driver_name || null,
          distributor_name || null,
          shipmentId
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          message: "Sevkiyat bulunamadı"
        });
      }

      return res.json({
        message: "Sevkiyat güncellendi",
        shipment: result.rows[0]
      });
    } catch (error) {
      console.error("Sevkiyat güncelleme hatası:", error);

      if (error.code === "23505") {
        return res.status(409).json({
          message: "Bu rota veya araç için aynı tarihte başka bir sevkiyat mevcut"
        });
      }

      return res.status(500).json({
        message: "Sevkiyat güncellenemedi"
      });
    }
  }
);

// Sevkiyat durumunu güncelle
router.patch(
  "/:id/status",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    try {
      const shipmentId = Number(req.params.id);
      const { status } = req.body;

      const allowedStatuses = [
        "PLANNED",
        "PREPARING",
        "ON_THE_WAY",
        "DELIVERED",
        "CANCELLED"
      ];

      if (
        !Number.isInteger(shipmentId) ||
        shipmentId <= 0 ||
        !allowedStatuses.includes(status)
      ) {
        return res.status(400).json({
          message: "Sevkiyat numarası veya durumu geçersiz"
        });
      }

      const result = await pool.query(
        `UPDATE shipments
         SET status = $1
         WHERE id = $2
         RETURNING *`,
        [status, shipmentId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          message: "Sevkiyat bulunamadı"
        });
      }

      return res.json({
        message: "Sevkiyat durumu güncellendi",
        shipment: result.rows[0]
      });
    } catch (error) {
      console.error("Sevkiyat durumu güncelleme hatası:", error);

      return res.status(500).json({
        message: "Sevkiyat durumu güncellenemedi"
      });
    }
  }
);

export default router;