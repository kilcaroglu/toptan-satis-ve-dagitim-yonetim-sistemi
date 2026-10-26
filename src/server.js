import express from "express";
import pool from "./db.js";
import {login} from "./auth.js";
import { authMiddleware, roleMiddleware } from "./authMiddleware.js";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";


const app = express();

app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    message: "Toptan Pro API çalışıyor",
  });
});

app.get("/test", (req, res) => {
    res.json({
        message: "Test endpointi çalışıyor"
    });
});

app.get("/test-db", async (req, res) => {
  const result = await pool.query("SELECT NOW()");

  res.json({
    time: result.rows[0].now
  });
});

app.post("/test", (req, res) => {
    console.log(req.body);

    res.json({
        message: "Veriyi aldım"
    });
});


app.post("/auth/login", async (req, res) => {
  try{
    const {email, password} = req.body;
    const result = await login(email, password);

    if (!result){
      return res.status(401).json({
        message: "Email veya şifre yanlış"
      });
    }

    res.json({
      message: "Giriş başarılı",
      token: result.token,
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        role: result.user.role
      }
    });
  }

      catch (error){
      console.error(error);
      res.status(500).json({
        message: "Sunucu hatası"
      });
    }

    
});






app.post("/admin/distributors", authMiddleware, roleMiddleware("ADMIN"), async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        message: "Ad, e-posta ve şifre zorunludur"
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        message: "Şifre en az 8 karakter olmalıdır"
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [normalizedEmail]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        message: "Bu e-posta adresi zaten kayıtlı"
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, phone)
       VALUES ($1, $2, $3, 'DRIVER', $4)
       RETURNING id, name, email, role, phone, active, created_at`,
      [name.trim(), normalizedEmail, passwordHash, phone || null]
    );

    return res.status(201).json({
      message: "Dağıtımcı hesabı oluşturuldu",
      distributor: result.rows[0]
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        message: "Bu e-posta adresi zaten kayıtlı"
      });
    }

    console.error(error);
    return res.status(500).json({
      message: "Sunucu hatası"
    });
  }
});



app.get("/private", authMiddleware, (req, res) => {
  res.json({
    message: "Gizli alana hoş geldin",
    user: req.user
  });
});


app.get("/admin-only", authMiddleware, roleMiddleware("ADMIN"), (req, res) => {
  res.json({
    message: "Admin alanına hoş geldin",
    user: req.user
  });
});









app.get("/products", authMiddleware, async (req, res) => {
  try{
    const result = await pool.query(
      `SELECT products.*, categories.name AS category_name 
      FROM products
      LEFT JOIN categories ON products.category_id = categories.id
      ORDER BY products.id`
    );

    res.json(result.rows);
  }

  catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Ürünler alınamadı"
    });
  }
});


app.post("/products", authMiddleware, roleMiddleware("ADMIN"), async (req, res) => {
  try {
    const {
      name,
      category_id,
      min_unit_label,
      unit_weight_kg,
      stock,
      price
    }  = req.body;

    const result = await pool.query(
      `INSERT INTO products
      (name, category_id, min_unit_label, unit_weight_kg, stock, price)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        name,
        category_id,
        min_unit_label,
        unit_weight_kg,
        stock,
        price      ]
    );

    res.status(201).json(result.rows[0]);
  }

  catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Ürün eklenemedi"
    });
  }
});




app.post(
  "/product-purchases",
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
           (name, category_id, min_unit_label,
            unit_weight_kg, stock, price)
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
          `SELECT id FROM products
           WHERE id = $1
           FOR UPDATE`,
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
          product_id,
          invoice_date,
          invoice_number,
          quantity,
          unit_cost,
          total_price,
          supplier_name,
          purchase_date,
          payment_method,
          stock_added
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
           SET stock = stock + $1,
               updated_at = NOW()
           WHERE id = $2
           RETURNING *`,
          [quantity, productId]
        );

        updatedProduct = stockResult.rows[0];
      }

      await client.query("COMMIT");

      res.status(201).json({
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

      res.status(500).json({
        message: "Satın alma kaydedilemedi"
      });
    } finally {
      client.release();
    }
  }
);





app.get(
  "/products/:id/purchases",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    try {
      const { id } = req.params;

      const productResult = await pool.query(
        `SELECT id, name
         FROM products
         WHERE id = $1`,
        [id]
      );

      if (productResult.rows.length === 0) {
        return res.status(404).json({
          message: "Ürün bulunamadı"
        });
      }

      const purchasesResult = await pool.query(
        `SELECT
           id,
           product_id,
           invoice_date,
           invoice_number,
           quantity,
           unit_cost,
           total_price,
           supplier_name,
           purchase_date,
           payment_method,
           stock_added,
           created_at
         FROM product_purchases
         WHERE product_id = $1
         ORDER BY purchase_date DESC, id DESC`,
        [id]
      );

      res.json({
        product: productResult.rows[0],
        purchases: purchasesResult.rows
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        message: "Satın alma geçmişi getirilemedi"
      });
    }
  }
);



app.put("/products/:id", authMiddleware, roleMiddleware("ADMIN"), async (req, res) => {
    try{
      const {id} = req.params;

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
        name = $1,
        category_id = $2,
        min_unit_label = $3,
        unit_weight_kg = $4,
        stock = $5,
        price = $6,
        updated_at = now()
        WHERE id = $7
        RETURNING *`,
        [name,
          category_id,
          min_unit_label,
          unit_weight_kg,
          stock,
          price,
          id
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          message: "Ürünn bulunamadı"
        });
      }

      res.json(result.rows[0]);
    }

    catch(error){
      console.error(error);

      res.status(500).json({
        message: "Ürün güncellenemedi"
      });
    }
});


app.patch("/products/:id/active", authMiddleware, roleMiddleware("ADMIN"), async (req, res) => {
  try{
    const {id} = req.params;

    const result = await pool.query(
      `UPDATE products
      SET active = NOT active,
      updated_at = now()
      WHERE id = $1
      RETURNING *`,
      [id]
    );

    if (result.rows.length === 0){
      return res.status(404).json({
        message: "Ürün bulunamadı"
      });
    }
    
    res.json(result.rows[0]);
  }
  catch(error) {
    console.error(error);
    
    res.status(500).json({
      message: "Ürün durumu değiştirilemedi"
    });
  }
});









app.get("/categories", authMiddleware, async (req, res) => {
  try{
    const result = await pool.query(
      "SELECT * FROM categories ORDER BY id"
    );

    res.json(result.rows);
  }

  catch (error){
    console.error(error);

    res.status(500).json({
      message: "Kategoriler alımadı"
    });
  }
});







app.get("/customers", authMiddleware, async (req, res) => {
  try{
    const result = await pool.query(
      `SELECT customers.*, districts.name AS district_name
      FROM customers Left jOIN districts ON customers.district_id = districts.id
      ORDER BY customers.id`
    )

    res.json(result.rows);
  }

  catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Müşteriler alınamadı"
    });
  }
});


