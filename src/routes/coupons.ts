import { Router, Response, Request } from "express";
import { PrismaClient } from "@prisma/client";
import {
  authenticateBusinessOwnerJWT,
  BusinessOwnerRequest,
} from "../middleware/authenticateJWT";

const prisma = new PrismaClient();
const router = Router();

// ✅ CREATE Coupon
router.post(
  "/create",
  authenticateBusinessOwnerJWT,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as BusinessOwnerRequest;

    try {
      const {
        code,
        description,
        discountType,
        discountValue,
        maxDiscount,
        minOrderValue,
        validFrom,
        validTill,
        usageLimit,
      } = req.body;

      const businessId = authReq.businessOwner?.businessId;
      const role = authReq.businessOwner?.role;

      if (
        !businessId ||
        !["owner", "manager", "admin, staff"].includes(role || "")
      ) {
        res.status(403).json({ error: "Unauthorized" });
        return;
      }

      if (
        !code ||
        !discountType ||
        discountValue === undefined ||
        minOrderValue === undefined ||
        !validFrom ||
        !validTill ||
        usageLimit === undefined
      ) {
        res.status(400).json({ error: "Missing required fields" });
        return;
      }

      const newCoupon = await prisma.coupon.create({
        data: {
          code: code.toUpperCase(),
          description,
          discountType,
          discountValue: parseFloat(discountValue),
          maxDiscount: maxDiscount ? parseFloat(maxDiscount) : null,
          minOrderValue: parseFloat(minOrderValue),
          validFrom: new Date(validFrom),
          validTill: new Date(validTill),
          usageLimit: parseInt(usageLimit),
          businessId,
        },
      });

      res.status(201).json({ message: "Coupon created", coupon: newCoupon });
    } catch (err) {
      console.error(
        "Error creating coupon:",
        err instanceof Error ? err.stack : err
      );
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ✅ VALIDATE Coupon
router.post(
  "/validate",
  authenticateBusinessOwnerJWT,
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    const { code, orderTotal } = req.body;
    const businessId = req.businessOwner?.businessId;

    if (!code || !orderTotal) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    try {
      const coupon = await prisma.coupon.findFirst({
        where: {
          code: code.toUpperCase(),
          businessId,
          validFrom: { lte: new Date() },
          validTill: { gte: new Date() },
        },
      });

      if (!coupon) {
        res.status(404).json({ error: "Coupon not found or expired" });
        return;
      }

      if (orderTotal < coupon.minOrderValue) {
        res.status(400).json({
          error: `Minimum order value must be ₹${coupon.minOrderValue}`,
        });
        return;
      }

      let discount = 0;
      if (coupon.discountType === "flat") {
        discount = coupon.discountValue;
      } else if (coupon.discountType === "percent") {
        discount = (coupon.discountValue / 100) * orderTotal;
        if (coupon.maxDiscount && discount > coupon.maxDiscount) {
          discount = coupon.maxDiscount;
        }
      }

      res.json({
        message: "Coupon applied successfully",
        discount,
        coupon: {
          id: coupon.id,
          code: coupon.code,
          type: coupon.discountType,
          value: coupon.discountValue,
        },
      });
    } catch (err) {
      console.error("Coupon validation error:", err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

// ✅ GET All Coupons for Logged-in Business
router.get(
  "/",
  authenticateBusinessOwnerJWT,
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    try {
      const businessId = req.businessOwner?.businessId;

      if (!businessId) {
        res.status(400).json({ error: "Business ID missing in token" });
        return;
      }

      const coupons = await prisma.coupon.findMany({
        where: { businessId },
        orderBy: { createdAt: "desc" },
      });

      res.json(coupons);
    } catch (err) {
      console.error("Error fetching coupons:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.put(
  "/:id",
  authenticateBusinessOwnerJWT,
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const {
        code,
        description,
        discountType,
        discountValue,
        maxDiscount,
        minOrderValue,
        validFrom,
        validTill,
        usageLimit,
      } = req.body;

      const businessId = req.businessOwner?.businessId;
      const role = req.businessOwner?.role;

      if (
        !businessId ||
        !["owner", "manager", "admin", "staff"].includes(role || "")
      ) {
        res.status(403).json({ error: "Unauthorized" });
        return;
      }

      const coupon = await prisma.coupon.findUnique({
        where: { id: parseInt(id) },
      });

      if (!coupon || coupon.businessId !== businessId) {
        res.status(404).json({ error: "Coupon not found or unauthorized" });
        return;
      }

      const updatedCoupon = await prisma.coupon.update({
        where: { id: parseInt(id) },
        data: {
          code: code.toUpperCase(),
          description,
          discountType,
          discountValue: parseFloat(discountValue),
          maxDiscount: maxDiscount ? parseFloat(maxDiscount) : null,
          minOrderValue: parseFloat(minOrderValue),
          validFrom: new Date(validFrom),
          validTill: new Date(validTill),
          usageLimit: parseInt(usageLimit),
        },
      });

      res.json({ message: "Coupon updated", coupon: updatedCoupon });
    } catch (error) {
      console.error("Update error:", error);
      res.status(500).json({ error: "Failed to update coupon" });
    }
  }
);

router.delete(
  "/:id",
  authenticateBusinessOwnerJWT,
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    const { id } = req.params;
    const businessId = req.businessOwner?.businessId;

    try {
      const coupon = await prisma.coupon.findUnique({
        where: { id: Number(id) },
      });

      if (!coupon || coupon.businessId !== businessId) {
        res.status(404).json({ error: "Coupon not found or not authorized" });
        return;
      }

      await prisma.coupon.delete({ where: { id: Number(id) } });
      res.json({ message: "Coupon deleted successfully" });
      return;
    } catch (err) {
      console.error("Delete error:", err);
      res.status(500).json({ error: "Server error" });
      return;
    }
  }
);

export default router;
