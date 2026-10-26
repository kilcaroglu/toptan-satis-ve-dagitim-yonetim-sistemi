import express from "express";
import pool from "../db.js";
import { authMiddleware, roleMiddleware } from "../authMiddleware.js";

const router = express.Router();

router.post(
  "/",
  authMiddleware,
  roleMiddleware("CUSTOMER"),
  async (req, res) => {
    const client = await pool.connect();

    try {
      const { shipment_id, items } = req.body;

      // Gelen bilgileri kontrol et
      if (!shipment_id || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          message: "Sevkiyat ve ürünler gereklidir",
        });
      }

      // Giriş yapan kullanıcının müşteri kaydını bul
      const customerResult = await client.query(
        `SELECT id, district_id
                 FROM customers
                 WHERE user_id = $1
                   AND active = TRUE`,
        [req.user.id],
      );

      if (customerResult.rows.length === 0) {
        return res.status(403).json({
          message: "Aktif müşteri kaydı bulunamadı",
        });
      }

      const customer = customerResult.rows[0];

      await client.query("BEGIN");

      // Sevkiyatın bu müşterinin ilçesine uygun olduğunu kontrol et
      const shipmentResult = await client.query(
        `SELECT
                  shipments.id,
                  shipments.shipment_date,
                  routes.id AS route_id,
                  routes.delivery_day,
                  routes.order_deadline_day,
                  routes.order_deadline_time
                 FROM shipments
                 INNER JOIN routes
                    ON shipments.route_id = routes.id
                 INNER JOIN route_districts
                    ON routes.id = route_districts.route_id
                 WHERE shipments.id = $1
                   AND route_districts.district_id = $2
                   AND routes.active = TRUE
                   AND shipments.status = 'PLANNED'
                 FOR UPDATE OF shipments`,
        [shipment_id, customer.district_id],
      );

      if (shipmentResult.rows.length === 0) {
        await client.query("ROLLBACK");

        return res.status(400).json({
          message: "Bu sevkiyat müşteriniz için uygun değil",
        });
      }

      const shipment = shipmentResult.rows[0];

      // Sipariş son tarihini kontrol et
      const deadlineResult = await client.query(
        `SELECT
                    (
                        $1::date
                        - (
                            (
                                $2::int
                                - $3::int
                                + 7
                            ) % 7
                        )
                    ) AS deadline_date`,
        [
          shipment.shipment_date,
          shipment.delivery_day,
          shipment.order_deadline_day,
        ],
      );

      const deadlineDate = deadlineResult.rows[0].deadline_date;

      const deadlineCheck = await client.query(
        `SELECT
                    (
                        ($1::date + $2::time)
                        >=
                        (now() AT TIME ZONE 'Europe/Istanbul')
                    ) AS still_open`,
        [deadlineDate, shipment.order_deadline_time],
      );

      if (!deadlineCheck.rows[0].still_open) {
        await client.query("ROLLBACK");

        return res.status(400).json({
          message: "Bu sevkiyat için sipariş süresi dolmuş",
        });
      }

      // Siparişi oluştur
      const orderResult = await client.query(
        `INSERT INTO orders
                    (customer_id, shipment_id, status, total_amount)
                 VALUES ($1, $2, 'PENDING', 0)
                 RETURNING *`,
        [customer.id, shipment.id],
      );

      const order = orderResult.rows[0];
      let totalAmount = 0;

      // Her ürünü ve sipariş anındaki fiyatını kaydet
      for (const item of items) {
        const quantity = Number(item.quantity);
        const productId = Number(item.product_id);

        if (
          !Number.isInteger(productId) ||
          productId <= 0 ||
          !Number.isFinite(quantity) ||
          quantity <= 0
        ) {
          throw new Error("Ürün veya miktar geçersiz");
        }

        const productResult = await client.query(
          `SELECT id, price
                     FROM products
                     WHERE id = $1
                       AND active = TRUE`,
          [productId],
        );

        if (productResult.rows.length === 0) {
          throw new Error("Ürün bulunamadı veya pasif");
        }

        const product = productResult.rows[0];
        const unitPrice = Number(product.price);

        await client.query(
          `INSERT INTO order_items
                        (order_id, product_id, quantity, unit_price)
                     VALUES ($1, $2, $3, $4)`,
          [order.id, product.id, quantity, unitPrice],
        );

        totalAmount += quantity * unitPrice;
      }

      // Sipariş toplamını kaydet
      const updatedOrder = await client.query(
        `UPDATE orders
                 SET total_amount = $1,
                     updated_at = now()
                 WHERE id = $2
                 RETURNING *`,
        [totalAmount, order.id],
      );

      await client.query("COMMIT");

      res.status(201).json({
        message: "Sipariş başarıyla oluşturuldu",
        order: updatedOrder.rows[0],
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error(error);

      res.status(500).json({
        message: "Sipariş oluşturulamadı",
      });
    } finally {
      client.release();
    }
  },
);