app.post("/customers", authMiddleware, roleMiddleware("ADMIN"), async (req, res) => {
  try {
    const {
      company_name,
      tax_number,
      contact_name,
      phone,
      address,
      district_id
    } = req.body;

    const result = await pool.query(
      `INSERT INTO customers(
      company_name,
      tax_number,
      contact_name,
      phone,
      address,
      district_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [
        company_name,
        tax_number,
        contact_name,
        phone,
        address,
        district_id
      ]
    );

    res.status(201).json(result.rows[0]);
    }
        catch(error){
      console.error(error);
      res.status(500).json({
        message: "Müşteri eklenemedi"
      });
  }
});



app.post("/membership-applications", async (req, res) => {
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
      !company_name?.trim() ||
      !tax_number?.trim() ||
      !contact_name?.trim() ||
      !phone?.trim() ||
      !address?.trim() ||
      !email?.trim() ||
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
      [district_id]
    );

    if (districtResult.rows.length === 0 ||
        !districtResult.rows[0].active) {
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
        district_id,
        email.trim().toLowerCase(),
        status
      ]
    );

    const application = result.rows[0];

    res.status(201).json({
      message: district.delivery_available
        ? "Başvurunuz alındı. Yönetici onayı bekleniyor."
        : "Şu anda ilçenize sevkiyat hizmetimiz bulunmamaktadır. Başvurunuz kaydedildi; ilçenizde hizmet vermeye başladığımızda değerlendirilecektir.",
      application
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Üyelik başvurusu kaydedilemedi"
    });
  }
});




app.get("/membership-applications/:application_number", async (req, res) => {
  try {
    const { application_number } = req.params;

    const result = await pool.query(
      `SELECT
         ma.application_number,
         ma.company_name,
         ma.status,
         ma.created_at,
         d.name AS district_name
       FROM membership_applications ma
       JOIN districts d ON d.id = ma.district_id
       WHERE ma.application_number = $1`,
      [application_number]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Bu başvuru numarasıyla eşleşen başvuru bulunamadı."
      });
    }

    const application = result.rows[0];

    const statusMessages = {
      PENDING: "Başvurunuz alındı. Yönetici onayı bekleniyor.",
      WAITING_FOR_DELIVERY:
        "İlçenizde henüz sevkiyat hizmetimiz bulunmuyor. Başvurunuz kaydedildi; hizmet başladığında değerlendirilecek.",
      APPROVED:
        "Üyelik başvurunuz onaylandı. Hesap bilgileriniz için firmayla iletişime geçebilirsiniz.",
      REJECTED:
        "Üyelik başvurunuz reddedildi. Ayrıntılı bilgi için firmayla iletişime geçebilirsiniz."
    };

    res.json({
      application_number: application.application_number,
      company_name: application.company_name,
      district_name: application.district_name,
      status: application.status,
      message: statusMessages[application.status],
      created_at: application.created_at
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Başvuru durumu sorgulanamadı."
    });
  }
});




app.get("/membership-applications/:application_number", async (req, res) => {
  try {
    const { application_number } = req.params;

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
      [application_number.trim().toUpperCase()]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Bu başvuru numarasıyla kayıt bulunamadı."
      });
    }

    const application = result.rows[0];

    let message = "Başvurunuz yönetici tarafından incelenmeyi bekliyor.";

    if (application.status === "WAITING_FOR_DELIVERY") {
      message =
        "İlçenizde henüz sevkiyat hizmetimiz bulunmuyor. Başvurunuz kaydedildi; hizmet başladığında değerlendirilecektir.";
    } else if (application.status === "APPROVED") {
      message = "Başvurunuz onaylandı.";
    } else if (application.status === "REJECTED") {
      message = "Başvurunuz kabul edilmedi.";
    }

    res.json({
      application,
      message
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Başvuru durumu sorgulanamadı."
    });
  }
});




app.get(
  "/admin/membership-applications",
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

      res.json({
        count: result.rows.length,
        applications: result.rows
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        message: "Başvurular listelenemedi"
      });
    }
  }
);




app.patch(
  "/admin/membership-applications/:id/read",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    try {
      const { id } = req.params;

      const result = await pool.query(
        `UPDATE membership_applications
         SET
           is_read = TRUE,
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

      res.json({
        message: "Başvuru okundu olarak işaretlendi",
        application: result.rows[0]
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        message: "Başvuru güncellenemedi"
      });
    }
  }
);


app.put("/customers/:id", authMiddleware, roleMiddleware("ADMIN"), async (req, res) => {
  try{
    const {id} = req.params;
    const {
      company_name,
      tax_number,
      contact_name,
      phone,
      address,
      district_id
    } = req.body;

    const result = await pool.query(
      `UPDATE customers SET
      company_name = $1,
      tax_number = $2,
      contact_name = $3,
      phone = $4,
      address = $5,
      district_id =$6
      WHERE id = $7 
      RETURNING *`,
      [
        company_name,
        tax_number,
        contact_name,
        phone,
        address,
        district_id,
        id
      ]
    );

    if (result.rows.length === 0){
      return res.status(404).json({
        message: "Müşteri bulunamadı"
      });
    }

    res.json(result.rows[0]);
  }catch(error){
    console.error(error);

    res.status(500).json({
      message: "Müşteri güncellenemedi"
    });
  }
});



app.patch("/customers/:id/active", authMiddleware, roleMiddleware("ADMIN"), async(req, res) => {
  try{
    const {id} = req.params;

    const result = await pool.query(
      `UPDATE customers 
      SET active = NOT active
      WHERE id = $1
      RETURNING *`,
      [id]
    );

    if (result.rows.length === 0){
      return res.status(404).json({
        message: "Müşteri bulunamadı"
      });
    }

    res.json(result.rows[0]);


  }catch (error){
    console.error(error);

    res.status(500).json({
      message: "Müşteri durumu değiştirilemedi"
    });
  }
});




app.post(
    "/customers/create-account",
    authMiddleware,
    roleMiddleware("ADMIN"),
    async (req, res) => {
        try {
            const {
                email,
                password,
                name,
                phone,
                company_name,
                tax_number,
                contact_name,
                address,
                district_id
            } = req.body;

            const passwordHash = await bcrypt.hash(password, 10);

            const userResult = await pool.query(
                `INSERT INTO users
                (
                    email,
                    password_hash,
                    role,
                    name,
                    phone
                )
                VALUES ($1, $2, 'CUSTOMER', $3, $4)
                RETURNING id, email, name, role, phone`,
                [
                    email,
                    passwordHash,
                    name,
                    phone
                ]
            );

            const user = userResult.rows[0];

            const customerResult = await pool.query(
                `INSERT INTO customers
                (
                    user_id,
                    company_name,
                    tax_number,
                    contact_name,
                    phone,
                    address,
                    district_id
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING *`,
                [
                    user.id,
                    company_name,
                    tax_number,
                    contact_name,
                    phone,
                    address,
                    district_id
                ]
            );

            res.status(201).json({
                user,
                customer: customerResult.rows[0]
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                message: "Müşteri hesabı oluşturulamadı"
            });
        }
    }
);




app.patch(
  "/admin/membership-applications/:id/approve",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    const client = await pool.connect();

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

      await client.query("BEGIN");

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
        return res.status(404).json({
          message: "Başvuru bulunamadı."
        });
      }

      const application = applicationResult.rows[0];

      if (application.status !== "PENDING") {
        await client.query("ROLLBACK");
        return res.status(409).json({
          message: "Yalnızca bekleyen başvurular onaylanabilir."
        });
      }

      if (!application.delivery_available) {
        await client.query("ROLLBACK");
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

      res.json({
        message: "Başvuru onaylandı ve müşteri hesabı oluşturuldu.",
        user
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(error);

      if (error.code === "23505") {
        return res.status(409).json({
          message: "Bu e-posta veya vergi numarasıyla kayıt zaten mevcut."
        });
      }

      res.status(500).json({
        message: "Başvuru onaylanamadı."
      });
    } finally {
      client.release();
    }
  }
);




app.patch(
  "/admin/membership-applications/:id/reject",
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

      res.json({
        message: "Başvuru reddedildi.",
        application: result.rows[0]
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        message: "Başvuru reddedilemedi."
      });
    }
  }
);






