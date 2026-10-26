
import express from "express";
import pool from "../db.js";
import bcrypt from "bcryptjs";
import { authMiddleware, roleMiddleware } from "../authMiddleware.js";

const router = express.Router();

router.post(
    "/",
    authMiddleware,
    roleMiddleware("ADMIN"),
    async (req, res) => {
        try {
            const { name, email, password, phone } = req.body;

            if (!name || !email || !password) {
                return res.status(400).json({
                    message: "Ad, e-posta ve şifre zorunludur"
                });
            }

            if (typeof password !== "string" || password.length < 8) {
                return res.status(400).json({
                    message: "Şifre en az 8 karakter olmalıdır"
                });
            }

            if (typeof email !== "string" || !email.trim()) {
                return res.status(400).json({
                    message: "Geçerli bir e-posta adresi girilmelidir"
                });
            }

            const normalizedEmail = email.trim().toLowerCase();

            const existingUser = await pool.query(
                "SELECT id FROM users WHERE email = $1",
                [normalizedEmail]
            );

            if (existingUser.rows.length > 0) {
                return res.status(409).json({
                    message: "Bu e-posta adresi zaten kayıtlı"
                });
            }

            const passwordHash = await bcrypt.hash(password, 12);

            const result = await pool.query(
                `INSERT INTO users (name, email, password_hash, role, phone)
                 VALUES ($1, $2, $3, 'DRIVER', $4)
                 RETURNING id, name, email, role, phone, active, created_at`,
                [name.trim(), normalizedEmail, passwordHash, phone || null]
            );

            return res.status(201).json({
                message: "Dağıtımcı hesabı oluşturuldu",
                distributor: result.rows[0]
            });
        } catch (error) {
            if (error.code === "23505") {
                return res.status(409).json({
                    message: "Bu e-posta adresi zaten kayıtlı"
                });
            }

            console.error(error);
            return res.status(500).json({
                message: "Sunucu hatası"
            });
        }
    }
);

export default router;