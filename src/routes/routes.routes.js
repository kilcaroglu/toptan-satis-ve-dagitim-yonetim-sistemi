import express from "express";
import pool from "../db.js";
import {
  authMiddleware,
  roleMiddleware
} from "../authMiddleware.js";

const router = express.Router();

const WEEK_DAYS = [1, 2, 3, 4, 5, 6, 7];

// Haftalık program bilgilerini kontrol eder.
function validateSchedules(schedules) {
  if (!Array.isArray(schedules) || schedules.length === 0) {
    return "En az bir sevkiyat günü tanımlanmalıdır.";
  }

  const usedDays = new Set();

  for (const schedule of schedules) {
    const deliveryDay = Number(schedule.delivery_day);
    const deadlineDay = Number(schedule.order_deadline_day);
    const deadlineTime = schedule.order_deadline_time;

    if (
      !WEEK_DAYS.includes(deliveryDay) ||
      !WEEK_DAYS.includes(deadlineDay)
    ) {
      return "Sevkiyat ve sipariş son günleri 1-7 arasında olmalıdır.";
    }

    if (
      typeof deadlineTime !== "string" ||
      !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(deadlineTime)
    ) {
      return "Geçerli bir sipariş son saati girilmelidir.";
    }

    if (usedDays.has(deliveryDay)) {
      return "Aynı rotada aynı sevkiyat günü birden fazla kez tanımlanamaz.";
    }

    usedDays.add(deliveryDay);
  }

  return null;
}

// Rota oluştur
router.post(
  "/",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    let client;
    let transactionStarted = false;

    try {
      const { name, schedules } = req.body;

      if (typeof name !== "string" || !name.trim()) {
        return res.status(400).json({
          message: "Rota adı zorunludur."
        });
      }

      const validationError = validateSchedules(schedules);

      if (validationError) {
        return res.status(400).json({
          message: validationError
        });
      }

      const normalizedSchedules = schedules.map(schedule => ({
        delivery_day: Number(schedule.delivery_day),
        order_deadline_day: Number(schedule.order_deadline_day),
        order_deadline_time: schedule.order_deadline_time
      }));

      // Eski routes sütunlarını uyum için ilk programla dolduruyoruz.
      const firstSchedule = normalizedSchedules[0];

      client = await pool.connect();
      await client.query("BEGIN");
      transactionStarted = true;

      const routeResult = await client.query(
        `INSERT INTO routes (
          name,
          delivery_day,
          order_deadline_day,
          order_deadline_time
        )
        VALUES ($1, $2, $3, $4)
        RETURNING *`,
        [
          name.trim(),
          firstSchedule.delivery_day,
          firstSchedule.order_deadline_day,
          firstSchedule.order_deadline_time
        ]
      );

      const route = routeResult.rows[0];

      for (const schedule of normalizedSchedules) {
        await client.query(
          `INSERT INTO route_schedules (
            route_id,
            delivery_day,
            order_deadline_day,
            order_deadline_time
          )
          VALUES ($1, $2, $3, $4)`,
          [
            route.id,
            schedule.delivery_day,
            schedule.order_deadline_day,
            schedule.order_deadline_time
          ]
        );
      }

      await client.query("COMMIT");
      transactionStarted = false;

      return res.status(201).json({
        message: "Rota oluşturuldu.",
        route: {
          ...route,
          schedules: normalizedSchedules
        }
      });
    } catch (error) {
      if (client && transactionStarted) {
        await client.query("ROLLBACK").catch(console.error);
      }

      console.error(error);

      return res.status(500).json({
        message: "Rota oluşturulamadı."
      });
    } finally {
      client?.release();
    }
  }
);