app.post("/routes", authMiddleware, roleMiddleware("ADMIN"), async (req,res) => {
  try{
    const {
      name,
      delivery_day,
      order_deadline_day,
      order_deadline_time
    } = req.body;

    const result = await pool.query(
      `INSERT INTO routes(
      name,
      delivery_day,
      order_deadline_day,
      order_deadline_time
      )
      VALUES ($1,$2,$3,$4)
      RETURNING *`,
      [
        name,
        delivery_day,
        order_deadline_day,
        order_deadline_time
      ]
    );


    res.status(201).json(result.rows[0]);


  }

  catch(error){

    console.error(error);

    res.status(500).json({
      message: "Rota oluşturulamadı"
    });
  }
});




app.post(
  "/routes/:id/districts",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    try {
      const routeId = Number(req.params.id);
      const districtId = Number(req.body.district_id);

      if (
        !Number.isInteger(routeId) ||
        routeId <= 0 ||
        !Number.isInteger(districtId) ||
        districtId <= 0
      ) {
        return res.status(400).json({
          message: "Geçerli rota ve ilçe ID'si girin."
        });
      }

      const routeResult = await pool.query(
        "SELECT id FROM routes WHERE id = $1",
        [routeId]
      );

      if (routeResult.rows.length === 0) {
        return res.status(404).json({
          message: "Rota bulunamadı."
        });
      }

      const districtResult = await pool.query(
        `SELECT id, name, active, delivery_available
         FROM districts
         WHERE id = $1`,
        [districtId]
      );

      if (districtResult.rows.length === 0) {
        return res.status(404).json({
          message: "İlçe bulunamadı."
        });
      }

      const district = districtResult.rows[0];

      if (!district.active) {
        return res.status(400).json({
          message: "Pasif ilçeler rotaya eklenemez."
        });
      }

      if (!district.delivery_available) {
        return res.status(400).json({
          message: "Bu ilçede sevkiyat hizmeti aktif değil."
        });
      }

      const result = await pool.query(
        `INSERT INTO route_districts (route_id, district_id)
         VALUES ($1, $2)
         RETURNING *`,
        [routeId, districtId]
      );

      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error(error);

      if (error.code === "23505") {
        return res.status(409).json({
          message: "Bu ilçe zaten rotaya eklenmiş."
        });
      }

      res.status(500).json({
        message: "İlçe rotaya eklenemedi."
      });
    }
  }
);




app.get(
    "/routes",
    authMiddleware,
    async (req, res) => {
        try {
            const result = await pool.query(
                `SELECT
                    routes.id,
                    routes.name,
                    routes.delivery_day,
                    routes.order_deadline_day,
                    routes.order_deadline_time,
                    routes.active,
                    routes.created_at,
                    COALESCE(
                        json_agg(
                            json_build_object(
                                'id', districts.id,
                                'name', districts.name
                            )
                        ) FILTER (WHERE districts.id IS NOT NULL),
                        '[]'
                    ) AS districts
                FROM routes
                LEFT JOIN route_districts
                    ON routes.id = route_districts.route_id
                LEFT JOIN districts
                    ON route_districts.district_id = districts.id
                GROUP BY routes.id
                ORDER BY routes.id`
            );

            res.json(result.rows);

        } catch (error) {
            console.error(error);

            res.status(500).json({
                message: "Rotalar alınamadı"
            });
        }
    }
);



app.put(
  "/routes/:id/districts",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    const client = await pool.connect();

    try {
      const routeId = Number(req.params.id);
      const { district_ids } = req.body;

      if (
        !Number.isInteger(routeId) ||
        routeId <= 0 ||
        !Array.isArray(district_ids) ||
        district_ids.some(
          id => !Number.isInteger(Number(id)) || Number(id) <= 0
        )
      ) {
        return res.status(400).json({
          message: "Geçerli rota ID'si ve ilçe ID'leri listesi gönderin."
        });
      }

      const districtIds = district_ids.map(Number);

      if (new Set(districtIds).size !== districtIds.length) {
        return res.status(400).json({
          message: "Aynı ilçe birden fazla kez eklenemez."
        });
      }

      await client.query("BEGIN");

      const routeResult = await client.query(
        "SELECT id FROM routes WHERE id = $1 FOR UPDATE",
        [routeId]
      );

      if (routeResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          message: "Rota bulunamadı."
        });
      }

      if (districtIds.length > 0) {
        const districtResult = await client.query(
          `SELECT id, name, active, delivery_available
           FROM districts
           WHERE id = ANY($1::int[])`,
          [districtIds]
        );

        if (districtResult.rows.length !== districtIds.length) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            message: "Listede geçersiz bir ilçe ID'si var."
          });
        }

        const unavailableDistricts = districtResult.rows.filter(
          district => !district.active || !district.delivery_available
        );

        if (unavailableDistricts.length > 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            message: "Pasif veya sevkiyat yapılmayan ilçeler rotaya eklenemez.",
            districts: unavailableDistricts.map(district => ({
              id: district.id,
              name: district.name,
              active: district.active,
              delivery_available: district.delivery_available
            }))
          });
        }
      }

      await client.query(
        "DELETE FROM route_districts WHERE route_id = $1",
        [routeId]
      );

      for (const districtId of districtIds) {
        await client.query(
          `INSERT INTO route_districts (route_id, district_id)
           VALUES ($1, $2)`,
          [routeId, districtId]
        );
      }

      await client.query("COMMIT");

      res.json({
        message: "Rota ilçeleri güncellendi.",
        district_ids: districtIds
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(error);

      res.status(500).json({
        message: "Rota ilçeleri güncellenemedi."
      });
    } finally {
      client.release();
    }
  }
);









app.post(
    "/shipments",
    authMiddleware,
    roleMiddleware("ADMIN"),
    async (req, res) => {
        try {
            const {
                route_id,
                shipment_date,
                vehicle_plate,
                driver_name,
                distributor_name
            } = req.body;

            const result = await pool.query(
                `INSERT INTO shipments
                (
                    route_id,
                    shipment_date,
                    vehicle_plate,
                    driver_name,
                    distributor_name
                )
                VALUES ($1, $2, $3, $4, $5)
                RETURNING *`,
                [
                    route_id,
                    shipment_date,
                    vehicle_plate,
                    driver_name,
                    distributor_name
                ]
            );

            res.status(201).json(result.rows[0]);

        } catch (error) {
            console.error(error);

            res.status(500).json({
                message: "Sevkiyat oluşturulamadı"
            });
        }
    }
);




