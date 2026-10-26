
import express from "express";
import pool from "../db.js";
import { authMiddleware, roleMiddleware } from "../authMiddleware.js";

const router = express.Router();

router.get(
    "/shipments/:id/orders",
    authMiddleware,
    roleMiddleware("DRIVER"),
    async (req, res) => {
        try {
            const shipmentId = Number(req.params.id);

            if (!Number.isInteger(shipmentId) || shipmentId <= 0) {
                return res.status(400).json({
                    message: "Geçersiz sevkiyat numarası"
                });
            }

            const result = await pool.query(
                `SELECT
                    o.id AS order_id,
                    o.shipment_id,
                    o.status,
                    o.total_amount,
                    o.created_at,
                    c.company_name,
                    c.address,
                    c.phone
                 FROM orders o
                 INNER JOIN customers c
                    ON c.id = o.customer_id
                 INNER JOIN shipment_drivers sd
                    ON sd.shipment_id = o.shipment_id
                 WHERE o.shipment_id = $1
                   AND sd.user_id = $2
                 ORDER BY o.id`,
                [shipmentId, req.user.id]
            );

            return res.json(result.rows);
        } catch (error) {
            console.error(error);
            return res.status(500).json({
                message: "Sevkiyat siparişleri alınamadı"
            });
        }
    }
);

router.patch(
    "/orders/:id/deliver",
    authMiddleware,
    roleMiddleware("DRIVER"),
    async (req, res) => {
        const client = await pool.connect();
        let transactionStarted = false;

        try {
            const orderId = Number(req.params.id);

            if (!Number.isInteger(orderId) || orderId <= 0) {
                return res.status(400).json({
                    message: "Geçersiz sipariş numarası"
                });
            }

            await client.query("BEGIN");
            transactionStarted = true;

            const orderResult = await client.query(
                `SELECT
                    o.id,
                    o.customer_id,
                    o.shipment_id,
                    o.total_amount,
                    o.status
                 FROM orders o
                 INNER JOIN shipment_drivers sd
                    ON sd.shipment_id = o.shipment_id
                 WHERE o.id = $1
                   AND sd.user_id = $2
                 FOR UPDATE OF o`,
                [orderId, req.user.id]
            );

            if (orderResult.rows.length === 0) {
                await client.query("ROLLBACK");
                transactionStarted = false;

                return res.status(404).json({
                    message: "Sipariş bulunamadı veya bu sevkiyata atanmadınız"
                });
            }

            const order = orderResult.rows[0];

            if (order.status !== "ON_THE_WAY") {
                await client.query("ROLLBACK");
                transactionStarted = false;

                return res.status(400).json({
                    message: "Yalnızca teslimata çıkmış siparişler teslim edildi olarak işaretlenebilir",
                    current_status: order.status
                });
            }

            await client.query(
                `INSERT INTO current_account_transactions
                    (customer_id, order_id, transaction_type,
                     amount, description, created_by)
                 VALUES ($1, $2, 'DEBIT', $3, $4, $5)`,
                [
                    order.customer_id,
                    orderId,
                    order.total_amount,
                    `Teslim edilen sipariş #${orderId}`,
                    req.user.id
                ]
            );

            const updateResult = await client.query(
                `UPDATE orders
                 SET status = 'DELIVERED',
                     updated_at = now()
                 WHERE id = $1
                   AND status = 'ON_THE_WAY'
                 RETURNING *`,
                [orderId]
            );

            if (updateResult.rows.length === 0) {
                throw new Error("Sipariş durumu güncellenemedi");
            }

            await client.query("COMMIT");
            transactionStarted = false;

            return res.json({
                message: "Sipariş teslim edildi olarak kaydedildi",
                order: updateResult.rows[0]
            });
        } catch (error) {
            if (transactionStarted) {
                await client.query("ROLLBACK");
            }

            if (error.code === "23505") {
                return res.status(409).json({
                    message: "Bu sipariş için daha önce cari hesap borcu kaydedilmiş"
                });
            }

            console.error(error);
            return res.status(500).json({
                message: "Teslimat onaylanamadı"
            });
        } finally {
            client.release();
        }
    }
);

export default router;