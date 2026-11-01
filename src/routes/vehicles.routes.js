
import express from "express";
import pool from "../db.js";
import { authMiddleware, roleMiddleware } from "../authMiddleware.js";

const router = express.Router();

// Araçları listele
router.get(
  "/",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT *
        FROM vehicles
        ORDER BY created_at DESC
      `);

      res.json(result.rows);
    } catch (error) {
      console.error("Araç listeleme hatası:", error);
      res.status(500).json({ message: "Araçlar listelenemedi." });
    }
  }
);

// Yeni araç ekle
router.post(
  "/",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    try {
      const {
        plate,
        brand,
        model,
        vehicle_type,
        capacity,
        capacity_unit,
        notes,
      } = req.body;

      if (!plate || !plate.trim()) {
        return res.status(400).json({
          message: "Araç plakası zorunludur.",
        });
      }

      const result = await pool.query(
        `
        INSERT INTO vehicles (
          plate, brand, model, vehicle_type,
          capacity, capacity_unit, notes
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        RETURNING *
        `,
        [
          plate.trim().toUpperCase(),
          brand || null,
          model || null,
          vehicle_type || null,
          capacity || null,
          capacity_unit || null,
          notes || null,
        ]
      );

      res.status(201).json({
        message: "Araç başarıyla eklendi.",
        vehicle: result.rows[0],
      });
    } catch (error) {
      if (error.code === "23505") {
        return res.status(409).json({
          message: "Bu plaka zaten kayıtlı.",
        });
      }

      console.error("Araç ekleme hatası:", error);
      res.status(500).json({ message: "Araç eklenemedi." });
    }
  }
);

// Araç bilgilerini güncelle
router.put(
  "/:id",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    try {
      const {
        plate,
        brand,
        model,
        vehicle_type,
        capacity,
        capacity_unit,
        notes,
      } = req.body;

      if (!plate || !plate.trim()) {
        return res.status(400).json({
          message: "Araç plakası zorunludur.",
        });
      }

      const result = await pool.query(
        `
        UPDATE vehicles
        SET plate = $1,
            brand = $2,
            model = $3,
            vehicle_type = $4,
            capacity = $5,
            capacity_unit = $6,
            notes = $7
        WHERE id = $8
        RETURNING *
        `,
        [
          plate.trim().toUpperCase(),
          brand || null,
          model || null,
          vehicle_type || null,
          capacity || null,
          capacity_unit || null,
          notes || null,
          req.params.id,
        ]
      );

      if (!result.rowCount) {
        return res.status(404).json({ message: "Araç bulunamadı." });
      }

      res.json({
        message: "Araç güncellendi.",
        vehicle: result.rows[0],
      });
    } catch (error) {
      if (error.code === "23505") {
        return res.status(409).json({
          message: "Bu plaka başka bir araca kayıtlı.",
        });
      }

      console.error("Araç güncelleme hatası:", error);
      res.status(500).json({ message: "Araç güncellenemedi." });
    }
  }
);

// Araç aktif / pasif
router.patch(
  "/:id/active",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        UPDATE vehicles
        SET active = NOT active
        WHERE id = $1
        RETURNING *
        `,
        [req.params.id]
      );

      if (!result.rowCount) {
        return res.status(404).json({ message: "Araç bulunamadı." });
      }

      res.json({
        message: "Araç durumu güncellendi.",
        vehicle: result.rows[0],
      });
    } catch (error) {
      console.error("Araç durum güncelleme hatası:", error);
      res.status(500).json({ message: "Araç durumu güncellenemedi." });
    }
  }
);

export default router;