app.post(
    "/shipments/:id/distributors",
    authMiddleware,
    roleMiddleware("ADMIN"),
    async (req, res) => {
        const client = await pool.connect();

        try {
            const shipmentId = Number(req.params.id);
            const { driver_ids } = req.body;

            if (!Number.isInteger(shipmentId) || shipmentId <= 0) {
                return res.status(400).json({
                    message: "Geçersiz sevkiyat numarası"
                });
            }

            if (
                !Array.isArray(driver_ids) ||
                driver_ids.length === 0 ||
                !driver_ids.every(
                    id => Number.isInteger(id) && id > 0
                )
            ) {
                return res.status(400).json({
                    message: "En az bir geçerli dağıtımcı ID'si gönderilmelidir"
                });
            }

            const uniqueDriverIds = [...new Set(driver_ids)];

            await client.query("BEGIN");

            const shipment = await client.query(
                "SELECT id FROM shipments WHERE id = $1 FOR UPDATE",
                [shipmentId]
            );

            if (shipment.rows.length === 0) {
                await client.query("ROLLBACK");

                return res.status(404).json({
                    message: "Sevkiyat bulunamadı"
                });
            }

            const drivers = await client.query(
                `SELECT id
                 FROM users
                 WHERE id = ANY($1::int[])
                   AND role = 'DRIVER'
                   AND active = true`,
                [uniqueDriverIds]
            );

            if (drivers.rows.length !== uniqueDriverIds.length) {
                await client.query("ROLLBACK");

                return res.status(400).json({
                    message: "Dağıtımcı ID'lerinden biri geçersiz, pasif veya DRIVER rolünde değil"
                });
            }

            for (const driverId of uniqueDriverIds) {
                await client.query(
                    `INSERT INTO shipment_drivers
                        (shipment_id, user_id, assigned_by)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (shipment_id, user_id)
                     DO NOTHING`,
                    [shipmentId, driverId, req.user.id]
                );
            }

            const assignments = await client.query(
                `SELECT
                    u.id,
                    u.name,
                    u.email,
                    sd.assigned_at,
                    sd.assigned_by
                 FROM shipment_drivers sd
                 JOIN users u ON u.id = sd.user_id
                 WHERE sd.shipment_id = $1
                 ORDER BY u.name`,
                [shipmentId]
            );

            await client.query("COMMIT");

            return res.status(200).json({
                message: "Dağıtımcı atamaları kaydedildi",
                shipment_id: shipmentId,
                distributors: assignments.rows
            });
        } catch (error) {
            await client.query("ROLLBACK");
            console.error(error);

            return res.status(500).json({
                message: "Dağıtımcı ataması yapılamadı"
            });
        } finally {
            client.release();
        }
    }
);




app.get(
    "/shipments",
    authMiddleware,
    async (req, res) => {
        try {
            let result;

            if (req.user.role === "ADMIN") {
                result = await pool.query(
                    `SELECT
                        s.*,
                        r.name AS route_name
                     FROM shipments s
                     INNER JOIN routes r ON s.route_id = r.id
                     ORDER BY s.shipment_date, s.id`
                );
            } else if (req.user.role === "DRIVER") {
                result = await pool.query(
                    `SELECT
                        s.*,
                        r.name AS route_name
                     FROM shipments s
                     INNER JOIN routes r ON s.route_id = r.id
                     INNER JOIN shipment_drivers sd
                        ON sd.shipment_id = s.id
                     WHERE sd.user_id = $1
                     ORDER BY s.shipment_date, s.id`,
                    [req.user.id]
                );
            } else {
                return res.status(403).json({
                    message: "Sevkiyat listesini görme yetkiniz yok"
                });
            }

            return res.json(result.rows);
        } catch (error) {
            console.error(error);

            return res.status(500).json({
                message: "Sevkiyatlar alınamadı"
            });
        }
    }
);


app.put(
    "/shipments/:id",
    authMiddleware,
    roleMiddleware("ADMIN"),
    async (req, res) => {
        try {
            const { id } = req.params;

            const {
                route_id,
                shipment_date,
                vehicle_plate,
                driver_name,
                distributor_name
            } = req.body;

            const result = await pool.query(
                `UPDATE shipments
                 SET
                    route_id = $1,
                    shipment_date = $2,
                    vehicle_plate = $3,
                    driver_name = $4,
                    distributor_name = $5
                 WHERE id = $6
                 RETURNING *`,
                [
                    route_id,
                    shipment_date,
                    vehicle_plate,
                    driver_name,
                    distributor_name,
                    id
                ]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    message: "Sevkiyat bulunamadı"
                });
            }

            res.json(result.rows[0]);

        } catch (error) {
            console.error(error);

            res.status(500).json({
                message: "Sevkiyat güncellenemedi"
            });
        }
    }
);



app.patch(
    "/shipments/:id/status",
    authMiddleware,
    roleMiddleware("ADMIN"),
    async (req, res) => {
        try {
            const { id } = req.params;
            const { status } = req.body;

            const result = await pool.query(
                `UPDATE shipments
                 SET status = $1
                 WHERE id = $2
                 RETURNING *`,
                [
                    status,
                    id
                ]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    message: "Sevkiyat bulunamadı"
                });
            }

            res.json(result.rows[0]);

        } catch (error) {
            console.error(error);

            res.status(500).json({
                message: "Sevkiyat durumu güncellenemedi"
            });
        }
    }
);






