import express from "express";
import pool from "./db.js";
import cors from "cors";
import cron from "node-cron";

import authRoutes from "./routes/auth.routes.js";
import distributorsRoutes from "./routes/distributors.routes.js";
import productsRoutes from "./routes/products.routes.js";
import categoriesRoutes from "./routes/categories.routes.js";
import purchasesRoutes from "./routes/purchases.routes.js";
import ordersRoutes from "./routes/orders.routes.js";
import myOrdersRoutes from "./routes/my-orders.routes.js";
import distributorOrdersRoutes from "./routes/distributor-orders.routes.js";
import customersRoutes from "./routes/customers.routes.js";
import membershipApplicationsRoutes, {
  adminMembershipApplicationsRoutes
} from "./routes/membership-applications.routes.js";
import routesRoutes from "./routes/routes.routes.js";
import shipmentsRoutes from "./routes/shipments.routes.js";
import districtsRoutes from "./routes/districts.routes.js";
import currentAccountRoutes from "./routes/current-account.routes.js";
import vehiclesRoutes from "./routes/vehicles.routes.js";
import adminAccountsRoutes from "./routes/admin-accounts.routes.js";

const app = express();

app.use(express.json());
app.use(cors());

app.use("/auth", authRoutes);
app.use("/admin/distributors", distributorsRoutes);
app.use("/products", productsRoutes);
app.use("/categories", categoriesRoutes);
app.use("/product-purchases", purchasesRoutes);
app.use("/orders", ordersRoutes);
app.use("/my-orders", myOrdersRoutes);
app.use("/distributor", distributorOrdersRoutes);
app.use("/customers", customersRoutes);
app.use("/membership-applications", membershipApplicationsRoutes);
app.use("/admin/membership-applications", adminMembershipApplicationsRoutes);
app.use("/routes", routesRoutes);
app.use("/shipments", shipmentsRoutes);
app.use("/districts", districtsRoutes);
app.use("/customers", currentAccountRoutes);
app.use("/vehicles", vehiclesRoutes);
app.use("/admin/accounts", adminAccountsRoutes);

app.get("/", (req, res) => {
  res.json({
    message: "Toptan Satis ve Dagitim Yonetim Sistemi API calisiyor",
  });
});

// Türkiye tarihini al
function getTurkeyDate() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const values = {};
  for (const part of parts) {
    values[part.type] = part.value;
  }

  return `${values.year}-${values.month}-${values.day}`;
}

// Önümüzdeki 7 günün sevkiyatlarını oluştur
async function generateUpcomingShipments() {
  try {
    const today = getTurkeyDate();

    const result = await pool.query(
      `
      INSERT INTO shipments (
        route_id,
        route_schedule_id,
        shipment_date
      )
      SELECT
        routes.id,
        route_schedules.id,
        generated_dates.shipment_date::date
      FROM generate_series(
        $1::date,
        $1::date + 6,
        INTERVAL '1 day'
      ) AS generated_dates(shipment_date)
      INNER JOIN route_schedules
        ON route_schedules.delivery_day =
           EXTRACT(ISODOW FROM generated_dates.shipment_date)::int
       AND route_schedules.active = TRUE
      INNER JOIN routes
        ON routes.id = route_schedules.route_id
       AND routes.active = TRUE
      ON CONFLICT DO NOTHING
      RETURNING id, route_id, shipment_date
      `,
      [today]
    );

    console.log(
      `Otomatik sevkiyat kontrolü tamamlandı. Yeni sevkiyat: ${result.rowCount}`
    );
  } catch (error) {
    console.error("Otomatik sevkiyat oluşturma hatası:", error);
  }
}

app.listen(4000, () => {
  console.log("Server 4000 portunda çalışıyor");

  // Sunucu açıldığında ilk kontrolü yap
  generateUpcomingShipments();

  // Her gün Türkiye saatiyle 00.05'te çalıştır
  cron.schedule(
    "5 0 * * *",
    () => {
      console.log("Günlük otomatik sevkiyat işlemi başladı.");
      generateUpcomingShipments();
    },
    {
      timezone: "Europe/Istanbul",
    }
  );

  console.log("Otomatik sevkiyat zamanlayıcısı aktif.");
});