// Rotaları ve bağlı ilçeleri, haftalık programlarıyla listele
router.get("/", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         r.id,
         r.name,
         r.active,
         r.created_at,

         COALESCE(
           (
             SELECT json_agg(
               json_build_object(
                 'id', d.id,
                 'name', d.name
               )
               ORDER BY d.name
             )
             FROM route_districts rd
             JOIN districts d ON d.id = rd.district_id
             WHERE rd.route_id = r.id
           ),
           '[]'::json
         ) AS districts,

         COALESCE(
           (
             SELECT json_agg(
               json_build_object(
                 'id', rs.id,
                 'delivery_day', rs.delivery_day,
                 'order_deadline_day', rs.order_deadline_day,
                 'order_deadline_time', rs.order_deadline_time,
                 'active', rs.active
               )
               ORDER BY rs.delivery_day
             )
             FROM route_schedules rs
             WHERE rs.route_id = r.id
           ),
           '[]'::json
         ) AS schedules

       FROM routes r
       ORDER BY r.id`
    );

    return res.json(result.rows);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Rotalar alınamadı."
    });
  }
});

// Rota adını ve aktiflik durumunu güncelle
router.put(
  "/:id",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    try {
      const routeId = Number(req.params.id);
      const { name, active } = req.body;

      if (!Number.isInteger(routeId) || routeId <= 0) {
        return res.status(400).json({
          message: "Geçersiz rota numarası."
        });
      }

      if (
        typeof name !== "string" ||
        !name.trim() ||
        typeof active !== "boolean"
      ) {
        return res.status(400).json({
          message: "Rota adı ve aktiflik durumu gereklidir."
        });
      }

      const result = await pool.query(
        `UPDATE routes
         SET name = $1,
             active = $2
         WHERE id = $3
         RETURNING *`,
        [name.trim(), active, routeId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          message: "Rota bulunamadı."
        });
      }

      return res.json({
        message: "Rota güncellendi.",
        route: result.rows[0]
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        message: "Rota güncellenemedi."
      });
    }
  }
);

// Rotanın haftalık sevkiyat günlerini topluca güncelle
router.put(
  "/:id/schedules",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    let client;
    let transactionStarted = false;

    try {
      const routeId = Number(req.params.id);
      const { schedules } = req.body;

      if (!Number.isInteger(routeId) || routeId <= 0) {
        return res.status(400).json({
          message: "Geçersiz rota numarası."
        });
      }

      const validationError = validateSchedules(schedules);

      if (validationError) {
        return res.status(400).json({
          message: validationError
        });
      }

      const normalizedSchedules = schedules.map(schedule => ({
        delivery_day: Number(schedule.delivery_day),
        order_deadline_day: Number(schedule.order_deadline_day),
        order_deadline_time: schedule.order_deadline_time
      }));

      const firstSchedule = normalizedSchedules[0];

      client = await pool.connect();
      await client.query("BEGIN");
      transactionStarted = true;

      const routeResult = await client.query(
        "SELECT id FROM routes WHERE id = $1 FOR UPDATE",
        [routeId]
      );

      if (routeResult.rows.length === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(404).json({
          message: "Rota bulunamadı."
        });
      }

      await client.query(
        "DELETE FROM route_schedules WHERE route_id = $1",
        [routeId]
      );

      for (const schedule of normalizedSchedules) {
        await client.query(
          `INSERT INTO route_schedules (
            route_id,
            delivery_day,
            order_deadline_day,
            order_deadline_time
          )
          VALUES ($1, $2, $3, $4)`,
          [
            routeId,
            schedule.delivery_day,
            schedule.order_deadline_day,
            schedule.order_deadline_time
          ]
        );
      }

      // Eski sipariş kodlarıyla geçici uyumluluk.
      await client.query(
        `UPDATE routes
         SET delivery_day = $1,
             order_deadline_day = $2,
             order_deadline_time = $3
         WHERE id = $4`,
        [
          firstSchedule.delivery_day,
          firstSchedule.order_deadline_day,
          firstSchedule.order_deadline_time,
          routeId
        ]
      );

      await client.query("COMMIT");
      transactionStarted = false;

      return res.json({
        message: "Rotanın haftalık sevkiyat günleri güncellendi.",
        schedules: normalizedSchedules
      });
    } catch (error) {
      if (client && transactionStarted) {
        await client.query("ROLLBACK").catch(console.error);
      }

      console.error(error);

      return res.status(500).json({
        message: "Rota programı güncellenemedi."
      });
    } finally {
      client?.release();
    }
  }
);

// Rotaya tek bir ilçe ekle
router.post(
  "/:id/districts",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    try {
      const routeId = Number(req.params.id);
      const districtId = Number(req.body.district_id);

      if (
        !Number.isInteger(routeId) || routeId <= 0 ||
        !Number.isInteger(districtId) || districtId <= 0
      ) {
        return res.status(400).json({
          message: "Geçerli rota ve ilçe ID'si girin."
        });
      }

      const routeResult = await pool.query(
        "SELECT id FROM routes WHERE id = $1",
        [routeId]
      );

      if (routeResult.rows.length === 0) {
        return res.status(404).json({
          message: "Rota bulunamadı."
        });
      }

      const districtResult = await pool.query(
        `SELECT id, name, active, delivery_available
         FROM districts
         WHERE id = $1`,
        [districtId]
      );

      if (districtResult.rows.length === 0) {
        return res.status(404).json({
          message: "İlçe bulunamadı."
        });
      }

      const district = districtResult.rows[0];

      if (!district.active || !district.delivery_available) {
        return res.status(400).json({
          message: "Pasif veya sevkiyat hizmeti kapalı ilçeler rotaya eklenemez."
        });
      }

      const result = await pool.query(
        `INSERT INTO route_districts (route_id, district_id)
         VALUES ($1, $2)
         RETURNING *`,
        [routeId, districtId]
      );

      return res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error(error);

      if (error.code === "23505") {
        return res.status(409).json({
          message: "Bu ilçe başka bir rotaya bağlı veya bu rotaya zaten eklenmiş."
        });
      }

      return res.status(500).json({
        message: "İlçe rotaya eklenemedi."
      });
    }
  }
);

// Rotanın ilçe listesini topluca güncelle
router.put(
  "/:id/districts",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    let client;
    let transactionStarted = false;

    try {
      const routeId = Number(req.params.id);
      const { district_ids } = req.body;

      if (
        !Number.isInteger(routeId) || routeId <= 0 ||
        !Array.isArray(district_ids) ||
        district_ids.some(
          id => !Number.isInteger(Number(id)) || Number(id) <= 0
        )
      ) {
        return res.status(400).json({
          message: "Geçerli rota ID'si ve ilçe ID'leri listesi gönderin."
        });
      }

      const districtIds = district_ids.map(Number);

      if (new Set(districtIds).size !== districtIds.length) {
        return res.status(400).json({
          message: "Aynı ilçe birden fazla kez eklenemez."
        });
      }

      client = await pool.connect();
      await client.query("BEGIN");
      transactionStarted = true;

      const routeResult = await client.query(
        "SELECT id FROM routes WHERE id = $1 FOR UPDATE",
        [routeId]
      );

      if (routeResult.rows.length === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(404).json({
          message: "Rota bulunamadı."
        });
      }

      if (districtIds.length > 0) {
        const districtResult = await client.query(
          `SELECT id, name, active, delivery_available
           FROM districts
           WHERE id = ANY($1::int[])`,
          [districtIds]
        );

        if (districtResult.rows.length !== districtIds.length) {
          await client.query("ROLLBACK");
          transactionStarted = false;

          return res.status(400).json({
            message: "Listede geçersiz bir ilçe ID'si var."
          });
        }

        const unavailableDistricts = districtResult.rows.filter(
          district => !district.active || !district.delivery_available
        );

        if (unavailableDistricts.length > 0) {
          await client.query("ROLLBACK");
          transactionStarted = false;

          return res.status(400).json({
            message: "Pasif veya sevkiyat yapılmayan ilçeler rotaya eklenemez.",
            districts: unavailableDistricts.map(district => ({
              id: district.id,
              name: district.name,
              active: district.active,
              delivery_available: district.delivery_available
            }))
          });
        }
      }

      await client.query(
        "DELETE FROM route_districts WHERE route_id = $1",
        [routeId]
      );

      for (const districtId of districtIds) {
        await client.query(
          `INSERT INTO route_districts (route_id, district_id)
           VALUES ($1, $2)`,
          [routeId, districtId]
        );
      }

      await client.query("COMMIT");
      transactionStarted = false;

      return res.json({
        message: "Rota ilçeleri güncellendi.",
        district_ids: districtIds
      });
    } catch (error) {
      if (client && transactionStarted) {
        await client.query("ROLLBACK").catch(console.error);
      }

      console.error(error);

      if (error.code === "23505") {
        return res.status(409).json({
          message: "İlçelerden biri başka bir rotaya zaten bağlı."
        });
      }

      return res.status(500).json({
        message: "Rota ilçeleri güncellenemedi."
      });
    } finally {
      client?.release();
    }
  }
);

export default router;