app.post(
    "/orders",
    authMiddleware,
    roleMiddleware("CUSTOMER"),
    async (req, res) => {
        const client = await pool.connect();

        try {
            const { shipment_id, items } = req.body;

            // Gelen bilgileri kontrol et
            if (
                !shipment_id ||
                !Array.isArray(items) ||
                items.length === 0
            ) {
                return res.status(400).json({
                    message: "Sevkiyat ve ürünler gereklidir"
                });
            }

            // Giriş yapan kullanıcının müşteri kaydını bul
            const customerResult = await client.query(
                `SELECT id, district_id
                 FROM customers
                 WHERE user_id = $1
                   AND active = TRUE`,
                [req.user.id]
            );

            if (customerResult.rows.length === 0) {
                return res.status(403).json({
                    message: "Aktif müşteri kaydı bulunamadı"
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
                [shipment_id, customer.district_id]
            );

            if (shipmentResult.rows.length === 0) {
                await client.query("ROLLBACK");

                return res.status(400).json({
                    message: "Bu sevkiyat müşteriniz için uygun değil"
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
                    shipment.order_deadline_day
                ]
            );

            const deadlineDate = deadlineResult.rows[0].deadline_date;

            const deadlineCheck = await client.query(
                `SELECT
                    (
                        ($1::date + $2::time)
                        >=
                        (now() AT TIME ZONE 'Europe/Istanbul')
                    ) AS still_open`,
                [
                    deadlineDate,
                    shipment.order_deadline_time
                ]
            );

            if (!deadlineCheck.rows[0].still_open) {
                await client.query("ROLLBACK");

                return res.status(400).json({
                    message: "Bu sevkiyat için sipariş süresi dolmuş"
                });
            }


            // Siparişi oluştur
            const orderResult = await client.query(
                `INSERT INTO orders
                    (customer_id, shipment_id, status, total_amount)
                 VALUES ($1, $2, 'PENDING', 0)
                 RETURNING *`,
                [customer.id, shipment.id]
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
                    [productId]
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
                    [
                        order.id,
                        product.id,
                        quantity,
                        unitPrice
                    ]
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
                [totalAmount, order.id]
            );

            await client.query("COMMIT");

            res.status(201).json({
                message: "Sipariş başarıyla oluşturuldu",
                order: updatedOrder.rows[0]
            });

        } catch (error) {
            await client.query("ROLLBACK");

            console.error(error);

            res.status(500).json({
                message: "Sipariş oluşturulamadı"
            });

        } finally {
            client.release();
        }
    }
);






app.get(
    "/my-orders",
    authMiddleware,
    roleMiddleware("CUSTOMER"),
    async (req, res) => {
        try {
            const result = await pool.query(
                `SELECT
                    orders.id,
                    orders.status,
                    orders.total_amount,
                    orders.created_at,
                    orders.updated_at,
                    shipments.shipment_date,
                    routes.name AS route_name
                 FROM orders
                 INNER JOIN customers
                    ON orders.customer_id = customers.id
                 INNER JOIN shipments
                    ON orders.shipment_id = shipments.id
                 INNER JOIN routes
                    ON shipments.route_id = routes.id
                 WHERE customers.user_id = $1
                 ORDER BY orders.created_at DESC`,
                [req.user.id]
            );

            res.json(result.rows);

        } catch (error) {
            console.error(error);

            res.status(500).json({
                message: "Siparişleriniz alınamadı"
            });
        }
    }
);






app.get(
    "/orders",
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
                 ORDER BY orders.created_at DESC`
            );

            res.json(result.rows);

        } catch (error) {
            console.error(error);

            res.status(500).json({
                message: "Siparişler alınamadı"
            });
        }
    }
);








app.get(
    "/distributor/shipments/:id/orders",
    authMiddleware,
    roleMiddleware("DRIVER"),
    async (req, res) => {
        try {
            const shipmentId = Number(req.params.id);

            if (!Number.isInteger(shipmentId) || shipmentId <= 0) {
                return res.status(400).json({
                    message: "Geçersiz sevkiyat numarası"
                });
            }

            const result = await pool.query(
                `SELECT
                    o.id AS order_id,
                    o.shipment_id,
                    o.status,
                    o.total_amount,
                    o.created_at,
                    c.company_name,
                    c.address,
                    c.phone
                 FROM orders o
                 INNER JOIN customers c
                    ON c.id = o.customer_id
                 INNER JOIN shipment_drivers sd
                    ON sd.shipment_id = o.shipment_id
                 WHERE o.shipment_id = $1
                   AND sd.user_id = $2
                 ORDER BY o.id`,
                [shipmentId, req.user.id]
            );

            return res.json(result.rows);
        } catch (error) {
            console.error(error);

            return res.status(500).json({
                message: "Sevkiyat siparişleri alınamadı"
            });
        }
    }
);



app.patch(
    "/distributor/orders/:id/deliver",
    authMiddleware,
    roleMiddleware("DRIVER"),
    async (req, res) => {
        const client = await pool.connect();
        let transactionStarted = false;

        try {
            const orderId = Number(req.params.id);

            if (!Number.isInteger(orderId) || orderId <= 0) {
                return res.status(400).json({
                    message: "Geçersiz sipariş numarası"
                });
            }

            await client.query("BEGIN");
            transactionStarted = true;

            // Siparişin bu dağıtıcıya atanmış bir sevkiyatta
            // bulunduğunu doğrula ve siparişi kilitle.
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
                [orderId, req.user.id]
            );

            if (orderResult.rows.length === 0) {
                await client.query("ROLLBACK");
                transactionStarted = false;

                return res.status(404).json({
                    message: "Sipariş bulunamadı veya bu sevkiyata atanmadınız"
                });
            }

            const order = orderResult.rows[0];

            if (order.status !== "ON_THE_WAY") {
                await client.query("ROLLBACK");
                transactionStarted = false;

                return res.status(400).json({
                    message: "Yalnızca teslimata çıkmış siparişler teslim edildi olarak işaretlenebilir",
                    current_status: order.status
                });
            }

            // Cari hesap borcu ve sipariş durumu aynı
            // transaction içinde güncellenir.
            await client.query(
                `INSERT INTO current_account_transactions
                    (customer_id, order_id, transaction_type,
                     amount, description, created_by)
                 VALUES ($1, $2, 'DEBIT', $3, $4, $5)`,
                [
                    order.customer_id,
                    orderId,
                    order.total_amount,
                    `Teslim edilen sipariş #${orderId}`,
                    req.user.id
                ]
            );

            const updateResult = await client.query(
                `UPDATE orders
                 SET status = 'DELIVERED',
                     updated_at = now()
                 WHERE id = $1
                   AND status = 'ON_THE_WAY'
                 RETURNING *`,
                [orderId]
            );

            if (updateResult.rows.length === 0) {
                throw new Error("Sipariş durumu güncellenemedi");
            }

            await client.query("COMMIT");
            transactionStarted = false;

            return res.json({
                message: "Sipariş teslim edildi olarak kaydedildi",
                order: updateResult.rows[0]
            });
        } catch (error) {
            if (transactionStarted) {
                await client.query("ROLLBACK");
            }

            if (error.code === "23505") {
                return res.status(409).json({
                    message: "Bu sipariş için daha önce cari hesap borcu kaydedilmiş"
                });
            }

            console.error(error);

            return res.status(500).json({
                message: "Teslimat onaylanamadı"
            });
        } finally {
            client.release();
        }
    }
);