router.get(
  "/",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
                    orders.id,
                    orders.customer_id,
                    customers.company_name,
                    orders.shipment_id,
                    shipments.shipment_date,
                    routes.name AS route_name,
                    orders.status,
                    orders.total_amount,
                    orders.created_at,
                    orders.updated_at
                 FROM orders
                 INNER JOIN customers
                    ON orders.customer_id = customers.id
                 INNER JOIN shipments
                    ON orders.shipment_id = shipments.id
                 INNER JOIN routes
                    ON shipments.route_id = routes.id
                 ORDER BY orders.created_at DESC`,
      );

      res.json(result.rows);
    } catch (error) {
      console.error(error);

      res.status(500).json({
        message: "Siparişler alınamadı",
      });
    }
  },
);

router.patch(
  "/:id/status",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    const client = await pool.connect();

    try {
      const orderId = Number(req.params.id);
      const { status } = req.body;

      const allowedStatuses = [
        "PENDING",
        "APPROVED",
        "PREPARING",
        "ON_THE_WAY",
        "DELIVERED",
        "CANCELLED",
      ];

      if (
        !Number.isInteger(orderId) ||
        orderId <= 0 ||
        !allowedStatuses.includes(status)
      ) {
        return res.status(400).json({
          message: "Sipariş numarası veya durumu geçersiz",
        });
      }

      await client.query("BEGIN");

      const orderResult = await client.query(
        `SELECT id, customer_id, total_amount, status, stock_deducted
                 FROM orders
                 WHERE id = $1
                 FOR UPDATE`,
        [orderId],
      );

      if (orderResult.rows.length === 0) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          message: "Sipariş bulunamadı",
        });
      }

      const order = orderResult.rows[0];

      const allowedTransitions = {
        PENDING: ["APPROVED", "CANCELLED"],
        APPROVED: ["PREPARING", "CANCELLED"],
        PREPARING: ["ON_THE_WAY", "CANCELLED"],
        ON_THE_WAY: ["DELIVERED"],
        DELIVERED: [],
        CANCELLED: [],
      };

      if (!allowedTransitions[order.status].includes(status)) {
        await client.query("ROLLBACK");

        return res.status(400).json({
          message: `Sipariş durumu ${order.status} durumundan ${status} durumuna geçirilemez`,
        });
      }

      if (order.status === status) {
        await client.query("COMMIT");

        return res.json({
          message: "Sipariş zaten bu durumda",
          order,
        });
      }

      // Sipariş onaylanırken stoktan düş.
      if (status === "APPROVED" && !order.stock_deducted) {
        const itemsResult = await client.query(
          `SELECT product_id, quantity
                     FROM order_items
                     WHERE order_id = $1`,
          [orderId],
        );

        if (itemsResult.rows.length === 0) {
          await client.query("ROLLBACK");

          return res.status(400).json({
            message: "Ürünü olmayan sipariş onaylanamaz",
          });
        }

        for (const item of itemsResult.rows) {
          const stockResult = await client.query(
            `UPDATE products
                         SET stock = stock - $1,
                             updated_at = now()
                         WHERE id = $2
                           AND active = TRUE
                           AND stock >= $1
                         RETURNING id`,
            [item.quantity, item.product_id],
          );

          if (stockResult.rows.length === 0) {
            await client.query("ROLLBACK");

            return res.status(400).json({
              message: `Ürün ID ${item.product_id} için stok yetersiz veya ürün pasif`,
            });
          }
        }

        await client.query(
          `UPDATE orders
                     SET stock_deducted = TRUE
                     WHERE id = $1`,
          [orderId],
        );
      }

      // Stok daha önce düşülmüşse iptal sırasında geri ekle.
      if (status === "CANCELLED" && order.stock_deducted) {
        const itemsResult = await client.query(
          `SELECT product_id, quantity
                     FROM order_items
                     WHERE order_id = $1`,
          [orderId],
        );

        for (const item of itemsResult.rows) {
          await client.query(
            `UPDATE products
                         SET stock = stock + $1,
                             updated_at = now()
                         WHERE id = $2`,
            [item.quantity, item.product_id],
          );
        }

        await client.query(
          `UPDATE orders
                     SET stock_deducted = FALSE
                     WHERE id = $1`,
          [orderId],
        );
      }

      // Sipariş teslim edildiğinde müşteri cari hesabına borç ekle.
      if (status === "DELIVERED") {
        await client.query(
          `INSERT INTO current_account_transactions
                  (customer_id, order_id, transaction_type, amount, description, created_by)
                  VALUES ($1, $2, 'DEBIT', $3, $4, $5)`,
          [
            order.customer_id,
            orderId,
            order.total_amount,
            `Teslim edilen sipariş #${orderId}`,
            req.user.id,
          ],
        );
      }

      const result = await client.query(
        `UPDATE orders
                 SET status = $1,
                     updated_at = now()
                 WHERE id = $2
                 RETURNING *`,
        [status, orderId],
      );

      await client.query("COMMIT");

      res.json({
        message: "Sipariş durumu güncellendi",
        order: result.rows[0],
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error(error);

      res.status(500).json({
        message: "Sipariş durumu güncellenemedi",
      });
    } finally {
      client.release();
    }
  },
);

