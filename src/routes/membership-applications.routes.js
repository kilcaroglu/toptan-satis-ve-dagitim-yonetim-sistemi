
import express from "express";
import pool from "../db.js";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import {
  authMiddleware,
  roleMiddleware
} from "../authMiddleware.js";

const router = express.Router();
const adminRouter = express.Router();

// Yeni üyelik başvurusu
router.post("/", async (req, res) => {
  try {
    const {
      company_name,
      tax_number,
      contact_name,
      phone,
      address,
      district_id,
      email
    } = req.body;

    if (
      typeof company_name !== "string" || !company_name.trim() ||
      typeof tax_number !== "string" || !tax_number.trim() ||
      typeof contact_name !== "string" || !contact_name.trim() ||
      typeof phone !== "string" || !phone.trim() ||
      typeof address !== "string" || !address.trim() ||
      typeof email !== "string" || !email.trim() ||
      !Number.isInteger(Number(district_id)) ||
      Number(district_id) <= 0
    ) {
      return res.status(400).json({
        message: "Lütfen tüm başvuru alanlarını doldurun"
      });
    }

    const districtResult = await pool.query(
      `SELECT id, name, active, delivery_available
       FROM districts
       WHERE id = $1`,
      [Number(district_id)]
    );

    if (
      districtResult.rows.length === 0 ||
      !districtResult.rows[0].active
    ) {
      return res.status(400).json({
        message: "Geçerli bir ilçe seçin"
      });
    }

    const district = districtResult.rows[0];
    const applicationNumber =
      "BASV-" + randomBytes(4).toString("hex").toUpperCase();

    const status = district.delivery_available
      ? "PENDING"
      : "WAITING_FOR_DELIVERY";

    const result = await pool.query(
      `INSERT INTO membership_applications (
        application_number,
        company_name,
        tax_number,
        contact_name,
        phone,
        address,
        district_id,
        email,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING
        application_number,
        company_name,
        district_id,
        email,
        status,
        is_read,
        created_at`,
      [
        applicationNumber,
        company_name.trim(),
        tax_number.trim(),
        contact_name.trim(),
        phone.trim(),
        address.trim(),
        Number(district_id),
        email.trim().toLowerCase(),
        status
      ]
    );

    return res.status(201).json({
      message: district.delivery_available
        ? "Başvurunuz alındı. Yönetici onayı bekleniyor."
        : "Şu anda ilçenize sevkiyat hizmetimiz bulunmamaktadır. Başvurunuz kaydedildi; ilçenizde hizmet vermeye başladığımızda değerlendirilecektir.",
      application: result.rows[0]
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Üyelik başvurusu kaydedilemedi"
    });
  }
});

// Başvuru numarasıyla durum sorgulama
router.get("/:application_number", async (req, res) => {
  try {
    const applicationNumber =
      req.params.application_number.trim().toUpperCase();

    const result = await pool.query(
      `SELECT
         ma.application_number,
         ma.company_name,
         ma.status,
         ma.admin_note,
         ma.created_at,
         d.name AS district_name
       FROM membership_applications ma
       JOIN districts d ON d.id = ma.district_id
       WHERE ma.application_number = $1`,
      [applicationNumber]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Bu başvuru numarasıyla kayıt bulunamadı."
      });
    }

    const application = result.rows[0];

    const statusMessages = {
      PENDING: "Başvurunuz alındı. Yönetici onayı bekleniyor.",
      WAITING_FOR_DELIVERY:
        "İlçenizde henüz sevkiyat hizmetimiz bulunmuyor. Başvurunuz kaydedildi; hizmet başladığında değerlendirilecektir.",
      APPROVED: "Başvurunuz onaylandı.",
      REJECTED: "Başvurunuz kabul edilmedi."
    };

    return res.json({
      application,
      message: statusMessages[application.status] ??
        "Başvuru durumunuz kontrol ediliyor."
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Başvuru durumu sorgulanamadı."
    });
  }
});

// Yönetici: başvuruları listele ve filtrele
adminRouter.get(
  "/",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    try {
      const { district_id, status, is_read } = req.query;
      const conditions = [];
      const values = [];

      if (district_id) {
        values.push(district_id);
        conditions.push(`ma.district_id = $${values.length}`);
      }

      if (status) {
        const allowedStatuses = [
          "PENDING",
          "APPROVED",
          "REJECTED",
          "WAITING_FOR_DELIVERY"
        ];

        if (!allowedStatuses.includes(status)) {
          return res.status(400).json({
            message: "Geçersiz başvuru durumu"
          });
        }

        values.push(status);
        conditions.push(`ma.status = $${values.length}`);
      }

      if (is_read === "true" || is_read === "false") {
        values.push(is_read === "true");
        conditions.push(`ma.is_read = $${values.length}`);
      }

      const whereClause = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

      const result = await pool.query(
        `SELECT
           ma.id,
           ma.application_number,
           ma.company_name,
           ma.contact_name,
           ma.phone,
           ma.email,
           ma.district_id,
           d.name AS district_name,
           d.delivery_available,
           ma.status,
           ma.is_read,
           ma.created_at
         FROM membership_applications ma
         JOIN districts d ON d.id = ma.district_id
         ${whereClause}
         ORDER BY ma.is_read ASC, ma.created_at DESC`,
        values
      );

      return res.json({
        count: result.rows.length,
        applications: result.rows
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        message: "Başvurular listelenemedi"
      });
    }
  }
);

