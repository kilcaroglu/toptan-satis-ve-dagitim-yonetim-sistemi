import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "./db.js";
import "dotenv/config";

export async function login(email, password) {
    const result = await pool.query(
        "SELECT * FROM users WHERE email = $1",
        [email]
    );

    const user = result.rows[0];

    if (!user) {
        return null;
    }

    const passwordCorrect = await bcrypt.compare(
        password,
        user.password_hash
    );

    if (!passwordCorrect) {
        return null;
    }

    const token = jwt.sign(
        {
            id: user.id,
            email: user.email,
            role: user.role
        },
        process.env.JWT_SECRET,
        {
            expiresIn: "12h"
        }
    );

    return {
        user,
        token
    };
}