
import express from "express";
import pool from "../db.js";
import { authMiddleware, roleMiddleware } from "../authMiddleware.js";

const router = express.Router();

const personnelAuth = [
  authMiddleware,
  roleMiddleware("DRIVER", "DISTRIBUTOR"),
];

// Personelin atanmış olduğu sevkiyatın siparişlerini ve ürünlerini getirir.
router.get(
  "/shipments/:id/orders",
  ...personnelAuth,
  async (req, res) => {
    try {
      const shipmentId = Number(req.params.id);

      if (!Number.isInteger(shipmentId) || shipmentId <= 0) {
        return res.status(400).json({
          message: "Geçersiz sevkiyat numarası",
        });
      }

      const shipmentResult = await pool.query(
        `SELECT
            s.id,
            s.shipment_date,
            s.status,
            r.name AS route_name,
            v.plate AS vehicle_plate,
            v.brand AS vehicle_brand,
            v.model AS vehicle_model
         FROM shipments s
         INNER JOIN routes r ON r.id = s.route_id
         LEFT JOIN vehicles v ON v.id = s.vehicle_id
         INNER JOIN shipment_drivers sd
            ON sd.shipment_id = s.id
         WHERE s.id = $1
           AND sd.user_id = $2
         LIMIT 1`,
        [shipmentId, req.user.id],
      );

      if (shipmentResult.rows.length === 0) {
        return res.status(404).json({
          message: "Sevkiyat bulunamadı veya bu sevkiyata atanmadınız",
        });
      }

      const ordersResult = await pool.query(
        `SELECT
            o.id AS order_id,
            o.customer_id,
            o.shipment_id,
            o.status,
            o.total_amount,
            o.created_at,
            c.company_name,
            c.contact_name,
            c.address,
            c.phone
         FROM orders o
         INNER JOIN customers c ON c.id = o.customer_id
         WHERE o.shipment_id = $1
         ORDER BY o.id`,
        [shipmentId],
      );

      const orders = ordersResult.rows;

      if (orders.length === 0) {
        return res.json({
          shipment: shipmentResult.rows[0],
          orders: [],
        });
      }

      const orderIds = orders.map((order) => order.order_id);

      const itemsResult = await pool.query(
        `SELECT
            oi.id,
            oi.order_id,
            oi.product_id,
            oi.quantity,
            oi.unit_price,
            p.name AS product_name,
            p.min_unit_label
         FROM order_items oi
         INNER JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = ANY($1::int[])
         ORDER BY oi.order_id, oi.id`,
        [orderIds],
      );

      const ordersWithItems = orders.map((order) => ({
        ...order,
        items: itemsResult.rows.filter(
          (item) => item.order_id === order.order_id,
        ),
      }));

      return res.json({
        shipment: shipmentResult.rows[0],
        orders: ordersWithItems,
      });
    } catch (error) {
      console.error("Personel sevkiyat detayları:", error);

      return res.status(500).json({
        message: "Sevkiyat siparişleri alınamadı",
      });
    }
  },
);

// Siparişi yola çıktı olarak işaretler.
router.patch(
  "/orders/:id/on-the-way",
  ...personnelAuth,
  async (req, res) => {
    const client = await pool.connect();
    let transactionStarted = false;

    try {
      const orderId = Number(req.params.id);

      if (!Number.isInteger(orderId) || orderId <= 0) {
        return res.status(400).json({
          message: "Geçersiz sipariş numarası",
        });
      }

      await client.query("BEGIN");
      transactionStarted = true;

      const orderResult = await client.query(
        `SELECT
            o.id,
            o.shipment_id,
            o.status
         FROM orders o
         INNER JOIN shipment_drivers sd
           ON sd.shipment_id = o.shipment_id
         WHERE o.id = $1
           AND sd.user_id = $2
         FOR UPDATE OF o`,
        [orderId, req.user.id],
      );

      if (orderResult.rows.length === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(404).json({
          message: "Sipariş bulunamadı veya bu sevkiyata atanmadınız",
        });
      }

      const order = orderResult.rows[0];

      if (order.status === "ON_THE_WAY") {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.json({
          message: "Bu sipariş zaten yola çıkmış",
          alreadyOnTheWay: true,
          orderId: order.id,
        });
      }

      if (order.status !== "PREPARING") {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(400).json({
          message: "Yalnızca hazırlanan siparişler yola çıkarılabilir",
          current_status: order.status,
        });
      }

      const updateResult = await client.query(
        `UPDATE orders
         SET status = 'ON_THE_WAY',
             updated_at = NOW()
         WHERE id = $1
           AND status = 'PREPARING'
         RETURNING id, status, shipment_id`,
        [order.id],
      );

      if (updateResult.rows.length === 0) {
        throw new Error("Sipariş durumu güncellenemedi");
      }

      await client.query("COMMIT");
      transactionStarted = false;

      return res.json({
        message: "Sipariş yola çıktı olarak işaretlendi",
        order: updateResult.rows[0],
      });
    } catch (error) {
      if (transactionStarted) {
        await client.query("ROLLBACK");
      }

      console.error("Sipariş yola çıktı hatası:", error);

      return res.status(500).json({
        message: "Sipariş durumu güncellenemedi",
      });
    } finally {
      client.release();
    }
  },
);

