
import express from "express";
import pool from "../db.js";
import {
  authMiddleware,
  roleMiddleware
} from "../authMiddleware.js";

const router = express.Router();

router.get("/", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT products.*, categories.name AS category_name
       FROM products
       LEFT JOIN categories ON products.category_id = categories.id
       ORDER BY products.id`
    );

    return res.json(result.rows);
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Ürünler alınamadı"
    });
  }
});

router.post("/", authMiddleware, roleMiddleware("ADMIN"), async (req, res) => {
  try {
    const {
      name,
      category_id,
      min_unit_label,
      unit_weight_kg,
      stock,
      price
    } = req.body;

    const result = await pool.query(
      `INSERT INTO products
       (name, category_id, min_unit_label, unit_weight_kg, stock, price)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name, category_id, min_unit_label, unit_weight_kg, stock, price]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Ürün eklenemedi"
    });
  }
});

router.get(
  "/:id/purchases",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    try {
      const { id } = req.params;

      const productResult = await pool.query(
        `SELECT id, name FROM products WHERE id = $1`,
        [id]
      );

      if (productResult.rows.length === 0) {
        return res.status(404).json({
          message: "Ürün bulunamadı"
        });
      }

      const purchasesResult = await pool.query(
        `SELECT id, product_id, invoice_date, invoice_number,
                quantity, unit_cost, total_price, supplier_name,
                purchase_date, payment_method, stock_added, created_at
         FROM product_purchases
         WHERE product_id = $1
         ORDER BY purchase_date DESC, id DESC`,
        [id]
      );

      return res.json({
        product: productResult.rows[0],
        purchases: purchasesResult.rows
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        message: "Satın alma geçmişi getirilemedi"
      });
    }
  }
);

router.put("/:id", authMiddleware, roleMiddleware("ADMIN"), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      category_id,
      min_unit_label,
      unit_weight_kg,
      stock,
      price
    } = req.body;

    const result = await pool.query(
      `UPDATE products SET
         name = $1, category_id = $2, min_unit_label = $3,
         unit_weight_kg = $4, stock = $5, price = $6,
         updated_at = NOW()
       WHERE id = $7
       RETURNING *`,
      [name, category_id, min_unit_label, unit_weight_kg, stock, price, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Ürün bulunamadı"
      });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Ürün güncellenemedi"
    });
  }
});

router.patch(
  "/:id/active",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    try {
      const { id } = req.params;

      const result = await pool.query(
        `UPDATE products
         SET active = NOT active, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          message: "Ürün bulunamadı"
        });
      }

      return res.json(result.rows[0]);
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        message: "Ürün durumu değiştirilemedi"
      });
    }
  }
);

export default router;