// Yönetici: başvuruyu okundu olarak işaretle
adminRouter.patch(
  "/:id/read",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    try {
      const { id } = req.params;

      const result = await pool.query(
        `UPDATE membership_applications
         SET is_read = TRUE,
             reviewed_at = NOW(),
             reviewed_by = $1,
             updated_at = NOW()
         WHERE id = $2
         RETURNING id, application_number, is_read, reviewed_at`,
        [req.user.id, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          message: "Başvuru bulunamadı"
        });
      }

      return res.json({
        message: "Başvuru okundu olarak işaretlendi",
        application: result.rows[0]
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        message: "Başvuru güncellenemedi"
      });
    }
  }
);

// Yönetici: başvuruyu onayla ve müşteri hesabını oluştur
adminRouter.patch(
  "/:id/approve",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    let client;
    let transactionStarted = false;

    try {
      const { password } = req.body;
      const applicationId = Number(req.params.id);

      if (
        !Number.isInteger(applicationId) ||
        applicationId <= 0 ||
        typeof password !== "string" ||
        password.length < 8
      ) {
        return res.status(400).json({
          message: "Geçerli başvuru ID'si ve en az 8 karakterli parola girin."
        });
      }

      client = await pool.connect();
      await client.query("BEGIN");
      transactionStarted = true;

      const applicationResult = await client.query(
        `SELECT ma.*, d.delivery_available
         FROM membership_applications ma
         JOIN districts d ON d.id = ma.district_id
         WHERE ma.id = $1
         FOR UPDATE OF ma`,
        [applicationId]
      );

      if (applicationResult.rows.length === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return res.status(404).json({
          message: "Başvuru bulunamadı."
        });
      }

      const application = applicationResult.rows[0];

      if (application.status !== "PENDING") {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return res.status(409).json({
          message: "Yalnızca bekleyen başvurular onaylanabilir."
        });
      }

      if (!application.delivery_available) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return res.status(400).json({
          message: "Bu ilçede sevkiyat hizmeti aktif değil."
        });
      }

      const passwordHash = await bcrypt.hash(password, 10);

      const userResult = await client.query(
        `INSERT INTO users
          (email, password_hash, role, name, phone)
         VALUES ($1, $2, 'CUSTOMER', $3, $4)
         RETURNING id, email, name, role, phone`,
        [
          application.email,
          passwordHash,
          application.contact_name,
          application.phone
        ]
      );

      const user = userResult.rows[0];

      await client.query(
        `INSERT INTO customers
          (user_id, company_name, tax_number, contact_name,
           phone, address, district_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          user.id,
          application.company_name,
          application.tax_number,
          application.contact_name,
          application.phone,
          application.address,
          application.district_id
        ]
      );

      await client.query(
        `UPDATE membership_applications
         SET status = 'APPROVED',
             is_read = TRUE,
             reviewed_at = NOW(),
             reviewed_by = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [req.user.id, applicationId]
      );

      await client.query("COMMIT");
      transactionStarted = false;

      return res.json({
        message: "Başvuru onaylandı ve müşteri hesabı oluşturuldu.",
        user
      });
    } catch (error) {
      if (client && transactionStarted) {
        await client.query("ROLLBACK").catch(console.error);
      }

      console.error(error);

      if (error.code === "23505") {
        return res.status(409).json({
          message: "Bu e-posta veya vergi numarasıyla kayıt zaten mevcut."
        });
      }

      return res.status(500).json({
        message: "Başvuru onaylanamadı."
      });
    } finally {
      client?.release();
    }
  }
);

// Yönetici: başvuruyu reddet
adminRouter.patch(
  "/:id/reject",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    try {
      const applicationId = Number(req.params.id);
      const { admin_note } = req.body;

      if (!Number.isInteger(applicationId) || applicationId <= 0) {
        return res.status(400).json({
          message: "Geçersiz başvuru ID'si."
        });
      }

      const result = await pool.query(
        `UPDATE membership_applications
         SET status = 'REJECTED',
             admin_note = $1,
             is_read = TRUE,
             reviewed_at = NOW(),
             reviewed_by = $2,
             updated_at = NOW()
         WHERE id = $3
           AND status = 'PENDING'
         RETURNING id, application_number, status, admin_note,
                   is_read, reviewed_at`,
        [
          typeof admin_note === "string" && admin_note.trim()
            ? admin_note.trim()
            : null,
          req.user.id,
          applicationId
        ]
      );

      if (result.rows.length === 0) {
        const exists = await pool.query(
          "SELECT id FROM membership_applications WHERE id = $1",
          [applicationId]
        );

        if (exists.rows.length === 0) {
          return res.status(404).json({
            message: "Başvuru bulunamadı."
          });
        }

        return res.status(409).json({
          message: "Yalnızca bekleyen başvurular reddedilebilir."
        });
      }

      return res.json({
        message: "Başvuru reddedildi.",
        application: result.rows[0]
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        message: "Başvuru reddedilemedi."
      });
    }
  }
);

export { adminRouter as adminMembershipApplicationsRoutes };
export default router;