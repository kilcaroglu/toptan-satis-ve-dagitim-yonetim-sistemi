
import express from "express";
import pool from "../db.js";
import {
  authMiddleware,
  roleMiddleware
} from "../authMiddleware.js";

const router = express.Router();

// Rota oluştur
router.post(
  "/",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    try {
      const {
        name,
        delivery_day,
        order_deadline_day,
        order_deadline_time
      } = req.body;

      if (
        typeof name !== "string" || !name.trim() ||
        !delivery_day ||
        !order_deadline_day ||
        !order_deadline_time
      ) {
        return res.status(400).json({
          message: "Rota bilgilerini eksiksiz girin."
        });
      }

      const result = await pool.query(
        `INSERT INTO routes (
          name, delivery_day, order_deadline_day, order_deadline_time
        )
        VALUES ($1, $2, $3, $4)
        RETURNING *`,
        [
          name.trim(),
          delivery_day,
          order_deadline_day,
          order_deadline_time
        ]
      );

      return res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        message: "Rota oluşturulamadı"
      });
    }
  }
);

// Rotaya ilçe ekle
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
         FROM districts WHERE id = $1`,
        [districtId]
      );

      if (districtResult.rows.length === 0) {
        return res.status(404).json({
          message: "İlçe bulunamadı."
        });
      }

      const district = districtResult.rows[0];

      if (!district.active) {
        return res.status(400).json({
          message: "Pasif ilçeler rotaya eklenemez."
        });
      }

      if (!district.delivery_available) {
        return res.status(400).json({
          message: "Bu ilçede sevkiyat hizmeti aktif değil."
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
          message: "Bu ilçe zaten rotaya eklenmiş."
        });
      }

      return res.status(500).json({
        message: "İlçe rotaya eklenemedi."
      });
    }
  }
);

// Rotaları ve bağlı ilçeleri listele
router.get("/", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         routes.id,
         routes.name,
         routes.delivery_day,
         routes.order_deadline_day,
         routes.order_deadline_time,
         routes.active,
         routes.created_at,
         COALESCE(
           json_agg(
             json_build_object(
               'id', districts.id,
               'name', districts.name
             )
           ) FILTER (WHERE districts.id IS NOT NULL),
           '[]'
         ) AS districts
       FROM routes
       LEFT JOIN route_districts
         ON routes.id = route_districts.route_id
       LEFT JOIN districts
         ON route_districts.district_id = districts.id
       GROUP BY routes.id
       ORDER BY routes.id`
    );

    return res.json(result.rows);
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Rotalar alınamadı"
    });
  }
});

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
      return res.status(500).json({
        message: "Rota ilçeleri güncellenemedi."
      });
    } finally {
      client?.release();
    }
  }
);

export default router;
