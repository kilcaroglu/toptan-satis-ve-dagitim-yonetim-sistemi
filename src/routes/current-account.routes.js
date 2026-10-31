import express from "express";
import pool from "../db.js";
import { authMiddleware, roleMiddleware } from "../authMiddleware.js";

const router = express.Router();

router.get(
  "/:id/current-account",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    try {
      const customerId = Number(req.params.id);

      if (!Number.isInteger(customerId) || customerId <= 0) {
        return res.status(400).json({
          message: "Müşteri numarası geçersiz",
        });
      }

      const result = await pool.query(
        `SELECT
                    c.id AS customer_id,
                    c.company_name,
                    COALESCE(
                        SUM(
                            CASE
                                WHEN t.transaction_type = 'DEBIT'
                                    THEN t.amount
                                WHEN t.transaction_type = 'PAYMENT'
                                    THEN -t.amount
                                ELSE 0
                            END
                        ),
                        0
                    ) AS balance
                 FROM customers c
                 LEFT JOIN current_account_transactions t
                    ON t.customer_id = c.id
                 WHERE c.id = $1
                 GROUP BY c.id, c.company_name`,
        [customerId],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          message: "Müşteri bulunamadı",
        });
      }

      return res.json({
        current_account: result.rows[0],
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        message: "Cari bakiye alınamadı",
      });
    }
  },
);

router.post(
  "/:id/payments",
  authMiddleware,
  roleMiddleware("ADMIN", "COLLECTOR"),
  async (req, res) => {
    const client = await pool.connect();

    try {
      const customerId = Number(req.params.id);
      const amount = Number(req.body.amount);
      const idempotencyKey = req.body.idempotency_key;
      const description =
        typeof req.body.description === "string"
          ? req.body.description.trim()
          : "Müşteri tahsilatı";

      if (
        !Number.isInteger(customerId) ||
        customerId <= 0 ||
        !Number.isFinite(amount) ||
        amount <= 0 ||
        typeof idempotencyKey !== "string" ||
        idempotencyKey.trim().length < 8 ||
        idempotencyKey.trim().length > 100
      ) {
        return res.status(400).json({
          message:
            "Müşteri numarası, tahsilat tutarı veya işlem anahtarı geçersiz",
        });
      }

      await client.query("BEGIN");

      const existingPayment = await client.query(
        `SELECT *
              FROM current_account_transactions
              WHERE idempotency_key = $1`,
        [idempotencyKey.trim()],
      );

      if (existingPayment.rows.length > 0) {
        const existing = existingPayment.rows[0];

        if (
          Number(existing.customer_id) !== customerId ||
          existing.transaction_type !== "PAYMENT" ||
          Number(existing.amount) !== amount
        ) {
          await client.query("ROLLBACK");

          return res.status(409).json({
            message: "Bu işlem anahtarı farklı bir tahsilatta kullanılmış",
          });
        }

        const balanceResult = await client.query(
          `SELECT COALESCE(
                      SUM(
                          CASE
                              WHEN transaction_type = 'DEBIT' THEN amount
                              WHEN transaction_type = 'PAYMENT' THEN -amount
                              ELSE 0
                          END
                      ), 0
                  ) AS balance
                  FROM current_account_transactions
                  WHERE customer_id = $1`,
          [customerId],
        );

        await client.query("COMMIT");

        return res.status(200).json({
          message: "Bu tahsilat daha önce kaydedilmiş",
          payment: existing,
          balance: Number(balanceResult.rows[0].balance),
        });
      }

      const customerResult = await client.query(
        `SELECT id
                 FROM customers
                 WHERE id = $1 AND active = TRUE
                 FOR UPDATE`,
        [customerId],
      );

      if (customerResult.rows.length === 0) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          message: "Aktif müşteri bulunamadı",
        });
      }

      const balanceResult = await client.query(
        `SELECT COALESCE(
                    SUM(
                        CASE
                            WHEN transaction_type = 'DEBIT' THEN amount
                            WHEN transaction_type = 'PAYMENT' THEN -amount
                            ELSE 0
                        END
                    ),
                    0
                ) AS balance
                 FROM current_account_transactions
                 WHERE customer_id = $1`,
        [customerId],
      );

      const balance = Number(balanceResult.rows[0].balance);

      if (amount > balance) {
        await client.query("ROLLBACK");

        return res.status(400).json({
          message: "Tahsilat tutarı kalan borçtan fazla olamaz",
          balance,
        });
      }

      const paymentResult = await client.query(
        `INSERT INTO current_account_transactions
                    (customer_id, transaction_type, amount, description, created_by, idempotency_key)
                VALUES ($1, 'PAYMENT', $2, $3, $4, $5)
                RETURNING *`,
        [
          customerId,
          amount,
          description || "Müşteri tahsilatı",
          req.user.id,
          idempotencyKey.trim(),
        ],
      );

      await client.query("COMMIT");

      return res.status(201).json({
        message: "Tahsilat başarıyla kaydedildi",
        payment: paymentResult.rows[0],
        balance: Number((balance - amount).toFixed(2)),
      });
    } catch (error) {
      await client.query("ROLLBACK");

      // Aynı işlem anahtarıyla eşzamanlı kayıt oluşmuş olabilir.
      if (error.code === "23505") {
        const existingResult = await pool.query(
          `SELECT *
                      FROM current_account_transactions
                      WHERE idempotency_key = $1`,
          [idempotencyKey.trim()],
        );

        if (existingResult.rows.length > 0) {
          const existing = existingResult.rows[0];

          if (
            Number(existing.customer_id) === customerId &&
            existing.transaction_type === "PAYMENT" &&
            Number(existing.amount) === amount
          ) {
            const balanceResult = await pool.query(
              `SELECT COALESCE(
                                  SUM(
                                      CASE
                                          WHEN transaction_type = 'DEBIT' THEN amount
                                          WHEN transaction_type = 'PAYMENT' THEN -amount
                                          ELSE 0
                                      END
                                  ), 0
                              ) AS balance
                              FROM current_account_transactions
                              WHERE customer_id = $1`,
              [customerId],
            );

            return res.status(200).json({
              message: "Bu tahsilat daha önce kaydedilmiş",
              payment: existing,
              balance: Number(balanceResult.rows[0].balance),
            });
          }

          return res.status(409).json({
            message: "Bu işlem anahtarı farklı bir tahsilatta kullanılmış",
          });
        }
      }

      console.error(error);

      return res.status(500).json({
        message: "Tahsilat kaydedilemedi",
      });
    } finally {
      client.release();
    }
  },
);

