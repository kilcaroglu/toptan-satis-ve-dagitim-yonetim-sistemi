
import express from "express";
import pool from "../db.js";
import {
  authMiddleware,
  roleMiddleware,
} from "../authMiddleware.js";

const router = express.Router();

const allowedTransitions = {
  PENDING: ["APPROVED", "CANCELLED"],
  APPROVED: ["PREPARING", "CANCELLED"],
  PREPARING: ["ON_THE_WAY", "CANCELLED"],
  ON_THE_WAY: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
};

// Ürün miktarını kontrol et
function validQuantity(value) {
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity > 0;
}

// Sipariş toplamını yeniden hesapla
async function updateOrderTotal(client, orderId) {
  const result = await client.query(
    `UPDATE orders
     SET total_amount = (
       SELECT COALESCE(SUM(quantity * unit_price), 0)
       FROM order_items
       WHERE order_id = $1
     ),
     updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [orderId]
  );

  return result.rows[0];
}


// --------------------------------------------------
// MÜŞTERİNİN TESLİMAT GÜNLERİNİ GETİRME
// GET /orders/delivery-days
// --------------------------------------------------

router.get(
  "/delivery-days",
  authMiddleware,
  roleMiddleware("CUSTOMER"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT DISTINCT rs.delivery_day
         FROM customers c
         INNER JOIN route_districts rd
           ON rd.district_id = c.district_id
         INNER JOIN routes r
           ON r.id = rd.route_id
         INNER JOIN route_schedules rs
           ON rs.route_id = r.id
         WHERE c.user_id = $1
           AND c.active = TRUE
           AND r.active = TRUE
           AND rs.active = TRUE
         ORDER BY rs.delivery_day`,
        [req.user.id]
      );

      return res.json({
        delivery_days: result.rows.map(
          row => Number(row.delivery_day)
        ),
      });
    } catch (error) {
      console.error("Teslimat günleri hatası:", error);

      return res.status(500).json({
        message: "Teslimat günleri getirilemedi",
      });
    }
  }
);

// --------------------------------------------------
// MÜŞTERİ SİPARİŞ OLUŞTURMA
// POST /orders
// --------------------------------------------------

