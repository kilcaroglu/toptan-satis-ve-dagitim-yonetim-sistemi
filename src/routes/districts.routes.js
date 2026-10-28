
import express from "express";
import pool from "../db.js";
import { authMiddleware, roleMiddleware } from "../authMiddleware.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, active, delivery_available
       FROM districts
       ORDER BY name ASC`
    );

    return res.json({ districts: result.rows });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "İlçeler listelenemedi."
    });
  }
});

router.patch(
  "/:id/delivery",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    try {
      const districtId = Number(req.params.id);
      const { delivery_available } = req.body;

      if (
        !Number.isInteger(districtId) ||
        districtId <= 0 ||
        typeof delivery_available !== "boolean"
      ) {
        return res.status(400).json({
          message: "Geçerli ilçe ID'si ve sevkiyat durumu gönderin."
        });
      }

      const districtResult = await pool.query(
        "SELECT id, name, delivery_available FROM districts WHERE id = $1",
        [districtId]
      );

      if (districtResult.rows.length === 0) {
        return res.status(404).json({
          message: "İlçe bulunamadı."
        });
      }

      if (!delivery_available) {
        const routeResult = await pool.query(
          `SELECT r.id, r.name
           FROM route_districts rd
           JOIN routes r ON r.id = rd.route_id
           WHERE rd.district_id = $1
             AND r.active = TRUE`,
          [districtId]
        );

        if (routeResult.rows.length > 0) {
          return res.status(409).json({
            message: "Bu ilçe aktif rotalarda bulunduğu için sevkiyat kapatılamaz.",
            routes: routeResult.rows
          });
        }
      }

      const result = await pool.query(
        `UPDATE districts
         SET delivery_available = $1
         WHERE id = $2
         RETURNING id, name, delivery_available`,
        [delivery_available, districtId]
      );

      return res.json({
        message: "İlçenin sevkiyat durumu güncellendi.",
        district: result.rows[0]
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        message: "Sevkiyat durumu güncellenemedi."
      });
    }
  }
);

export default router;
