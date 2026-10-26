
import express from "express";
import pool from "../db.js";
import { authMiddleware, roleMiddleware } from "../authMiddleware.js";

const router = express.Router();

router.get(
    "/",
    authMiddleware,
    roleMiddleware("CUSTOMER"),
    async (req, res) => {
        try {
            const result = await pool.query(
                `SELECT
                    orders.id,
                    orders.status,
                    orders.total_amount,
                    orders.created_at,
                    orders.updated_at,
                    shipments.shipment_date,
                    routes.name AS route_name
                 FROM orders
                 INNER JOIN customers
                    ON orders.customer_id = customers.id
                 INNER JOIN shipments
                    ON orders.shipment_id = shipments.id
                 INNER JOIN routes
                    ON shipments.route_id = routes.id
                 WHERE customers.user_id = $1
                 ORDER BY orders.created_at DESC`,
                [req.user.id]
            );

            return res.json(result.rows);
        } catch (error) {
            console.error(error);
            return res.status(500).json({
                message: "Siparişleriniz alınamadı"
            });
        }
    }
);


router.get(
    "/:id/items",
    authMiddleware,
    roleMiddleware("CUSTOMER"),
    async (req, res) => {
        try {
            const orderId = Number(req.params.id);
            const userId = req.user.id;

            if (!Number.isInteger(orderId) || orderId <= 0) {
                return res.status(400).json({
                    message: "Geçersiz sipariş numarası"
                });
            }

            const orderResult = await pool.query(
                `SELECT o.id
                 FROM orders o
                 JOIN customers c ON c.id = o.customer_id
                 WHERE o.id = $1
                   AND c.user_id = $2`,
                [orderId, userId]
            );

            if (orderResult.rows.length === 0) {
                return res.status(404).json({
                    message: "Sipariş bulunamadı"
                });
            }

            const result = await pool.query(
                `SELECT
                    oi.id,
                    oi.product_id,
                    p.name AS product_name,
                    oi.quantity,
                    oi.unit_price,
                    oi.quantity * oi.unit_price AS line_total
                 FROM order_items oi
                 JOIN products p ON p.id = oi.product_id
                 WHERE oi.order_id = $1
                 ORDER BY oi.id`,
                [orderId]
            );

            return res.json(result.rows);
        } catch (error) {
            console.error(error);

            return res.status(500).json({
                message: "Sipariş ürünleri getirilemedi"
            });
        }
    }
);

export default router;