router.post(
  "/",
  authMiddleware,
  roleMiddleware("CUSTOMER"),
  async (req, res) => {
    const client = await pool.connect();
    let transactionStarted = false;

    try {
      const { items } = req.body;

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          message: "Sipariş için en az bir ürün gereklidir",
        });
      }

      await client.query("BEGIN");
      transactionStarted = true;

      const customerResult = await client.query(
        `SELECT id, district_id
         FROM customers
         WHERE user_id = $1
           AND active = TRUE
         FOR UPDATE`,
        [req.user.id]
      );

      if (customerResult.rows.length === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(404).json({
          message: "Aktif müşteri kaydı bulunamadı",
        });
      }

      const customer = customerResult.rows[0];

      // Müşterinin ilçesine uygun ilk siparişe açık sevkiyatı bul.
      const shipmentResult = await client.query(
        `SELECT
            s.id,
            s.shipment_date,
            r.id AS route_id
         FROM shipments s
         INNER JOIN routes r
           ON r.id = s.route_id
         INNER JOIN route_districts rd
           ON rd.route_id = r.id
         INNER JOIN route_schedules rs
           ON rs.route_id = r.id
           AND rs.delivery_day =
               EXTRACT(ISODOW FROM s.shipment_date)::int
           AND rs.active = TRUE
         WHERE rd.district_id = $1
           AND r.active = TRUE
           AND s.status = 'PLANNED'
           AND s.shipment_date::date >=
               (NOW() AT TIME ZONE 'Europe/Istanbul')::date
           AND (
             (
               (
                 s.shipment_date::date
                 - (
                     (
                       EXTRACT(ISODOW FROM s.shipment_date)::int
                       - rs.order_deadline_day::int
                       + 7
                     ) % 7
                   )
               )::date
               + rs.order_deadline_time
             ) AT TIME ZONE 'Europe/Istanbul'
           ) > NOW()
         ORDER BY s.shipment_date ASC, s.id ASC
         LIMIT 1
         FOR UPDATE OF s`,
        [customer.district_id]
      );

      if (shipmentResult.rows.length === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(400).json({
          message:
            "İlçeniz için şu anda sipariş verilebilecek uygun bir sevkiyat bulunmuyor.",
        });
      }

      const shipment = shipmentResult.rows[0];

      // Siparişi otomatik belirlenen sevkiyata bağla.
      const orderResult = await client.query(
        `INSERT INTO orders
          (
            customer_id,
            shipment_id,
            status,
            total_amount,
            order_source
          )
         VALUES ($1, $2, 'PENDING', 0, 'CUSTOMER')
         RETURNING *`,
        [customer.id, shipment.id]
      );

      const order = orderResult.rows[0];

      for (const item of items) {
        const productId = Number(item.product_id);
        const quantity = Number(item.quantity);

        if (
          !Number.isInteger(productId) ||
          productId <= 0 ||
          !validQuantity(quantity)
        ) {
          throw new Error("Ürün veya miktar bilgisi geçersiz");
        }

        const productResult = await client.query(
          `SELECT id, price
           FROM products
           WHERE id = $1
             AND active = TRUE`,
          [productId]
        );

        if (productResult.rows.length === 0) {
          throw new Error("Ürün bulunamadı veya satışa kapalı");
        }

        const product = productResult.rows[0];

        await client.query(
          `INSERT INTO order_items
            (order_id, product_id, quantity, unit_price)
           VALUES ($1, $2, $3, $4)`,
          [
            order.id,
            product.id,
            quantity,
            product.price,
          ]
        );
      }

      const updatedOrder = await updateOrderTotal(
        client,
        order.id
      );

      await client.query("COMMIT");
      transactionStarted = false;

      return res.status(201).json({
        message: "Sipariş başarıyla oluşturuldu",
        order: updatedOrder,
      });
    } catch (error) {
      if (transactionStarted) {
        await client.query("ROLLBACK");
      }

      console.error("Müşteri sipariş hatası:", error);

      return res.status(500).json({
        message: error.message || "Sipariş oluşturulamadı",
      });
    } finally {
      client.release();
    }
  }
);

// --------------------------------------------------
// ADMİN SİPARİŞ LİSTELEME
// GET /orders
// --------------------------------------------------

