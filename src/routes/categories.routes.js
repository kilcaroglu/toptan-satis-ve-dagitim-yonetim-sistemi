
import express from "express";
import pool from "../db.js";
import {
  authMiddleware,
  roleMiddleware
} from "../authMiddleware.js";

const router = express.Router();

// Kategorileri listele
router.get("/", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM categories ORDER BY name"
    );

    return res.json(result.rows);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Kategoriler alınamadı"
    });
  }
});

// Yeni kategori ekle (sadece ADMIN)
router.post(
  "/",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    try {
      const name = String(req.body.name || "").trim();

      if (!name) {
        return res.status(400).json({
          message: "Kategori adı zorunludur."
        });
      }

      // Aynı isimde kategori var mı?
      const existing = await pool.query(
        `SELECT id, name
         FROM categories
         WHERE LOWER(name) = LOWER($1)
         LIMIT 1`,
        [name]
      );

      if (existing.rows.length > 0) {
        return res.json(existing.rows[0]);
      }

      const result = await pool.query(
        `INSERT INTO categories (name)
         VALUES ($1)
         RETURNING *`,
        [name]
      );

      return res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        message: "Kategori eklenemedi."
      });
    }
  }
);

export default router;