app.patch(
    "/orders/:id/status",
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
                "CANCELLED"
            ];

            if (
                !Number.isInteger(orderId) ||
                orderId <= 0 ||
                !allowedStatuses.includes(status)
            ) {
                return res.status(400).json({
                    message: "Sipariş numarası veya durumu geçersiz"
                });
            }

            await client.query("BEGIN");

            const orderResult = await client.query(
                `SELECT id, customer_id, total_amount, status, stock_deducted
                 FROM orders
                 WHERE id = $1
                 FOR UPDATE`,
                [orderId]
            );

            if (orderResult.rows.length === 0) {
                await client.query("ROLLBACK");

                return res.status(404).json({
                    message: "Sipariş bulunamadı"
                });
            }

            const order = orderResult.rows[0];


            
            const allowedTransitions = {
                PENDING: ["APPROVED", "CANCELLED"],
                APPROVED: ["PREPARING", "CANCELLED"],
                PREPARING: ["ON_THE_WAY", "CANCELLED"],
                ON_THE_WAY: ["DELIVERED"],
                DELIVERED: [],
                CANCELLED: []
            };

            if (!allowedTransitions[order.status].includes(status)) {
                await client.query("ROLLBACK");

                return res.status(400).json({
                    message: `Sipariş durumu ${order.status} durumundan ${status} durumuna geçirilemez`
                });
            }


            if (order.status === status) {
                await client.query("COMMIT");

                return res.json({
                    message: "Sipariş zaten bu durumda",
                    order
                });
            }


            // Sipariş onaylanırken stoktan düş.
            if (status === "APPROVED" && !order.stock_deducted) {
                const itemsResult = await client.query(
                    `SELECT product_id, quantity
                     FROM order_items
                     WHERE order_id = $1`,
                    [orderId]
                );

                if (itemsResult.rows.length === 0) {
                    await client.query("ROLLBACK");

                    return res.status(400).json({
                        message: "Ürünü olmayan sipariş onaylanamaz"
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
                        [item.quantity, item.product_id]
                    );

                    if (stockResult.rows.length === 0) {
                        await client.query("ROLLBACK");

                        return res.status(400).json({
                            message: `Ürün ID ${item.product_id} için stok yetersiz veya ürün pasif`
                        });
                    }
                }

                await client.query(
                    `UPDATE orders
                     SET stock_deducted = TRUE
                     WHERE id = $1`,
                    [orderId]
                );
            }

            // Stok daha önce düşülmüşse iptal sırasında geri ekle.
            if (status === "CANCELLED" && order.stock_deducted) {
                const itemsResult = await client.query(
                    `SELECT product_id, quantity
                     FROM order_items
                     WHERE order_id = $1`,
                    [orderId]
                );

                for (const item of itemsResult.rows) {
                    await client.query(
                        `UPDATE products
                         SET stock = stock + $1,
                             updated_at = now()
                         WHERE id = $2`,
                        [item.quantity, item.product_id]
                    );
                }

                await client.query(
                    `UPDATE orders
                     SET stock_deducted = FALSE
                     WHERE id = $1`,
                    [orderId]
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
                  req.user.id
                ]
              );
            }

            const result = await client.query(
                `UPDATE orders
                 SET status = $1,
                     updated_at = now()
                 WHERE id = $2
                 RETURNING *`,
                [status, orderId]
            );

            await client.query("COMMIT");

            res.json({
                message: "Sipariş durumu güncellendi",
                order: result.rows[0]
            });

        } catch (error) {
            await client.query("ROLLBACK");

            console.error(error);

            res.status(500).json({
                message: "Sipariş durumu güncellenemedi"
            });
        } finally {
            client.release();
        }
    }
);











app.get(
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
                [id]
            );

            res.json(result.rows);

        } catch (error) {
            console.error(error);

            res.status(500).json({
                message: "Sipariş ürünleri alınamadı"
            });
        }
    }
);






app.patch(
    "/orders/:orderId/items/:itemId",
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
                    message: "Sipariş, ürün veya miktar bilgisi geçersiz"
                });
            }

            await client.query("BEGIN");
            transactionStarted = true;

            const orderResult = await client.query(
                `SELECT id, status, stock_deducted
                 FROM orders
                 WHERE id = $1
                 FOR UPDATE`,
                [orderId]
            );

            if (orderResult.rows.length === 0) {
                await client.query("ROLLBACK");
                transactionStarted = false;

                return res.status(404).json({
                    message: "Sipariş bulunamadı"
                });
            }

            const order = orderResult.rows[0];

            if (
                ["DELIVERED", "CANCELLED"].includes(order.status)
            ) {
                await client.query("ROLLBACK");
                transactionStarted = false;

                return res.status(400).json({
                    message: "Tamamlanmış veya iptal edilmiş sipariş düzenlenemez"
                });
            }

            const itemResult = await client.query(
                `SELECT id, product_id, quantity
                 FROM order_items
                 WHERE id = $1 AND order_id = $2
                 FOR UPDATE`,
                [itemId, orderId]
            );

            if (itemResult.rows.length === 0) {
                await client.query("ROLLBACK");
                transactionStarted = false;

                return res.status(404).json({
                    message: "Sipariş ürünü bulunamadı"
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
                        [difference, item.product_id]
                    );

                    if (stockResult.rows.length === 0) {
                        await client.query("ROLLBACK");
                        transactionStarted = false;

                        return res.status(400).json({
                            message: "Ek miktar için stok yetersiz veya ürün pasif"
                        });
                    }
                } else {
                    // Miktar azalıyor: kullanılmayan stoğu geri ekle.
                    await client.query(
                        `UPDATE products
                         SET stock = stock + $1,
                             updated_at = now()
                         WHERE id = $2`,
                        [-difference, item.product_id]
                    );
                }
            }

            const updatedItem = await client.query(
                `UPDATE order_items
                 SET quantity = $1
                 WHERE id = $2 AND order_id = $3
                 RETURNING *`,
                [quantity, itemId, orderId]
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
                [orderId]
            );

            await client.query("COMMIT");
            transactionStarted = false;

            res.json({
                message: "Sipariş miktarı ve toplam tutar güncellendi",
                item: updatedItem.rows[0],
                total_amount: totalResult.rows[0].total_amount
            });

        } catch (error) {
            if (transactionStarted) {
                await client.query("ROLLBACK");
            }

            console.error(error);

            res.status(500).json({
                message: "Sipariş miktarı güncellenemedi"
            });

        } finally {
            client.release();
        }
    }
);






app.post(
    "/orders/:id/items",
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
                    message: "Sipariş, ürün veya miktar bilgileri geçersiz"
                });
            }

            await client.query("BEGIN");
            transactionStarted = true;

            const orderResult = await client.query(
                `SELECT id, status, stock_deducted
                 FROM orders
                 WHERE id = $1
                 FOR UPDATE`,
                [orderId]
            );

            if (orderResult.rows.length === 0) {
                await client.query("ROLLBACK");
                transactionStarted = false;

                return res.status(404).json({
                    message: "Sipariş bulunamadı"
                });
            }

            const order = orderResult.rows[0];

            if (
                ["DELIVERED", "CANCELLED"].includes(order.status)
            ) {
                await client.query("ROLLBACK");
                transactionStarted = false;

                return res.status(400).json({
                    message: "Bu siparişe ürün eklenemez"
                });
            }

            const productResult = await client.query(
                `SELECT id, price
                 FROM products
                 WHERE id = $1
                   AND active = TRUE`,
                [productId]
            );

            if (productResult.rows.length === 0) {
                await client.query("ROLLBACK");
                transactionStarted = false;

                return res.status(404).json({
                    message: "Ürün bulunamadı veya pasif"
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
                    [quantity, product.id]
                );

                if (stockResult.rows.length === 0) {
                    await client.query("ROLLBACK");
                    transactionStarted = false;

                    return res.status(400).json({
                        message: "Ürün stoğu yetersiz veya ürün pasif"
                    });
                }
            }

            const itemResult = await client.query(
                `INSERT INTO order_items
                    (order_id, product_id, quantity, unit_price)
                 VALUES ($1, $2, $3, $4)
                 RETURNING *`,
                [
                    orderId,
                    product.id,
                    quantity,
                    product.price
                ]
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
                [orderId]
            );

            await client.query("COMMIT");
            transactionStarted = false;

            res.status(201).json({
                message: "Ürün siparişe eklendi",
                item: itemResult.rows[0],
                total_amount: totalResult.rows[0].total_amount
            });

        } catch (error) {
            if (transactionStarted) {
                await client.query("ROLLBACK");
            }

            console.error(error);

            res.status(500).json({
                message: "Siparişe ürün eklenemedi"
            });

        } finally {
            client.release();
        }
    }
);




