
import express from "express";
import { login } from "../auth.js";

const router = express.Router();

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await login(email, password);

    if (!result) {
      return res.status(401).json({
        message: "Email veya şifre yanlış"
      });
    }

    return res.json({
      message: "Giriş başarılı",
      token: result.token,
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        role: result.user.role
      }
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Sunucu hatası"
    });
  }
});

export default router;
