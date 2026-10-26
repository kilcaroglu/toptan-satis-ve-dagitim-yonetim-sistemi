
import express from "express";
import pool from "../db.js";
import bcrypt from "bcryptjs";
import {
    authMiddleware,
    roleMiddleware
} from "../authMiddleware.js";

const router = express.Router();

router.get("/", authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT customers.*, districts.name AS district_name
             FROM customers
             LEFT JOIN districts
                ON customers.district_id = districts.id
             ORDER BY customers.id`
        );

        return res.json(result.rows);
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            message: "Müşteriler alınamadı"
        });
    }
});

router.post(
    "/",
    authMiddleware,
    roleMiddleware("ADMIN"),
    async (req, res) => {
        try {
            const {
                company_name,
                tax_number,
                contact_name,
                phone,
                address,
                district_id
            } = req.body;

            const result = await pool.query(
                `INSERT INTO customers (
                    company_name, tax_number, contact_name,
                    phone, address, district_id
                )
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING *`,
                [
                    company_name,
                    tax_number,
                    contact_name,
                    phone,
                    address,
                    district_id
                ]
            );

            return res.status(201).json(result.rows[0]);
        } catch (error) {
            console.error(error);
            return res.status(500).json({
                message: "Müşteri eklenemedi"
            });
        }
    }
);

router.put(
    "/:id",
    authMiddleware,
    roleMiddleware("ADMIN"),
    async (req, res) => {
        try {
            const { id } = req.params;
            const {
                company_name,
                tax_number,
                contact_name,
                phone,
                address,
                district_id
            } = req.body;

            const result = await pool.query(
                `UPDATE customers SET
                    company_name = $1,
                    tax_number = $2,
                    contact_name = $3,
                    phone = $4,
                    address = $5,
                    district_id = $6
                 WHERE id = $7
                 RETURNING *`,
                [
                    company_name,
                    tax_number,
                    contact_name,
                    phone,
                    address,
                    district_id,
                    id
                ]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    message: "Müşteri bulunamadı"
                });
            }

            return res.json(result.rows[0]);
        } catch (error) {
            console.error(error);
            return res.status(500).json({
                message: "Müşteri güncellenemedi"
            });
        }
    }
);

router.patch(
    "/:id/active",
    authMiddleware,
    roleMiddleware("ADMIN"),
    async (req, res) => {
        try {
            const { id } = req.params;

            const result = await pool.query(
                `UPDATE customers
                 SET active = NOT active
                 WHERE id = $1
                 RETURNING *`,
                [id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    message: "Müşteri bulunamadı"
                });
            }

            return res.json(result.rows[0]);
        } catch (error) {
            console.error(error);
            return res.status(500).json({
                message: "Müşteri durumu değiştirilemedi"
            });
        }
    }
);

router.post(
    "/create-account",
    authMiddleware,
    roleMiddleware("ADMIN"),
    async (req, res) => {
        try {
            const {
                email,
                password,
                name,
                phone,
                company_name,
                tax_number,
                contact_name,
                address,
                district_id
            } = req.body;

            if (
                typeof email !== "string" || !email.trim() ||
                typeof password !== "string" || password.length < 8
            ) {
                return res.status(400).json({
                    message: "Geçerli e-posta ve en az 8 karakterli şifre girin"
                });
            }

            const passwordHash = await bcrypt.hash(password, 10);

            const userResult = await pool.query(
                `INSERT INTO users (
                    email, password_hash, role, name, phone
                )
                VALUES ($1, $2, 'CUSTOMER', $3, $4)
                RETURNING id, email, name, role, phone`,
                [
                    email.trim().toLowerCase(),
                    passwordHash,
                    name,
                    phone
                ]
            );

            const user = userResult.rows[0];

            const customerResult = await pool.query(
                `INSERT INTO customers (
                    user_id, company_name, tax_number, contact_name,
                    phone, address, district_id
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING *`,
                [
                    user.id,
                    company_name,
                    tax_number,
                    contact_name,
                    phone,
                    address,
                    district_id
                ]
            );

            return res.status(201).json({
                user,
                customer: customerResult.rows[0]
            });
        } catch (error) {
            console.error(error);
            return res.status(500).json({
                message: "Müşteri hesabı oluşturulamadı"
            });
        }
    }
);

router.patch(
  "/change-password",
  authMiddleware,
  roleMiddleware("CUSTOMER"),
  async (req, res) => {
    try {
      const { current_password, new_password } = req.body;

      if (
        typeof current_password !== "string" ||
        typeof new_password !== "string" ||
        new_password.length < 8
      ) {
        return res.status(400).json({
          message: "Mevcut parolanızı ve en az 8 karakterli yeni parolanızı girin."
        });
      }

      const result = await pool.query(
        "SELECT password_hash FROM users WHERE id = $1 AND role = 'CUSTOMER'",
        [req.user.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          message: "Kullanıcı bulunamadı."
        });
      }

      const passwordCorrect = await bcrypt.compare(
        current_password,
        result.rows[0].password_hash
      );

      if (!passwordCorrect) {
        return res.status(400).json({
          message: "Mevcut parolanız yanlış."
        });
      }

      const samePassword = await bcrypt.compare(
        new_password,
        result.rows[0].password_hash
      );

      if (samePassword) {
        return res.status(400).json({
          message: "Yeni parola mevcut paroladan farklı olmalıdır."
        });
      }

      const newPasswordHash = await bcrypt.hash(new_password, 10);

      await pool.query(
        "UPDATE users SET password_hash = $1 WHERE id = $2",
        [newPasswordHash, req.user.id]
      );

      return res.json({
        message: "Parolanız başarıyla değiştirildi."
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        message: "Parola değiştirilemedi."
      });
    }
  }
);

export default router;