// Siparişi teslim eder, müşteri carisine borç kaydı ekler
// ve sevkiyatın tamamlanıp tamamlanmadığını kontrol eder.
router.patch(
  "/orders/:id/deliver",
  ...personnelAuth,
  async (req, res) => {
    const client = await pool.connect();
    let transactionStarted = false;

    try {
      const orderId = Number(req.params.id);

      if (!Number.isInteger(orderId) || orderId <= 0) {
        return res.status(400).json({
          message: "Geçersiz sipariş numarası",
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
        [orderId, req.user.id],
      );

      if (orderResult.rows.length === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(404).json({
          message: "Sipariş bulunamadı veya bu sevkiyata atanmadınız",
        });
      }

      const order = orderResult.rows[0];

      if (order.status === "DELIVERED") {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.json({
          message: "Bu sipariş daha önce teslim edilmiş",
          alreadyDelivered: true,
          orderId: order.id,
        });
      }

      if (order.status !== "ON_THE_WAY") {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(400).json({
          message: "Yalnızca yola çıkmış siparişler teslim edilebilir",
          current_status: order.status,
        });
      }

      // Müşteri cari hesabına borç kaydı ekle.
      await client.query(
        `INSERT INTO current_account_transactions
            (customer_id, order_id, transaction_type,
             amount, description, created_by)
         VALUES ($1, $2, 'DEBIT', $3, $4, $5)`,
        [
          order.customer_id,
          order.id,
          order.total_amount,
          `Teslim edilen sipariş #${order.id}`,
          req.user.id,
        ],
      );

      // Sipariş durumunu teslim edildi olarak güncelle.
      const updateResult = await client.query(
        `UPDATE orders
         SET status = 'DELIVERED',
             updated_at = NOW()
         WHERE id = $1
           AND status = 'ON_THE_WAY'
         RETURNING id, status, total_amount`,
        [order.id],
      );

      if (updateResult.rows.length === 0) {
        throw new Error("Sipariş durumu güncellenemedi");
      }

      // Aynı sevkiyattaki eş zamanlı teslimat kontrollerini sıraya al.
      await client.query(
        `SELECT id
         FROM shipments
         WHERE id = $1
         FOR UPDATE`,
        [order.shipment_id],
      );

      // Sevkiyatta teslim edilmemiş sipariş kaldı mı?
      const shipmentOrdersResult = await client.query(
        `SELECT
            COUNT(*)::int AS total_orders,
            COUNT(*) FILTER (
              WHERE status NOT IN ('DELIVERED', 'CANCELLED')
            )::int AS unfinished_orders
         FROM orders
         WHERE shipment_id = $1`,
        [order.shipment_id],
      );

      const {
        total_orders,
        unfinished_orders,
      } = shipmentOrdersResult.rows[0];

      let shipmentCompleted = false;

      // Bütün siparişler teslim edilmiş veya iptal edilmişse
      // sevkiyatın durumunu da teslim edildi olarak güncelle.
      if (
        total_orders > 0 &&
        unfinished_orders === 0
      ) {
        const shipmentUpdateResult = await client.query(
          `UPDATE shipments
           SET status = 'DELIVERED'
           WHERE id = $1
             AND status <> 'DELIVERED'
           RETURNING id, status`,
          [order.shipment_id],
        );

        shipmentCompleted = shipmentUpdateResult.rows.length > 0;
      }

      await client.query("COMMIT");
      transactionStarted = false;

      return res.json({
        message: "Sipariş başarıyla teslim edildi",
        order: updateResult.rows[0],
        shipmentCompleted,
        accountTransaction: {
          type: "DEBIT",
          amount: order.total_amount,
        },
      });
    } catch (error) {
      if (transactionStarted) {
        await client.query("ROLLBACK");
      }

      if (error.code === "23505") {
        return res.status(409).json({
          message: "Bu sipariş için daha önce cari hesap borcu kaydedilmiş",
        });
      }

      console.error("Sipariş teslim hatası:", error);

      return res.status(500).json({
        message: "Teslimat onaylanamadı",
      });
    } finally {
      client.release();
    }
  },
);

export default router;