app.delete(
    "/orders/:orderId/items/:itemId",
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
                    message: "Geçersiz sipariş veya ürün satırı ID'si"
                });
            }

            await client.query("BEGIN");
            transactionStarted = true;

            const orderResult = await client.query(
                `SELECT id, status, stock_deducted
                 FROM orders
                 WHERE id = $1
                 FOR UPDATE`,
                [orderId]
            );

            if (orderResult.rows.length === 0) {
                await client.query("ROLLBACK");
                transactionStarted = false;

                return res.status(404).json({
                    message: "Sipariş bulunamadı"
                });
            }

            const order = orderResult.rows[0];

            if (["DELIVERED", "CANCELLED"].includes(order.status)) {
                await client.query("ROLLBACK");
                transactionStarted = false;

                return res.status(400).json({
                    message: "Teslim edilmiş veya iptal edilmiş sipariş değiştirilemez"
                });
            }

            const itemResult = await client.query(
                `SELECT id, product_id, quantity
                 FROM order_items
                 WHERE id = $1 AND order_id = $2
                 FOR UPDATE`,
                [itemId, orderId]
            );

            if (itemResult.rows.length === 0) {
                await client.query("ROLLBACK");
                transactionStarted = false;

                return res.status(404).json({
                    message: "Sipariş ürün satırı bulunamadı"
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
                    [item.quantity, item.product_id]
                );
            }

            await client.query(
                `DELETE FROM order_items
                 WHERE id = $1 AND order_id = $2`,
                [itemId, orderId]
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
                [orderId]
            );

            await client.query("COMMIT");
            transactionStarted = false;

            return res.json({
                message: "Ürün siparişten silindi",
                order_id: orderId,
                deleted_item_id: itemId,
                stock_returned: order.stock_deducted,
                total_amount: totalResult.rows[0].total_amount
            });
        } catch (error) {
            if (transactionStarted) {
                await client.query("ROLLBACK");
            }

            console.error("Sipariş ürün silme hatası:", error);

            return res.status(500).json({
                message: "Sunucu hatası"
            });
        } finally {
            client.release();
        }
    }
);





app.get(
    "/my-orders/:id/items",
    authMiddleware,
    roleMiddleware("CUSTOMER"),
    async (req, res) => {
        try {
            const orderId = Number(req.params.id);
            const userId = req.user.id;

            const result = await pool.query(
                `SELECT
                    oi.id,
                    oi.product_id,
                    p.name AS product_name,
                    oi.quantity,
                    oi.unit_price,
                    oi.quantity * oi.unit_price AS line_total
                 FROM order_items oi
                 JOIN products p ON p.id = oi.product_id
                 JOIN orders o ON o.id = oi.order_id
                 JOIN customers c ON c.id = o.customer_id
                 WHERE o.id = $1
                   AND c.user_id = $2
                 ORDER BY oi.id`,
                [orderId, userId]
            );

            const orderResult = await pool.query(
                `SELECT o.id
                 FROM orders o
                 JOIN customers c ON c.id = o.customer_id
                 WHERE o.id = $1
                   AND c.user_id = $2`,
                [orderId, userId]
            );

            if (orderResult.rows.length === 0) {
                return res.status(404).json({
                    message: "Sipariş bulunamadı"
                });
            }

            res.json(result.rows);
        } catch (error) {
            console.error(error);

            res.status(500).json({
                message: "Sipariş ürünleri getirilemedi"
            });
        }
    }
);






app.patch(
  "/customers/change-password",
  authMiddleware,
  roleMiddleware("CUSTOMER"),
  async (req, res) => {
    try {
      const { current_password, new_password } = req.body;

      if (
        typeof current_password !== "string" ||
        typeof new_password !== "string" ||
        new_password.length < 8
      ) {
        return res.status(400).json({
          message: "Mevcut parolanızı ve en az 8 karakterli yeni parolanızı girin."
        });
      }

      const result = await pool.query(
        "SELECT password_hash FROM users WHERE id = $1 AND role = 'CUSTOMER'",
        [req.user.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          message: "Kullanıcı bulunamadı."
        });
      }

      const passwordCorrect = await bcrypt.compare(
        current_password,
        result.rows[0].password_hash
      );

      if (!passwordCorrect) {
        return res.status(400).json({
          message: "Mevcut parolanız yanlış."
        });
      }

      const samePassword = await bcrypt.compare(
        new_password,
        result.rows[0].password_hash
      );

      if (samePassword) {
        return res.status(400).json({
          message: "Yeni parola mevcut paroladan farklı olmalıdır."
        });
      }

      const newPasswordHash = await bcrypt.hash(new_password, 10);

      await pool.query(
        "UPDATE users SET password_hash = $1 WHERE id = $2",
        [newPasswordHash, req.user.id]
      );

      res.json({
        message: "Parolanız başarıyla değiştirildi."
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        message: "Parola değiştirilemedi."
      });
    }
  }
);











app.patch(
  "/districts/:id/delivery",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res) => {
    try {
      const districtId = Number(req.params.id);
      const { delivery_available } = req.body;

      if (
        !Number.isInteger(districtId) ||
        districtId <= 0 ||
        typeof delivery_available !== "boolean"
      ) {
        return res.status(400).json({
          message: "Geçerli ilçe ID'si ve sevkiyat durumu gönderin."
        });
      }

      const districtResult = await pool.query(
        "SELECT id, name, delivery_available FROM districts WHERE id = $1",
        [districtId]
      );

      if (districtResult.rows.length === 0) {
        return res.status(404).json({
          message: "İlçe bulunamadı."
        });
      }

      if (!delivery_available) {
        const routeResult = await pool.query(
          `SELECT r.id, r.name
           FROM route_districts rd
           JOIN routes r ON r.id = rd.route_id
           WHERE rd.district_id = $1
             AND r.active = TRUE`,
          [districtId]
        );

        if (routeResult.rows.length > 0) {
          return res.status(409).json({
            message: "Bu ilçe aktif rotalarda bulunduğu için sevkiyat kapatılamaz.",
            routes: routeResult.rows
          });
        }
      }

      const result = await pool.query(
        `UPDATE districts
         SET delivery_available = $1
         WHERE id = $2
         RETURNING id, name, delivery_available`,
        [delivery_available, districtId]
      );

      return res.json({
        message: "İlçenin sevkiyat durumu güncellendi.",
        district: result.rows[0]
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        message: "Sevkiyat durumu güncellenemedi."
      });
    }
  }
);

















app.get(
    "/customers/:id/current-account",
    authMiddleware,
    roleMiddleware("ADMIN"),
    async (req, res) => {
        try {
            const customerId = Number(req.params.id);

            if (!Number.isInteger(customerId) || customerId <= 0) {
                return res.status(400).json({
                    message: "Müşteri numarası geçersiz"
                });
            }

            const result = await pool.query(
                `SELECT
                    c.id AS customer_id,
                    c.company_name,
                    COALESCE(
                        SUM(
                            CASE
                                WHEN t.transaction_type = 'DEBIT'
                                    THEN t.amount
                                WHEN t.transaction_type = 'PAYMENT'
                                    THEN -t.amount
                                ELSE 0
                            END
                        ),
                        0
                    ) AS balance
                 FROM customers c
                 LEFT JOIN current_account_transactions t
                    ON t.customer_id = c.id
                 WHERE c.id = $1
                 GROUP BY c.id, c.company_name`,
                [customerId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    message: "Müşteri bulunamadı"
                });
            }

            return res.json({
                current_account: result.rows[0]
            });
        } catch (error) {
            console.error(error);

            return res.status(500).json({
                message: "Cari bakiye alınamadı"
            });
        }
    }
);



