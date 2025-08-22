import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";

import authRouter from "./routes/auth";
import foodRouter from "./routes/food";
import productRouter from "./routes/product";

import businessUserRoutes from "./routes/businessUserRoutes";
import businessRoutes from "./routes/business";
import categoryRouter from "./routes/category";
import billpageRouter from "./routes/billpage";
import orderRouter from "./routes/order";
import planRouter from "./routes/plan";
import passwordResetRoute from "./routes/passwordReset";
import adminRoutes from "./routes/admin";
import dashboardRoutes from "./routes/dashboard";
import tableRoutes from "./routes/table";
import inventoryRoutes from "./routes/inventory";
import customerRoutes from "./routes/customer";
import couponRoutes from "./routes/coupons";
import businesswhatsappdataRoutes from "./routes/businesswhatsappdata";
import "./cron/deleteExpiredBills";

dotenv.config();

const app = express();

app.use(
  cors({
    origin: [
      "https://restaurant-frontend.vercel.app", // Vercel ka default domain
    ],
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mount routers
app.use("/api/auth", authRouter);
app.use("/api/food", foodRouter);
app.use("/api/products", productRouter);
app.use("/api", businessRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/categories", categoryRouter);
app.use("/api", businessUserRoutes);
app.use("/api", billpageRouter);
app.use("/api/orders", orderRouter);
app.use("/api", planRouter);
app.use("/api/password-reset", passwordResetRoute);
app.use("/api/admin", adminRoutes);
app.use("/api/tables", tableRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/businesswhatsappdata", businesswhatsappdataRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/coupons", couponRoutes);

app.get("/health", (req: Request, res: Response) => {
  res.json({ status: "ok", message: "Backend is running 🚀" });
});

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL is missing in .env");
  process.exit(1);
}

// Global error handler middleware — MUST be after all routes
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error("Unhandled error:", err);

  res.status(500).json({
    error: err.message || "Internal Server Error",
    stack: process.env.NODE_ENV === "production" ? undefined : err.stack,
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
