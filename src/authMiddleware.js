import jwt from "jsonwebtoken";
import pool from "./db.js";

export async function authMiddleware(req, res, next) {
  const authorization = req.headers.authorization;

  if (!authorization) {
    return res.status(401).json({
      message: "Token bulunamadı."
    });
  }

  const token = authorization.replace("Bearer ", "");

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const result = await pool.query(
      `SELECT id, email, name, role, active
       FROM users
       WHERE id = $1`,
      [decoded.id]
    );

    const user = result.rows[0];

    if (!user || !user.active) {
      return res.status(401).json({
        message: "Hesabınız aktif değil veya bulunamadı."
      });
    }

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    };

    next();
  } catch (error) {
    return res.status(401).json({
      message: "Geçersiz token."
    });
  }
}

export function roleMiddleware(...allowedRoles) {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        message: "Bu işlem için yetkiniz yok."
      });
    }

    next();
  };
}