router.get(
  "/orders/:id/items",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    try {
      const { id } = req.params;

      const result = await pool.query(
        `SELECT
                    order_items.id,
                    order_items.order_id,
                    order_items.product_id,
                    products.name AS product_name,
                    products.min_unit_label,
                    order_items.quantity,
                    order_items.unit_price,
                    order_items.quantity * order_items.unit_price
                        AS line_total
                 FROM order_items
                 INNER JOIN products
                    ON order_items.product_id = products.id
                 WHERE order_items.order_id = $1
                 ORDER BY order_items.id`,
        [id],
      );

      res.json(result.rows);
    } catch (error) {
      console.error(error);

      res.status(500).json({
        message: "Sipariş ürünleri alınamadı",
      });
    }
  },
);

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

      if (
        !Number.isInteger(orderId) ||
        orderId <= 0 ||
        !Number.isInteger(itemId) ||
        itemId <= 0 ||
        !Number.isFinite(quantity) ||
        quantity <= 0
      ) {
        return res.status(400).json({
          message: "Sipariş, ürün veya miktar bilgisi geçersiz",
        });
      }

      await client.query("BEGIN");
      transactionStarted = true;

      const orderResult = await client.query(
        `SELECT id, status, stock_deducted
                 FROM orders
                 WHERE id = $1
                 FOR UPDATE`,
        [orderId],
      );

      if (orderResult.rows.length === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(404).json({
          message: "Sipariş bulunamadı",
        });
      }

      const order = orderResult.rows[0];

      if (["DELIVERED", "CANCELLED"].includes(order.status)) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(400).json({
          message: "Tamamlanmış veya iptal edilmiş sipariş düzenlenemez",
        });
      }

      const itemResult = await client.query(
        `SELECT id, product_id, quantity
                 FROM order_items
                 WHERE id = $1 AND order_id = $2
                 FOR UPDATE`,
        [itemId, orderId],
      );

      if (itemResult.rows.length === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(404).json({
          message: "Sipariş ürünü bulunamadı",
        });
      }

      const item = itemResult.rows[0];
      const oldQuantity = Number(item.quantity);
      const difference = quantity - oldQuantity;

      // Stok daha önce düşülmüşse aradaki farkı ayarla.
      if (order.stock_deducted && difference !== 0) {
        if (difference > 0) {
          // Miktar artıyor: ek stok yeterli mi?
          const stockResult = await client.query(
            `UPDATE products
                         SET stock = stock - $1,
                             updated_at = now()
                         WHERE id = $2
                           AND active = TRUE
                           AND stock >= $1
                         RETURNING id`,
            [difference, item.product_id],
          );

          if (stockResult.rows.length === 0) {
            await client.query("ROLLBACK");
            transactionStarted = false;

            return res.status(400).json({
              message: "Ek miktar için stok yetersiz veya ürün pasif",
            });
          }
        } else {
          // Miktar azalıyor: kullanılmayan stoğu geri ekle.
          await client.query(
            `UPDATE products
                         SET stock = stock + $1,
                             updated_at = now()
                         WHERE id = $2`,
            [-difference, item.product_id],
          );
        }
      }

      const updatedItem = await client.query(
        `UPDATE order_items
                 SET quantity = $1
                 WHERE id = $2 AND order_id = $3
                 RETURNING *`,
        [quantity, itemId, orderId],
      );

      const totalResult = await client.query(
        `UPDATE orders
                 SET total_amount = (
                    SELECT COALESCE(
                        SUM(quantity * unit_price),
                        0
                    )
                    FROM order_items
                    WHERE order_id = $1
                 ),
                 updated_at = now()
                 WHERE id = $1
                 RETURNING total_amount`,
        [orderId],
      );

      await client.query("COMMIT");
      transactionStarted = false;

      res.json({
        message: "Sipariş miktarı ve toplam tutar güncellendi",
        item: updatedItem.rows[0],
        total_amount: totalResult.rows[0].total_amount,
      });
    } catch (error) {
      if (transactionStarted) {
        await client.query("ROLLBACK");
      }

      console.error(error);

      res.status(500).json({
        message: "Sipariş miktarı güncellenemedi",
      });
    } finally {
      client.release();
    }
  },
);

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
        !Number.isInteger(orderId) ||
        orderId <= 0 ||
        !Number.isInteger(productId) ||
        productId <= 0 ||
        !Number.isFinite(quantity) ||
        quantity <= 0
      ) {
        return res.status(400).json({
          message: "Sipariş, ürün veya miktar bilgileri geçersiz",
        });
      }

      await client.query("BEGIN");
      transactionStarted = true;

      const orderResult = await client.query(
        `SELECT id, status, stock_deducted
                 FROM orders
                 WHERE id = $1
                 FOR UPDATE`,
        [orderId],
      );

      if (orderResult.rows.length === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(404).json({
          message: "Sipariş bulunamadı",
        });
      }

      const order = orderResult.rows[0];

      if (["DELIVERED", "CANCELLED"].includes(order.status)) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(400).json({
          message: "Bu siparişe ürün eklenemez",
        });
      }

      const productResult = await client.query(
        `SELECT id, price
                 FROM products
                 WHERE id = $1
                   AND active = TRUE`,
        [productId],
      );

      if (productResult.rows.length === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(404).json({
          message: "Ürün bulunamadı veya pasif",
        });
      }

      const product = productResult.rows[0];

      // Siparişin stoğu daha önce düşüldüyse,
      // eklenen ürünün stoğunu da düş.
      if (order.stock_deducted) {
        const stockResult = await client.query(
          `UPDATE products
                     SET stock = stock - $1,
                         updated_at = now()
                     WHERE id = $2
                       AND active = TRUE
                       AND stock >= $1
                     RETURNING id`,
          [quantity, product.id],
        );

        if (stockResult.rows.length === 0) {
          await client.query("ROLLBACK");
          transactionStarted = false;

          return res.status(400).json({
            message: "Ürün stoğu yetersiz veya ürün pasif",
          });
        }
      }

      const itemResult = await client.query(
        `INSERT INTO order_items
                    (order_id, product_id, quantity, unit_price)
                 VALUES ($1, $2, $3, $4)
                 RETURNING *`,
        [orderId, product.id, quantity, product.price],
      );

      const totalResult = await client.query(
        `UPDATE orders
                 SET total_amount = (
                    SELECT COALESCE(
                        SUM(quantity * unit_price),
                        0
                    )
                    FROM order_items
                    WHERE order_id = $1
                 ),
                 updated_at = now()
                 WHERE id = $1
                 RETURNING total_amount`,
        [orderId],
      );

      await client.query("COMMIT");
      transactionStarted = false;

      res.status(201).json({
        message: "Ürün siparişe eklendi",
        item: itemResult.rows[0],
        total_amount: totalResult.rows[0].total_amount,
      });
    } catch (error) {
      if (transactionStarted) {
        await client.query("ROLLBACK");
      }

      console.error(error);

      res.status(500).json({
        message: "Siparişe ürün eklenemedi",
      });
    } finally {
      client.release();
    }
  },
);

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

      if (
        !Number.isInteger(orderId) ||
        orderId <= 0 ||
        !Number.isInteger(itemId) ||
        itemId <= 0
      ) {
        return res.status(400).json({
          message: "Geçersiz sipariş veya ürün satırı ID'si",
        });
      }

      await client.query("BEGIN");
      transactionStarted = true;

      const orderResult = await client.query(
        `SELECT id, status, stock_deducted
                 FROM orders
                 WHERE id = $1
                 FOR UPDATE`,
        [orderId],
      );

      if (orderResult.rows.length === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(404).json({
          message: "Sipariş bulunamadı",
        });
      }

      const order = orderResult.rows[0];

      if (["DELIVERED", "CANCELLED"].includes(order.status)) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(400).json({
          message: "Teslim edilmiş veya iptal edilmiş sipariş değiştirilemez",
        });
      }

      const itemResult = await client.query(
        `SELECT id, product_id, quantity
                 FROM order_items
                 WHERE id = $1 AND order_id = $2
                 FOR UPDATE`,
        [itemId, orderId],
      );

      if (itemResult.rows.length === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(404).json({
          message: "Sipariş ürün satırı bulunamadı",
        });
      }

      const item = itemResult.rows[0];

      // Siparişin stoğu daha önce düşüldüyse ürünü stoğa geri ekle.
      if (order.stock_deducted) {
        await client.query(
          `UPDATE products
                     SET stock = stock + $1,
                         updated_at = NOW()
                     WHERE id = $2`,
          [item.quantity, item.product_id],
        );
      }

      await client.query(
        `DELETE FROM order_items
                 WHERE id = $1 AND order_id = $2`,
        [itemId, orderId],
      );

      const totalResult = await client.query(
        `UPDATE orders
                 SET total_amount = (
                     SELECT COALESCE(SUM(quantity * unit_price), 0)
                     FROM order_items
                     WHERE order_id = $1
                 ),
                 updated_at = NOW()
                 WHERE id = $1
                 RETURNING total_amount`,
        [orderId],
      );

      await client.query("COMMIT");
      transactionStarted = false;

      return res.json({
        message: "Ürün siparişten silindi",
        order_id: orderId,
        deleted_item_id: itemId,
        stock_returned: order.stock_deducted,
        total_amount: totalResult.rows[0].total_amount,
      });
    } catch (error) {
      if (transactionStarted) {
        await client.query("ROLLBACK");
      }

      console.error("Sipariş ürün silme hatası:", error);

      return res.status(500).json({
        message: "Sunucu hatası",
      });
    } finally {
      client.release();
    }
  },
);

export default router;