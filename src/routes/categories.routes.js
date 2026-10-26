
import express from "express";
import pool from "../db.js";
import { authMiddleware } from "../authMiddleware.js";

const router = express.Router();

router.get("/", authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM categories ORDER BY id"
        );

        return res.json(result.rows);
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            message: "Kategoriler alınamadı"
        });
    }
});

export default router;