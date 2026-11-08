
import express from "express";
import pool from "../db.js";
import bcrypt from "bcryptjs";
import {
  authMiddleware,
  roleMiddleware
} from "../authMiddleware.js";

const router = express.Router();

// Şoför, dağıtıcı ve tahsildarları listele
router.get(
  "/",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, name, email, role, phone, active, created_at
         FROM users
         WHERE role IN ('DRIVER', 'DISTRIBUTOR', 'COLLECTOR')
         ORDER BY name`
      );

      return res.json(result.rows);
    } catch (error) {
      console.error("Personel listeleme hatası:", error);

      return res.status(500).json({
        message: "Personeller listelenemedi"
      });
    }
  }
);

// Yeni şoför, dağıtıcı veya tahsildar ekle
router.post(
  "/",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    try {
      const {
        name,
        email,
        password,
        phone,
        role
      } = req.body;

      if (!name || !email || !password) {
        return res.status(400).json({
          message: "Ad, e-posta ve şifre zorunludur"
        });
      }

      if (!["DRIVER", "DISTRIBUTOR", "COLLECTOR"].includes(role)) {
        return res.status(400).json({
          message: "Personel görevi geçersiz"
        });
      }

      if (
        typeof password !== "string" ||
        password.length < 8
      ) {
        return res.status(400).json({
          message: "Şifre en az 8 karakter olmalıdır"
        });
      }

      if (
        typeof email !== "string" ||
        !email.trim()
      ) {
        return res.status(400).json({
          message: "Geçerli bir e-posta adresi girilmelidir"
        });
      }

      const normalizedEmail = email.trim().toLowerCase();

      const passwordHash = await bcrypt.hash(password, 12);

      const result = await pool.query(
        `INSERT INTO users
          (name, email, password_hash, role, phone)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, email, role, phone, active, created_at`,
        [
          name.trim(),
          normalizedEmail,
          passwordHash,
          role,
          phone || null
        ]
      );

      return res.status(201).json({
        message: "Personel hesabı oluşturuldu",
        distributor: result.rows[0]
      });
    } catch (error) {
      if (error.code === "23505") {
        return res.status(409).json({
          message: "Bu e-posta adresi zaten kayıtlı"
        });
      }

      console.error("Personel oluşturma hatası:", error);

      return res.status(500).json({
        message: "Personel oluşturulamadı"
      });
    }
  }
);

// Personeli aktif / pasif yap
router.patch(
  "/:id/active",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { active } = req.body;

      if (!Number.isInteger(Number(id)) || Number(id) <= 0) {
        return res.status(400).json({
          message: "Geçersiz personel numarası."
        });
      }

      if (typeof active !== "boolean") {
        return res.status(400).json({
          message: "Aktiflik bilgisi true veya false olmalıdır."
        });
      }

      const result = await pool.query(
        `UPDATE users
         SET active = $1
         WHERE id = $2
           AND role IN ('DRIVER', 'DISTRIBUTOR', 'COLLECTOR')
         RETURNING id, name, email, role, phone, active, created_at`,
        [active, Number(id)]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          message: "Personel bulunamadı."
        });
      }

      return res.json({
        message: active
          ? "Personel aktif hale getirildi."
          : "Personel pasif hale getirildi.",
        personnel: result.rows[0]
      });
    } catch (error) {
      console.error("Personel aktif/pasif hatası:", error);

      return res.status(500).json({
        message: "Personel durumu güncellenemedi."
      });
    }
  }
);

export default router;