router.get(
  "/",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
            o.id,
            o.customer_id,
            c.company_name,
            c.contact_name,
            c.phone,
            o.shipment_id,
            s.shipment_date,
            r.name AS route_name,
            o.status,
            o.total_amount,
            o.order_source,
            o.created_by,
            o.created_at,
            o.updated_at
         FROM orders o
         INNER JOIN customers c
           ON c.id = o.customer_id
         INNER JOIN shipments s
           ON s.id = o.shipment_id
         INNER JOIN routes r
           ON r.id = s.route_id
         ORDER BY o.created_at DESC`
      );

      return res.json(result.rows);
    } catch (error) {
      console.error("Sipariş listeleme hatası:", error);

      return res.status(500).json({
        message: "Siparişler getirilemedi",
      });
    }
  }
);

// --------------------------------------------------
// ADMİN MÜŞTERİ ADINA SİPARİŞ OLUŞTURMA
// POST /orders/admin-create
// Sipariş son saati kontrol edilmez.
// --------------------------------------------------

router.post(
  "/admin-create",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    const client = await pool.connect();
    let transactionStarted = false;

    try {
      const customerId = Number(req.body.customer_id);
      const shipmentId = Number(req.body.shipment_id);
      const { items } = req.body;

      if (
        !Number.isInteger(customerId) ||
        customerId <= 0 ||
        !Number.isInteger(shipmentId) ||
        shipmentId <= 0 ||
        !Array.isArray(items) ||
        items.length === 0
      ) {
        return res.status(400).json({
          message: "Müşteri, sevkiyat ve ürün bilgileri gereklidir",
        });
      }

      await client.query("BEGIN");
      transactionStarted = true;

      const customerResult = await client.query(
        `SELECT id, district_id
         FROM customers
         WHERE id = $1
           AND active = TRUE
         FOR UPDATE`,
        [customerId]
      );

      if (customerResult.rows.length === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(404).json({
          message: "Aktif müşteri bulunamadı",
        });
      }

      const customer = customerResult.rows[0];

      const shipmentResult = await client.query(
        `SELECT
            s.id,
            s.shipment_date,
            r.id AS route_id
         FROM shipments s
         INNER JOIN routes r
           ON r.id = s.route_id
         INNER JOIN route_districts rd
           ON rd.route_id = r.id
         INNER JOIN route_schedules rs
           ON rs.route_id = r.id
           AND rs.delivery_day =
               EXTRACT(ISODOW FROM s.shipment_date)::int
           AND rs.active = TRUE
         WHERE s.id = $1
           AND rd.district_id = $2
           AND r.active = TRUE
           AND s.status = 'PLANNED'
         FOR UPDATE OF s`,
        [shipmentId, customer.district_id]
      );

      if (shipmentResult.rows.length === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(400).json({
          message:
            "Seçilen sevkiyat müşterinin ilçesine uygun değil veya planlanmış durumda değil",
        });
      }

      // Admin için sipariş son saati kontrolü uygulanmaz.

      const orderResult = await client.query(
        `INSERT INTO orders
          (
            customer_id,
            shipment_id,
            status,
            total_amount,
            order_source,
            created_by
          )
         VALUES ($1, $2, 'PENDING', 0, 'ADMIN', $3)
         RETURNING *`,
        [customer.id, shipmentId, req.user.id]
      );

      const order = orderResult.rows[0];

      for (const item of items) {
        const productId = Number(item.product_id);
        const quantity = Number(item.quantity);

        if (
          !Number.isInteger(productId) ||
          productId <= 0 ||
          !validQuantity(quantity)
        ) {
          throw new Error("Ürün veya miktar bilgisi geçersiz");
        }

        const productResult = await client.query(
          `SELECT id, price
           FROM products
           WHERE id = $1
             AND active = TRUE`,
          [productId]
        );

        if (productResult.rows.length === 0) {
          throw new Error(
            `Ürün ID ${productId} bulunamadı veya pasif`
          );
        }

        const product = productResult.rows[0];

        await client.query(
          `INSERT INTO order_items
            (order_id, product_id, quantity, unit_price)
           VALUES ($1, $2, $3, $4)`,
          [
            order.id,
            product.id,
            quantity,
            product.price,
          ]
        );
      }

      const updatedOrder = await updateOrderTotal(
        client,
        order.id
      );

      await client.query("COMMIT");
      transactionStarted = false;

      return res.status(201).json({
        message: "Müşteri adına sipariş başarıyla oluşturuldu",
        order: updatedOrder,
      });
    } catch (error) {
      if (transactionStarted) {
        await client.query("ROLLBACK");
      }

      console.error("Admin sipariş oluşturma hatası:", error);

      return res.status(500).json({
        message: error.message || "Sipariş oluşturulamadı",
      });
    } finally {
      client.release();
    }
  }
);

// --------------------------------------------------
// ADMİN SİPARİŞ DURUMU DEĞİŞTİRME
// PATCH /orders/:id/status
// --------------------------------------------------

router.patch(
  "/:id/status",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    const client = await pool.connect();
    let transactionStarted = false;

    try {
      const orderId = Number(req.params.id);
      const { status } = req.body;

      if (!Number.isInteger(orderId) || orderId <= 0) {
        return res.status(400).json({
          message: "Geçersiz sipariş numarası",
        });
      }

      await client.query("BEGIN");
      transactionStarted = true;

      const orderResult = await client.query(
        `SELECT *
         FROM orders
         WHERE id = $1
         FOR UPDATE`,
        [orderId]
      );

      if (orderResult.rows.length === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(404).json({
          message: "Sipariş bulunamadı",
        });
      }

      const order = orderResult.rows[0];

      const allowed = allowedTransitions[order.status] || [];

      if (!allowed.includes(status)) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(400).json({
          message: "Bu sipariş durumuna geçiş yapılamaz",
        });
      }

      // Sipariş onaylandığında stokları düş.
      if (status === "APPROVED") {
        const itemsResult = await client.query(
          `SELECT
              oi.product_id,
              oi.quantity,
              p.stock,
              p.name AS product_name
           FROM order_items oi
           INNER JOIN products p
             ON p.id = oi.product_id
           WHERE oi.order_id = $1
           FOR UPDATE OF p`,
          [orderId]
        );

        if (itemsResult.rows.length === 0) {
          throw new Error("Siparişte ürün bulunmuyor");
        }

        for (const item of itemsResult.rows) {
          if (Number(item.stock) < Number(item.quantity)) {
            throw new Error(
              `${item.product_name} ürünü için yeterli stok bulunmuyor`
            );
          }

          await client.query(
            `UPDATE products
             SET stock = stock - $1
             WHERE id = $2`,
            [item.quantity, item.product_id]
          );
        }
      }

      // Onaylanmış sipariş iptal edilirse stokları iade et.
      if (status === "CANCELLED" &&
          ["APPROVED", "PREPARING"].includes(order.status)) {
        const itemsResult = await client.query(
          `SELECT product_id, quantity
           FROM order_items
           WHERE order_id = $1`,
          [orderId]
        );

        for (const item of itemsResult.rows) {
          await client.query(
            `UPDATE products
             SET stock = stock + $1
             WHERE id = $2`,
            [item.quantity, item.product_id]
          );
        }
      }

      // Teslim edildiğinde müşteri cari hesabına borç yaz.
      if (status === "DELIVERED") {
        await client.query(
          `INSERT INTO current_account_transactions
            (
              customer_id,
              transaction_type,
              amount,
              description,
              order_id,
              created_by
            )
           VALUES ($1, 'DEBIT', $2, $3, $4, $5)`,
          [
            order.customer_id,
            order.total_amount,
            `Sipariş #${order.id} teslim edildi`,
            order.id,
            req.user.id,
          ]
        );
      }

      const updatedResult = await client.query(
        `UPDATE orders
         SET status = $1,
             updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [status, orderId]
      );

      await client.query("COMMIT");
      transactionStarted = false;

      return res.json({
        message: "Sipariş durumu güncellendi",
        order: updatedResult.rows[0],
      });
    } catch (error) {
      if (transactionStarted) {
        await client.query("ROLLBACK");
      }

      console.error("Sipariş durum güncelleme hatası:", error);

      return res.status(500).json({
        message: error.message || "Sipariş durumu güncellenemedi",
      });
    } finally {
      client.release();
    }
  }
);

// --------------------------------------------------
// SİPARİŞ ÜRÜNLERİNİ GETİRME
// GET /orders/:id/items
// --------------------------------------------------

router.get(
  "/:id/items",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    try {
      const orderId = Number(req.params.id);

      const result = await pool.query(
        `SELECT
            oi.id,
            oi.order_id,
            oi.product_id,
            p.name AS product_name,
            p.min_unit_label,
            oi.quantity,
            oi.unit_price,
            oi.quantity * oi.unit_price AS line_total
         FROM order_items oi
         INNER JOIN products p
           ON p.id = oi.product_id
         WHERE oi.order_id = $1
         ORDER BY oi.id`,
        [orderId]
      );

      return res.json(result.rows);
    } catch (error) {
      console.error("Sipariş ürünleri hatası:", error);

      return res.status(500).json({
        message: "Sipariş ürünleri getirilemedi",
      });
    }
  }
);

// --------------------------------------------------
// SİPARİŞTEKİ ÜRÜN MİKTARINI GÜNCELLEME
// PATCH /orders/:orderId/items/:itemId
// --------------------------------------------------

router.patch(
  "/:orderId/items/:itemId",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    const client = await pool.connect();
    let transactionStarted = false;

    try {
      const orderId = Number(req.params.orderId);
      const itemId = Number(req.params.itemId);
      const quantity = Number(req.body.quantity);

      if (!validQuantity(quantity)) {
        return res.status(400).json({
          message: "Geçerli bir miktar giriniz",
        });
      }

      await client.query("BEGIN");
      transactionStarted = true;

      const orderResult = await client.query(
        `SELECT *
         FROM orders
         WHERE id = $1
         FOR UPDATE`,
        [orderId]
      );

      if (orderResult.rows.length === 0) {
        throw new Error("Sipariş bulunamadı");
      }

      const order = orderResult.rows[0];

      if (["DELIVERED", "CANCELLED"].includes(order.status)) {
        throw new Error(
          "Teslim edilmiş veya iptal edilmiş sipariş düzenlenemez"
        );
      }

      const itemResult = await client.query(
        `SELECT oi.*, p.stock
         FROM order_items oi
         INNER JOIN products p
           ON p.id = oi.product_id
         WHERE oi.id = $1
           AND oi.order_id = $2
         FOR UPDATE OF oi, p`,
        [itemId, orderId]
      );

      if (itemResult.rows.length === 0) {
        throw new Error("Sipariş ürünü bulunamadı");
      }

      const item = itemResult.rows[0];
      const oldQuantity = Number(item.quantity);
      const difference = quantity - oldQuantity;

      // Sipariş onaylandıysa stok farkını uygula.
      if (["APPROVED", "PREPARING", "ON_THE_WAY"].includes(order.status)) {
        if (difference > 0 && Number(item.stock) < difference) {
          throw new Error("Yeterli stok bulunmuyor");
        }

        await client.query(
          `UPDATE products
           SET stock = stock - $1
           WHERE id = $2`,
          [difference, item.product_id]
        );
      }

      await client.query(
        `UPDATE order_items
         SET quantity = $1
         WHERE id = $2`,
        [quantity, itemId]
      );

      const updatedOrder = await updateOrderTotal(
        client,
        orderId
      );

      await client.query("COMMIT");
      transactionStarted = false;

      return res.json({
        message: "Ürün miktarı güncellendi",
        order: updatedOrder,
      });
    } catch (error) {
      if (transactionStarted) {
        await client.query("ROLLBACK");
      }

      console.error("Ürün miktarı güncelleme hatası:", error);

      return res.status(400).json({
        message: error.message || "Ürün miktarı güncellenemedi",
      });
    } finally {
      client.release();
    }
  }
);

// --------------------------------------------------
// SİPARİŞE YENİ ÜRÜN EKLEME
// POST /orders/:id/items
// --------------------------------------------------

router.post(
  "/:id/items",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    const client = await pool.connect();
    let transactionStarted = false;

    try {
      const orderId = Number(req.params.id);
      const productId = Number(req.body.product_id);
      const quantity = Number(req.body.quantity);

      if (
        !Number.isInteger(productId) ||
        productId <= 0 ||
        !validQuantity(quantity)
      ) {
        return res.status(400).json({
          message: "Ürün ve miktar bilgileri geçersiz",
        });
      }

      await client.query("BEGIN");
      transactionStarted = true;

      const orderResult = await client.query(
        `SELECT *
         FROM orders
         WHERE id = $1
         FOR UPDATE`,
        [orderId]
      );

      if (orderResult.rows.length === 0) {
        throw new Error("Sipariş bulunamadı");
      }

      const order = orderResult.rows[0];

      if (["DELIVERED", "CANCELLED"].includes(order.status)) {
        throw new Error("Bu siparişe ürün eklenemez");
      }

      const productResult = await client.query(
        `SELECT id, price, stock
         FROM products
         WHERE id = $1
           AND active = TRUE
         FOR UPDATE`,
        [productId]
      );

      if (productResult.rows.length === 0) {
        throw new Error("Ürün bulunamadı veya pasif");
      }

      const product = productResult.rows[0];

      if (["APPROVED", "PREPARING", "ON_THE_WAY"].includes(order.status)) {
        if (Number(product.stock) < quantity) {
          throw new Error("Yeterli stok bulunmuyor");
        }

        await client.query(
          `UPDATE products
           SET stock = stock - $1
           WHERE id = $2`,
          [quantity, productId]
        );
      }

      await client.query(
        `INSERT INTO order_items
          (order_id, product_id, quantity, unit_price)
         VALUES ($1, $2, $3, $4)`,
        [orderId, productId, quantity, product.price]
      );

      const updatedOrder = await updateOrderTotal(
        client,
        orderId
      );

      await client.query("COMMIT");
      transactionStarted = false;

      return res.status(201).json({
        message: "Ürün siparişe eklendi",
        order: updatedOrder,
      });
    } catch (error) {
      if (transactionStarted) {
        await client.query("ROLLBACK");
      }

      console.error("Siparişe ürün ekleme hatası:", error);

      return res.status(400).json({
        message: error.message || "Ürün eklenemedi",
      });
    } finally {
      client.release();
    }
  }
);

// --------------------------------------------------
// SİPARİŞTEN ÜRÜN SİLME
// DELETE /orders/:orderId/items/:itemId
// --------------------------------------------------

router.delete(
  "/:orderId/items/:itemId",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    const client = await pool.connect();
    let transactionStarted = false;

    try {
      const orderId = Number(req.params.orderId);
      const itemId = Number(req.params.itemId);

      await client.query("BEGIN");
      transactionStarted = true;

      const orderResult = await client.query(
        `SELECT *
         FROM orders
         WHERE id = $1
         FOR UPDATE`,
        [orderId]
      );

      if (orderResult.rows.length === 0) {
        throw new Error("Sipariş bulunamadı");
      }

      const order = orderResult.rows[0];

      if (["DELIVERED", "CANCELLED"].includes(order.status)) {
        throw new Error("Bu siparişten ürün silinemez");
      }

      const itemResult = await client.query(
        `SELECT oi.*, p.stock
         FROM order_items oi
         INNER JOIN products p
           ON p.id = oi.product_id
         WHERE oi.id = $1
           AND oi.order_id = $2
         FOR UPDATE OF oi, p`,
        [itemId, orderId]
      );

      if (itemResult.rows.length === 0) {
        throw new Error("Sipariş ürünü bulunamadı");
      }

      const item = itemResult.rows[0];

      // Onaylanmış siparişten ürün silinirse stoğu iade et.
      if (["APPROVED", "PREPARING", "ON_THE_WAY"].includes(order.status)) {
        await client.query(
          `UPDATE products
           SET stock = stock + $1
           WHERE id = $2`,
          [item.quantity, item.product_id]
        );
      }

      await client.query(
        `DELETE FROM order_items
         WHERE id = $1
           AND order_id = $2`,
        [itemId, orderId]
      );

      const updatedOrder = await updateOrderTotal(
        client,
        orderId
      );

      await client.query("COMMIT");
      transactionStarted = false;

      return res.json({
        message: "Ürün siparişten silindi",
        order: updatedOrder,
      });
    } catch (error) {
      if (transactionStarted) {
        await client.query("ROLLBACK");
      }

      console.error("Siparişten ürün silme hatası:", error);

      return res.status(400).json({
        message: error.message || "Ürün silinemedi",
      });
    } finally {
      client.release();
    }
  }
);

export default router;