app.post(
    "/customers/:id/payments",
    authMiddleware,
    roleMiddleware("ADMIN", "COLLECTOR"),
    async (req, res) => {
        const client = await pool.connect();

        try {
            const customerId = Number(req.params.id);
            const amount = Number(req.body.amount);
            const idempotencyKey = req.body.idempotency_key;
            const description =
                typeof req.body.description === "string"
                    ? req.body.description.trim()
                    : "Müşteri tahsilatı";

            if (
                !Number.isInteger(customerId) ||
                customerId <= 0 ||
                !Number.isFinite(amount) ||
                amount <= 0 ||
                typeof idempotencyKey !== "string" ||
                idempotencyKey.trim().length < 8 ||
                idempotencyKey.trim().length > 100
              ) {
              return res.status(400).json({
                  message: "Müşteri numarası, tahsilat tutarı veya işlem anahtarı geçersiz"
                    });
                }

            await client.query("BEGIN");

            const existingPayment = await client.query(
              `SELECT *
              FROM current_account_transactions
              WHERE idempotency_key = $1`,
              [idempotencyKey.trim()]
          );

          if (existingPayment.rows.length > 0) {
              const existing = existingPayment.rows[0];

              if (
                  Number(existing.customer_id) !== customerId ||
                  existing.transaction_type !== "PAYMENT" ||
                  Number(existing.amount) !== amount
              ) {
                  await client.query("ROLLBACK");

                  return res.status(409).json({
                      message: "Bu işlem anahtarı farklı bir tahsilatta kullanılmış"
                  });
              }

              const balanceResult = await client.query(
                  `SELECT COALESCE(
                      SUM(
                          CASE
                              WHEN transaction_type = 'DEBIT' THEN amount
                              WHEN transaction_type = 'PAYMENT' THEN -amount
                              ELSE 0
                          END
                      ), 0
                  ) AS balance
                  FROM current_account_transactions
                  WHERE customer_id = $1`,
                  [customerId]
              );

              await client.query("COMMIT");

              return res.status(200).json({
                  message: "Bu tahsilat daha önce kaydedilmiş",
                  payment: existing,
                  balance: Number(balanceResult.rows[0].balance)
              });
          }

            const customerResult = await client.query(
                `SELECT id
                 FROM customers
                 WHERE id = $1 AND active = TRUE
                 FOR UPDATE`,
                [customerId]
            );

            if (customerResult.rows.length === 0) {
                await client.query("ROLLBACK");

                return res.status(404).json({
                    message: "Aktif müşteri bulunamadı"
                });
            }

            const balanceResult = await client.query(
                `SELECT COALESCE(
                    SUM(
                        CASE
                            WHEN transaction_type = 'DEBIT' THEN amount
                            WHEN transaction_type = 'PAYMENT' THEN -amount
                            ELSE 0
                        END
                    ),
                    0
                ) AS balance
                 FROM current_account_transactions
                 WHERE customer_id = $1`,
                [customerId]
            );

            const balance = Number(balanceResult.rows[0].balance);

            if (amount > balance) {
                await client.query("ROLLBACK");

                return res.status(400).json({
                    message: "Tahsilat tutarı kalan borçtan fazla olamaz",
                    balance
                });
            }

            const paymentResult = await client.query(
                `INSERT INTO current_account_transactions
                    (customer_id, transaction_type, amount, description, created_by, idempotency_key)
                VALUES ($1, 'PAYMENT', $2, $3, $4, $5)
                RETURNING *`,
                [
                    customerId,
                    amount,
                    description || "Müşteri tahsilatı",
                    req.user.id,
                    idempotencyKey.trim()
                ]
            );

            await client.query("COMMIT");

            return res.status(201).json({
                message: "Tahsilat başarıyla kaydedildi",
                payment: paymentResult.rows[0],
                balance: Number((balance - amount).toFixed(2))
            });

          } catch (error) {
              await client.query("ROLLBACK");

              // Aynı işlem anahtarıyla eşzamanlı kayıt oluşmuş olabilir.
              if (error.code === "23505") {
                  const existingResult = await pool.query(
                      `SELECT *
                      FROM current_account_transactions
                      WHERE idempotency_key = $1`,
                      [idempotencyKey.trim()]
                  );

                  if (existingResult.rows.length > 0) {
                      const existing = existingResult.rows[0];

                      if (
                          Number(existing.customer_id) === customerId &&
                          existing.transaction_type === "PAYMENT" &&
                          Number(existing.amount) === amount
                      ) {
                          const balanceResult = await pool.query(
                              `SELECT COALESCE(
                                  SUM(
                                      CASE
                                          WHEN transaction_type = 'DEBIT' THEN amount
                                          WHEN transaction_type = 'PAYMENT' THEN -amount
                                          ELSE 0
                                      END
                                  ), 0
                              ) AS balance
                              FROM current_account_transactions
                              WHERE customer_id = $1`,
                              [customerId]
                          );

                          return res.status(200).json({
                              message: "Bu tahsilat daha önce kaydedilmiş",
                              payment: existing,
                              balance: Number(balanceResult.rows[0].balance)
                          });
                      }

                      return res.status(409).json({
                          message: "Bu işlem anahtarı farklı bir tahsilatta kullanılmış"
                      });
                  }
              }

              console.error(error);

              return res.status(500).json({
                  message: "Tahsilat kaydedilemedi"
              });
          } finally {
              client.release();
          }

    }
);



app.get(
    "/customers/:id/current-account/transactions",
    authMiddleware,
    roleMiddleware("ADMIN", "COLLECTOR"),
    async (req, res) => {
        try {
            const customerId = Number(req.params.id);

            if (!Number.isInteger(customerId) || customerId <= 0) {
                return res.status(400).json({
                    message: "Müşteri numarası geçersiz"
                });
            }

            const customerResult = await pool.query(
                `SELECT id, company_name
                 FROM customers
                 WHERE id = $1`,
                [customerId]
            );

            if (customerResult.rows.length === 0) {
                return res.status(404).json({
                    message: "Müşteri bulunamadı"
                });
            }

            const transactionsResult = await pool.query(
                `SELECT
                    id,
                    order_id,
                    transaction_type,
                    amount,
                    description,
                    created_by,
                    created_at
                 FROM current_account_transactions
                 WHERE customer_id = $1
                 ORDER BY created_at DESC, id DESC`,
                [customerId]
            );

            return res.json({
                customer: customerResult.rows[0],
                transactions: transactionsResult.rows
            });
        } catch (error) {
            console.error(error);

            return res.status(500).json({
                message: "Cari hesap hareketleri alınamadı"
            });
        }
    }
);






app.listen(4000, () => {
  console.log("Server 400 portunda çalışıyor");
});