router.get(
  "/:id/current-account/transactions",
  authMiddleware,
  roleMiddleware("ADMIN", "COLLECTOR"),
  async (req, res) => {
    try {
      const customerId = Number(req.params.id);

      if (!Number.isInteger(customerId) || customerId <= 0) {
        return res.status(400).json({
          message: "Müşteri numarası geçersiz",
        });
      }

      const customerResult = await pool.query(
        `SELECT id, company_name
                 FROM customers
                 WHERE id = $1`,
        [customerId],
      );

      if (customerResult.rows.length === 0) {
        return res.status(404).json({
          message: "Müşteri bulunamadı",
        });
      }

      const transactionsResult = await pool.query(
        `SELECT
                    id,
                    order_id,
                    transaction_type,
                    amount,
                    description,
                    created_by,
                    created_at
                 FROM current_account_transactions
                 WHERE customer_id = $1
                 ORDER BY created_at DESC, id DESC`,
        [customerId],
      );

      return res.json({
        customer: customerResult.rows[0],
        transactions: transactionsResult.rows,
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        message: "Cari hesap hareketleri alınamadı",
      });
    }
  },
);

// Manuel cari borç ekleme (Yalnızca ADMIN)
router.post(
  "/:id/debits",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    const client = await pool.connect();

    try {
      const customerId = Number(req.params.id);
      const amount = Number(req.body.amount);
      const description =
        typeof req.body.description === "string"
          ? req.body.description.trim()
          : "";

      if (
        !Number.isInteger(customerId) ||
        customerId <= 0 ||
        !Number.isFinite(amount) ||
        amount <= 0 ||
        amount > 9999999999.99 ||
        !description
      ) {
        return res.status(400).json({
          message: "Müşteri, borç tutarı veya açıklama geçersiz.",
        });
      }

      await client.query("BEGIN");

      const customerResult = await client.query(
        `SELECT id
         FROM customers
         WHERE id = $1
         FOR UPDATE`,
        [customerId]
      );

      if (customerResult.rows.length === 0) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          message: "Müşteri bulunamadı.",
        });
      }

      const debitResult = await client.query(
        `INSERT INTO current_account_transactions (
          customer_id,
          transaction_type,
          amount,
          description,
          created_by
        )
        VALUES ($1, 'DEBIT', $2, $3, $4)
        RETURNING *`,
        [
          customerId,
          amount,
          description,
          req.user.id,
        ]
      );

      const balanceResult = await client.query(
        `SELECT COALESCE(
          SUM(
            CASE
              WHEN transaction_type = 'DEBIT' THEN amount
              WHEN transaction_type = 'PAYMENT' THEN -amount
              ELSE 0
            END
          ),
          0
        ) AS balance
        FROM current_account_transactions
        WHERE customer_id = $1`,
        [customerId]
      );

      await client.query("COMMIT");

      return res.status(201).json({
        message: "Manuel borç başarıyla kaydedildi.",
        debit: debitResult.rows[0],
        balance: Number(balanceResult.rows[0].balance),
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(error);

      return res.status(500).json({
        message: "Manuel borç kaydedilemedi.",
      });
    } finally {
      client.release();
    }
  }
);

export default router;
