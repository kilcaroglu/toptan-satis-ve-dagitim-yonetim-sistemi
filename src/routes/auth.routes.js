
import express from "express";
import bcrypt from "bcryptjs";
import { login } from "../auth.js";
import pool from "../db.js";
import {
  authMiddleware
} from "../authMiddleware.js";

const router = express.Router();

// Kullanıcı girişi
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await login(email, password);

    if (!result) {
      return res.status(401).json({
        message: "Email veya şifre yanlış"
      });
    }

    return res.json({
      message: "Giriş başarılı",
      token: result.token,
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        role: result.user.role
      }
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Sunucu hatası"
    });
  }
});

// Kayıtlı tokenın geçerliliğini kontrol et.
router.get("/me", authMiddleware, async (req, res) => {
  return res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
      role: req.user.role
    }
  });
});

// Giriş yapan kullanıcının şifresini değiştir.
router.patch(
  "/change-password",
  authMiddleware,
  async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          message: "Mevcut şifre ve yeni şifre gereklidir."
        });
      }

      if (
        typeof currentPassword !== "string" ||
        typeof newPassword !== "string"
      ) {
        return res.status(400).json({
          message: "Şifre bilgileri geçersiz."
        });
      }

      if (newPassword.length < 8) {
        return res.status(400).json({
          message: "Yeni şifre en az 8 karakter olmalıdır."
        });
      }

      const result = await pool.query(
        `SELECT id, password_hash
         FROM users
         WHERE id = $1
           AND active = TRUE`,
        [req.user.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          message: "Kullanıcı bulunamadı."
        });
      }

      const user = result.rows[0];

      const passwordCorrect = await bcrypt.compare(
        currentPassword,
        user.password_hash
      );

      if (!passwordCorrect) {
        return res.status(400).json({
          message: "Mevcut şifreniz yanlış."
        });
      }

      const samePassword = await bcrypt.compare(
        newPassword,
        user.password_hash
      );

      if (samePassword) {
        return res.status(400).json({
          message: "Yeni şifreniz mevcut şifrenizden farklı olmalıdır."
        });
      }

      const passwordHash = await bcrypt.hash(newPassword, 10);

      await pool.query(
        `UPDATE users
         SET password_hash = $1
         WHERE id = $2`,
        [passwordHash, req.user.id]
      );

      return res.json({
        message: "Şifreniz başarıyla değiştirildi."
      });
    } catch (error) {
      console.error("Şifre değiştirme hatası:", error);

      return res.status(500).json({
        message: "Şifre değiştirme işlemi gerçekleştirilemedi."
      });
    }
  }
);

export default router;
