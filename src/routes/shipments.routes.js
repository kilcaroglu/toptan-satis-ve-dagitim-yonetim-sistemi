
import express from "express";
import pool from "../db.js";
import {
  authMiddleware,
  roleMiddleware
} from "../authMiddleware.js";

const router = express.Router();

// Sevkiyat oluştur
router.post(
  "/",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    try {
      const {
        route_id,
        shipment_date,
        vehicle_plate,
        driver_name,
        distributor_name
      } = req.body;

      const result = await pool.query(
        `INSERT INTO shipments (
          route_id, shipment_date, vehicle_plate,
          driver_name, distributor_name
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *`,
        [
          route_id,
          shipment_date,
          vehicle_plate,
          driver_name,
          distributor_name
        ]
      );

      return res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        message: "Sevkiyat oluşturulamadı"
      });
    }
  }
);

// Sevkiyata dağıtımcı ata
router.post(
  "/:id/distributors",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    let client;
    let transactionStarted = false;

    try {
      const shipmentId = Number(req.params.id);
      const { driver_ids } = req.body;

      if (!Number.isInteger(shipmentId) || shipmentId <= 0) {
        return res.status(400).json({
          message: "Geçersiz sevkiyat numarası"
        });
      }

      if (
        !Array.isArray(driver_ids) ||
        driver_ids.length === 0 ||
        !driver_ids.every(
          id => Number.isInteger(id) && id > 0
        )
      ) {
        return res.status(400).json({
          message: "En az bir geçerli dağıtımcı ID'si gönderilmelidir"
        });
      }

      const uniqueDriverIds = [...new Set(driver_ids)];

      client = await pool.connect();
      await client.query("BEGIN");
      transactionStarted = true;

      const shipment = await client.query(
        "SELECT id FROM shipments WHERE id = $1 FOR UPDATE",
        [shipmentId]
      );

      if (shipment.rows.length === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(404).json({
          message: "Sevkiyat bulunamadı"
        });
      }

      const drivers = await client.query(
        `SELECT id
         FROM users
         WHERE id = ANY($1::int[])
           AND role = 'DRIVER'
           AND active = true`,
        [uniqueDriverIds]
      );

      if (drivers.rows.length !== uniqueDriverIds.length) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(400).json({
          message: "Dağıtımcı ID'lerinden biri geçersiz, pasif veya DRIVER rolünde değil"
        });
      }

      for (const driverId of uniqueDriverIds) {
        await client.query(
          `INSERT INTO shipment_drivers
            (shipment_id, user_id, assigned_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (shipment_id, user_id)
           DO NOTHING`,
          [shipmentId, driverId, req.user.id]
        );
      }

      const assignments = await client.query(
        `SELECT
           u.id, u.name, u.email,
           sd.assigned_at, sd.assigned_by
         FROM shipment_drivers sd
         JOIN users u ON u.id = sd.user_id
         WHERE sd.shipment_id = $1
         ORDER BY u.name`,
        [shipmentId]
      );

      await client.query("COMMIT");
      transactionStarted = false;

      return res.status(200).json({
        message: "Dağıtımcı atamaları kaydedildi",
        shipment_id: shipmentId,
        distributors: assignments.rows
      });
    } catch (error) {
      if (client && transactionStarted) {
        await client.query("ROLLBACK").catch(console.error);
      }

      console.error(error);
      return res.status(500).json({
        message: "Dağıtımcı ataması yapılamadı"
      });
    } finally {
      client?.release();
    }
  }
);

// Sevkiyatları listele
router.get("/", authMiddleware, async (req, res) => {
  try {
    let result;

    if (req.user.role === "ADMIN") {
      result = await pool.query(
        `SELECT s.*, r.name AS route_name
         FROM shipments s
         INNER JOIN routes r ON s.route_id = r.id
         ORDER BY s.shipment_date, s.id`
      );
    } else if (req.user.role === "DRIVER") {
      result = await pool.query(
        `SELECT s.*, r.name AS route_name
         FROM shipments s
         INNER JOIN routes r ON s.route_id = r.id
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
    console.error(error);
    return res.status(500).json({
      message: "Sevkiyatlar alınamadı"
    });
  }
});

// Sevkiyatı güncelle
router.put(
  "/:id",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const {
        route_id,
        shipment_date,
        vehicle_plate,
        driver_name,
        distributor_name
      } = req.body;

      const result = await pool.query(
        `UPDATE shipments
         SET route_id = $1,
             shipment_date = $2,
             vehicle_plate = $3,
             driver_name = $4,
             distributor_name = $5
         WHERE id = $6
         RETURNING *`,
        [
          route_id,
          shipment_date,
          vehicle_plate,
          driver_name,
          distributor_name,
          id
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          message: "Sevkiyat bulunamadı"
        });
      }

      return res.json(result.rows[0]);
    } catch (error) {
      console.error(error);
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
      const { id } = req.params;
      const { status } = req.body;

      const allowedStatuses = [
        "PLANNED",
        "PREPARING",
        "ON_THE_WAY",
        "DELIVERED",
        "CANCELLED"
      ];

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          message: "Geçersiz sevkiyat durumu"
        });
      }

      const result = await pool.query(
        `UPDATE shipments
         SET status = $1
         WHERE id = $2
         RETURNING *`,
        [status, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          message: "Sevkiyat bulunamadı"
        });
      }

      return res.json(result.rows[0]);
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        message: "Sevkiyat durumu güncellenemedi"
      });
    }
  }
);

export default router;
