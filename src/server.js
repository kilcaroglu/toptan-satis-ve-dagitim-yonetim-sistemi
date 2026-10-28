import express from "express";
import pool from "./db.js";
import { authMiddleware, roleMiddleware } from "./authMiddleware.js";
import cors from "cors";


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
} from "./routes/membership-applications.routes.js";import routesRoutes from "./routes/routes.routes.js";
import shipmentsRoutes from "./routes/shipments.routes.js";
import districtsRoutes from "./routes/districts.routes.js";
import currentAccountRoutes from "./routes/current-account.routes.js";

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

app.get("/", (req, res) => {
  res.json({
    message: "Toptan Satis ve Dagitim Yonetim Sistemi API calisiyor",
  });
});

app.listen(4000, () => {
  console.log("Server 400 portunda çalışıyor");
});
