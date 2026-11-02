import express from "express";
import bcrypt from "bcryptjs";
import pool from "../db.js";
import { authMiddleware, roleMiddleware } from "../authMiddleware.js";

const router = express.Router();

router.use(authMiddleware, roleMiddleware("ADMIN"));

function validatePassword(password) {
  return typeof password === "string" && password.length >= 8;
}

// 1. Admin kendi şifresini değiştirir
router.patch("/me/password", async (req, res) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !validatePassword(new_password)) {
      return res.status(400).json({
        message: "Mevcut şifre ve en az 8 karakterli yeni şifre gereklidir."
      });
    }

    const result = await pool.query(
      "SELECT password_hash FROM users WHERE id = $1 AND active = TRUE AND role = 'ADMIN'",
      [req.user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ message: "Admin hesabı bulunamadı." });
    }

    const passwordCorrect = await bcrypt.compare(
      current_password,
      result.rows[0].password_hash
    );

    if (!passwordCorrect) {
      return res.status(400).json({
        message: "Mevcut şifreniz yanlış."
      });
    }

    const passwordHash = await bcrypt.hash(new_password, 10);

    await pool.query(
      "UPDATE users SET password_hash = $1 WHERE id = $2",
      [passwordHash, req.user.id]
    );

    return res.json({ message: "Şifreniz başarıyla değiştirildi." });
  } catch (error) {
    console.error("Admin şifre değiştirme hatası:", error);
    return res.status(500).json({ message: "Sunucu hatası." });
  }
});

// 2. Admin müşteri şifresini sıfırlar
router.patch("/customers/:id/password", async (req, res) => {
  try {
    const { new_password } = req.body;
    const customerId = Number(req.params.id);

    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ message: "Geçersiz müşteri numarası." });
    }

    if (!validatePassword(new_password)) {
      return res.status(400).json({
        message: "Yeni şifre en az 8 karakter olmalıdır."
      });
    }

    const passwordHash = await bcrypt.hash(new_password, 10);

    const result = await pool.query(
      `UPDATE users
       SET password_hash = $1
       WHERE id = $2 AND role = 'CUSTOMER'
       RETURNING id, name, email`,
      [passwordHash, customerId]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        message: "Müşteriye ait kullanıcı hesabı bulunamadı."
      });
    }

    return res.json({
      message: "Müşteri şifresi başarıyla sıfırlandı.",
      user: result.rows[0]
    });
  } catch (error) {
    console.error("Müşteri şifre sıfırlama hatası:", error);
    return res.status(500).json({ message: "Sunucu hatası." });
  }
});

// 3. Admin hesaplarını listele
router.get("/admins", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, phone, active, created_at
       FROM users
       WHERE role = 'ADMIN'
       ORDER BY created_at DESC, id DESC`
    );

    return res.json({ admins: result.rows });
  } catch (error) {
    console.error("Admin listeleme hatası:", error);
    return res.status(500).json({ message: "Sunucu hatası." });
  }
});

// 4. Yeni admin hesabı oluştur
router.post("/admins", async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;

    if (
      !name?.trim() ||
      !email?.trim() ||
      !validatePassword(password)
    ) {
      return res.status(400).json({
        message: "Ad soyad, e-posta ve en az 8 karakterli şifre zorunludur."
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, active, phone)
       VALUES ($1, $2, $3, 'ADMIN', TRUE, $4)
       RETURNING id, name, email, phone, role, active, created_at`,
      [
        name.trim(),
        email.trim().toLowerCase(),
        passwordHash,
        phone?.trim() || null
      ]
    );

    return res.status(201).json({
      message: "Yeni admin hesabı oluşturuldu.",
      admin: result.rows[0]
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        message: "Bu e-posta adresi zaten kullanılıyor."
      });
    }

    console.error("Admin oluşturma hatası:", error);
    return res.status(500).json({ message: "Sunucu hatası." });
  }
});

// 5. Admin hesabını aktif / pasif yap
router.patch("/admins/:id/active", async (req, res) => {
  const client = await pool.connect();

  try {
    const adminId = Number(req.params.id);
    const { active } = req.body;

    if (!Number.isInteger(adminId) || adminId <= 0) {
      return res.status(400).json({ message: "Geçersiz admin numarası." });
    }

    if (typeof active !== "boolean") {
      return res.status(400).json({
        message: "active alanı true veya false olmalıdır."
      });
    }

    if (adminId === Number(req.user.id) && active === false) {
      return res.status(400).json({
        message: "Kendi admin hesabınızı pasife alamazsınız."
      });
    }

    await client.query("BEGIN");

    // Admin kayıtlarını kilitleyerek eşzamanlı son-admin kapatma riskini önle
    const admins = await client.query(
      `SELECT id, active
       FROM users
       WHERE role = 'ADMIN'
       ORDER BY id
       FOR UPDATE`
    );

    const targetAdmin = admins.rows.find(
      (admin) => Number(admin.id) === adminId
    );

    if (!targetAdmin) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Admin bulunamadı." });
    }

    if (active === false) {
      const activeAdminCount = admins.rows.filter(
        (admin) => admin.active
      ).length;

      if (targetAdmin.active && activeAdminCount <= 1) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message: "Son aktif admin hesabı pasife alınamaz."
        });
      }
    }

    const result = await client.query(
      `UPDATE users
       SET active = $1
       WHERE id = $2 AND role = 'ADMIN'
       RETURNING id, name, email, active`,
      [active, adminId]
    );

    await client.query("COMMIT");

    return res.json({
      message: active
        ? "Admin hesabı aktifleştirildi."
        : "Admin hesabı pasife alındı.",
      admin: result.rows[0]
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Admin durum güncelleme hatası:", error);
    return res.status(500).json({ message: "Sunucu hatası." });
  } finally {
    client.release();
  }
});

export default router;