import express from "express";
import pool from "../db.js";
import {
  authMiddleware,
  roleMiddleware
} from "../authMiddleware.js";

const router = express.Router();

router.post(
  "/",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    const client = await pool.connect();

    try {
      const {
        product_id,
        new_product,
        invoice_date,
        invoice_number,
        quantity,
        unit_cost,
        supplier_name,
        purchase_date,
        payment_method,
        stock_added
      } = req.body;

      if (
        !invoice_date ||
        !invoice_number?.trim() ||
        !supplier_name?.trim() ||
        !purchase_date ||
        !payment_method?.trim() ||
        !Number.isFinite(Number(quantity)) ||
        Number(quantity) <= 0 ||
        !Number.isFinite(Number(unit_cost)) ||
        Number(unit_cost) < 0 ||
        typeof stock_added !== "boolean"
      ) {
        return res.status(400).json({
          message: "Satın alma bilgilerini eksiksiz ve doğru girin"
        });
      }

      if ((!product_id && !new_product) ||
          (product_id && new_product)) {
        return res.status(400).json({
          message: "Mevcut ürün seçin veya yeni ürün bilgisi girin"
        });
      }

      await client.query("BEGIN");

      let productId;

      if (new_product) {
        const {
          name,
          category_id,
          min_unit_label,
          unit_weight_kg,
          price
        } = new_product;

        if (
          !name?.trim() ||
          !min_unit_label?.trim() ||
          !Number.isFinite(Number(unit_weight_kg)) ||
          Number(unit_weight_kg) <= 0 ||
          !Number.isFinite(Number(price)) ||
          Number(price) < 0
        ) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            message: "Yeni ürün bilgileri eksik veya hatalı"
          });
        }

        const existingProduct = await client.query(
          `SELECT id FROM products
           WHERE lower(trim(name)) = lower(trim($1))`,
          [name]
        );

        if (existingProduct.rows.length > 0) {
          await client.query("ROLLBACK");
          return res.status(409).json({
            message: "Bu isimde bir ürün mevcut. Yeni ürün oluşturmak yerine mevcut ürünü seçin.",
            product_id: existingProduct.rows[0].id
          });
        }

        const productResult = await client.query(
          `INSERT INTO products
           (name, category_id, min_unit_label, unit_weight_kg, stock, price)
           VALUES ($1, $2, $3, $4, 0, $5)
           RETURNING id`,
          [
            name.trim(),
            category_id || null,
            min_unit_label.trim(),
            unit_weight_kg,
            price
          ]
        );

        productId = productResult.rows[0].id;
      } else {
        const productResult = await client.query(
          `SELECT id FROM products WHERE id = $1 FOR UPDATE`,
          [product_id]
        );

        if (productResult.rows.length === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({
            message: "Ürün bulunamadı"
          });
        }

        productId = productResult.rows[0].id;
      }

      const totalPrice = (
        Number(quantity) * Number(unit_cost)
      ).toFixed(2);

      const purchaseResult = await client.query(
        `INSERT INTO product_purchases (
          product_id, invoice_date, invoice_number, quantity,
          unit_cost, total_price, supplier_name, purchase_date,
          payment_method, stock_added
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *`,
        [
          productId,
          invoice_date,
          invoice_number.trim(),
          quantity,
          unit_cost,
          totalPrice,
          supplier_name.trim(),
          purchase_date,
          payment_method.trim(),
          stock_added
        ]
      );

      let updatedProduct;

      if (stock_added) {
        const stockResult = await client.query(
          `UPDATE products
           SET stock = stock + $1, updated_at = NOW()
           WHERE id = $2
           RETURNING *`,
          [quantity, productId]
        );

        updatedProduct = stockResult.rows[0];
      }

      await client.query("COMMIT");

      return res.status(201).json({
        message: stock_added
          ? "Satın alma kaydedildi ve stok artırıldı"
          : "Satın alma kaydedildi; stok değiştirilmedi",
        purchase: purchaseResult.rows[0],
        product: updatedProduct || { id: productId }
      });
    } catch (error) {
      await client.query("ROLLBACK");

      if (error.code === "23505") {
        return res.status(409).json({
          message: "Bu firmaya ait fatura numarası daha önce kaydedilmiş"
        });
      }

      console.error(error);
      return res.status(500).json({
        message: "Satın alma kaydedilemedi"
      });
    } finally {
      client.release();
    }
  }
);

export default router;