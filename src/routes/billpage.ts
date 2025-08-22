import express, { Response } from "express";
import { PrismaClient, OrderItem } from "@prisma/client";
import Decimal from "decimal.js";
import Joi from "joi";
import {
  authenticateBusinessOwnerJWT,
  BusinessOwnerRequest,
} from "../middleware/authenticateJWT";

const router = express.Router();
const prisma = new PrismaClient();

// Interface for extra dishes in fake bill
interface ExtraDish {
  dishName: string;
  price: number;
  quantity: number;
}

// Validation schemas using Joi
const createBillSchema = Joi.object({
  orderId: Joi.number().integer().required(),
  taxRates: Joi.object({
    vatLow: Joi.number().min(0).max(100).allow(null).optional(),
    vatHigh: Joi.number().min(0).max(100).allow(null).optional(),
    serviceTax: Joi.number().min(0).max(100).allow(null).optional(),
    serviceCharge: Joi.number().min(0).max(100).allow(null).optional(),
  }).required(),
});

const fakeBillSchema = Joi.object({
  orderId: Joi.number().integer().required(),
  extraDishes: Joi.array()
    .items(
      Joi.object({
        dishName: Joi.string().required(),
        price: Joi.number().min(0).required(),
        quantity: Joi.number().integer().min(1).required(),
      })
    )
    .required(),
});

// Validation schema for updating items
const updateItemsSchema = Joi.object({
  items: Joi.array()
    .items(
      Joi.object({
        productId: Joi.number().integer().optional(),
        name: Joi.string().required(),
        price: Joi.number().min(0).required(),
        quantity: Joi.number().integer().min(1).required(),
      })
    )
    .required(),
});

// Validation schema for store-link
const storeLinkSchema = Joi.object({
  billStoreLink: Joi.string().uri().required(),
  cloudinaryPublicId: Joi.string().required(),
  isModified: Joi.boolean().optional(), // ✅ Added isModified flag
});

// Helper: rounding to 2 decimals
const round = (val: Decimal): number => val.toDecimalPlaces(2).toNumber();

// Helper: calculate tax and totals
function calculateTotals(
  baseAmount: Decimal,
  taxRates: {
    vatLow?: number | null;
    vatHigh?: number | null;
    serviceTax?: number | null;
    serviceCharge?: number | null;
  }
) {
  const vatLowAmount = taxRates.vatLow
    ? baseAmount.mul(taxRates.vatLow).div(100)
    : new Decimal(0);
  const vatHighAmount = taxRates.vatHigh
    ? baseAmount.mul(taxRates.vatHigh).div(100)
    : new Decimal(0);
  const serviceTaxAmount = taxRates.serviceTax
    ? baseAmount.mul(taxRates.serviceTax).div(100)
    : new Decimal(0);
  const serviceChargeAmount = taxRates.serviceCharge
    ? baseAmount.mul(taxRates.serviceCharge).div(100)
    : new Decimal(0);

  return {
    vatLowAmount: round(vatLowAmount),
    vatHighAmount: round(vatHighAmount),
    serviceTaxAmount: round(serviceTaxAmount),
    serviceChargeAmount: round(serviceChargeAmount),
    totalAmount: round(
      vatLowAmount
        .plus(vatHighAmount)
        .plus(serviceTaxAmount)
        .plus(serviceChargeAmount)
        .plus(baseAmount)
    ),
  };
}

// Parse and validate orderId from params
function parseOrderId(idStr: string | undefined): number | null {
  if (!idStr) return null;
  const id = Number(idStr);
  return isNaN(id) ? null : id;
}

// Create Bill (Real)
router.post(
  "/bill",
  authenticateBusinessOwnerJWT,
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    try {
      const { error, value } = createBillSchema.validate(req.body);
      if (error) {
        res.status(400).json({ error: error.details[0].message });
        return;
      }
      const { orderId, taxRates } = value;
      const businessId = req.businessOwner?.businessId;
      if (!businessId) {
        res.status(401).json({ error: "Unauthorized: Missing businessId" });
        return;
      }

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });

      if (!order || order.businessId !== businessId) {
        res
          .status(403)
          .json({ error: "Unauthorized to create bill for this order" });
        return;
      }

      const baseAmount = order.items.reduce(
        (sum: Decimal, item: OrderItem) =>
          sum.plus(new Decimal(item.price).mul(item.quantity)),
        new Decimal(0)
      );

      const { totalAmount } = calculateTotals(baseAmount, taxRates);

      // Atomic transaction
      const bill = await prisma.$transaction(async (tx) => {
        const createdBill = await tx.bill.create({
          data: {
            order: { connect: { id: orderId } },
            business: { connect: { id: businessId } },
            totalAmount,
            vatLow: taxRates.vatLow ?? undefined,
            vatHigh: taxRates.vatHigh ?? undefined,
            serviceTax: taxRates.serviceTax ?? undefined,
            serviceCharge: taxRates.serviceCharge ?? undefined,
          },
        });

        await tx.order.update({
          where: { id: orderId },
          data: { status: "Completed", totalAmount },
        });

        return createdBill;
      });

      res.status(201).json({ bill, message: "Bill created successfully" });
      return;
    } catch (err: any) {
      res.status(400).json({ error: err.message });
      return;
    }
  }
);

// ✅ NEW: Endpoint to get bill with calculation details
router.get(
  "/bill/:orderId/details",
  authenticateBusinessOwnerJWT,
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    try {
      const orderId = parseOrderId(req.params.orderId);
      if (!orderId) {
        res.status(400).json({ error: "Invalid order ID" });
        return;
      }

      const businessId = req.businessOwner?.businessId;
      if (!businessId) {
        res.status(401).json({ error: "Unauthorized: Missing businessId" });
        return;
      }

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { 
          items: true,
          bill: true 
        },
      });

      if (!order || order.businessId !== businessId) {
        res.status(403).json({ error: "Unauthorized access" });
        return;
      }

      // ✅ Calculate base amount
      const baseAmount = order.items.reduce(
        (sum: Decimal, item: OrderItem) =>
          sum.plus(new Decimal(item.price).mul(item.quantity)),
        new Decimal(0)
      );

      // ✅ Get tax rates from bill or use defaults
      const taxRates = {
        vatLow: order.bill?.vatLow || 0,
        vatHigh: order.bill?.vatHigh || 0,
        serviceTax: order.bill?.serviceTax || 0,
        serviceCharge: order.bill?.serviceCharge || 0,
      };

      // ✅ Calculate all amounts
      const calculations = calculateTotals(baseAmount, taxRates);

      res.status(200).json({
        order: {
          id: order.id,
          table_number: order.tableNumber,
          created_at: order.createdAt,
          payment_method: order.paymentMethod,
          status: order.status,
          items: order.items,
        },
        bill: order.bill,
        calculations: {
          baseAmount: round(baseAmount),
          ...calculations,
        },
        taxRates,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

// Generate Fake Bill (Not Stored)
router.post(
  "/fake-bill",
  authenticateBusinessOwnerJWT,
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    try {
      const { error, value } = fakeBillSchema.validate(req.body);
      if (error) {
        res.status(400).json({ error: error.details[0].message });
        return;
      }
      const { orderId, extraDishes } = value;
      const businessId = req.businessOwner?.businessId;

      if (!businessId) {
        res.status(401).json({ error: "Unauthorized: Missing businessId" });
        return;
      }

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { items: true, bill: true },
      });

      if (!order || order.businessId !== businessId) {
        res.status(403).json({ error: "Unauthorized or order not found" });
        return;
      }
      
      if (!order.items) {
        res.status(400).json({ error: "Order items not found" });
        return;
      }

      const baseAmount = order.items.reduce(
        (sum: Decimal, item: OrderItem) =>
          sum.plus(new Decimal(item.price).mul(item.quantity)),
        new Decimal(0)
      );

      const bill = order.bill;

      const { totalAmount: originalAmount } = calculateTotals(baseAmount, {
        vatLow: bill?.vatLow ?? 0,
        vatHigh: bill?.vatHigh ?? 0,
        serviceTax: bill?.serviceTax ?? 0,
        serviceCharge: bill?.serviceCharge ?? 0,
      });

      const extraBase = extraDishes.reduce(
        (sum: Decimal, dish: ExtraDish) =>
          sum.plus(new Decimal(dish.price).mul(dish.quantity)),
        new Decimal(0)
      );

      const extraVatLow = bill?.vatLow
        ? extraBase.mul(bill.vatLow).div(100)
        : new Decimal(0);
      const extraVatHigh = bill?.vatHigh
        ? extraBase.mul(bill.vatHigh).div(100)
        : new Decimal(0);
      const extraServiceTax = bill?.serviceTax
        ? extraBase.mul(bill.serviceTax).div(100)
        : new Decimal(0);

      const extraVatLowRounded = round(extraVatLow);
      const extraVatHighRounded = round(extraVatHigh);
      const extraServiceTaxRounded = round(extraServiceTax);

      const fakeTotal = round(
        new Decimal(originalAmount)
          .plus(extraBase)
          .plus(extraVatLowRounded)
          .plus(extraVatHighRounded)
          .plus(extraServiceTaxRounded)
      );

      const allItems = [
        ...order.items.map((i) => ({
          name: i.name,
          price: i.price,
          quantity: i.quantity,
        })),
        ...extraDishes.map((e: ExtraDish) => ({
          name: e.dishName,
          price: e.price,
          quantity: e.quantity,
        })),
      ];

      res.status(200).json({
        originalAmount,
        fakeAmount: fakeTotal,
        items: allItems,
        message: "Fake bill generated successfully",
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

// Get Bill by orderId
router.get(
  "/bill/:orderId",
  authenticateBusinessOwnerJWT,
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    try {
      const orderId = parseOrderId(req.params.orderId);
      if (!orderId) {
        res.status(400).json({ error: "Invalid order ID" });
        return;
      }

      const businessId = req.businessOwner?.businessId;
      if (!businessId) {
        res.status(401).json({ error: "Unauthorized: Missing businessId" });
        return;
      }

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });

      if (!order || order.businessId !== businessId) {
        res.status(403).json({ error: "Unauthorized access" });
        return;
      }

      const bill = await prisma.bill.findUnique({
        where: { orderId },
        select: {
          id: true,
          orderId: true,
          businessId: true,
          totalAmount: true,
          vatLow: true,
          vatHigh: true,
          serviceTax: true,
          serviceCharge: true,
          billStoreLink: true,
          billStorePublicId: true,
          modifiedBillStoreLink: true, // ✅ Added
          modifiedBillStorePublicId: true, // ✅ Added
          expiresAt: true,
        },
      });

      if (bill && bill.expiresAt && new Date(bill.expiresAt) < new Date()) {
        bill.billStoreLink = null;
        bill.modifiedBillStoreLink = null;
      }

      const response = bill || { message: "No bill found for this order" };
      
      // ✅ Add order items to response for frontend calculations
      if (bill) {
        (response as any).orderItems = order.items;
      }

      res.status(200).json(response);
      return;
    } catch (err: any) {
      res.status(400).json({ error: err.message });
      return;
    }
  }
);

// Update charges
router.put(
  "/bill/:orderId/update-charges",
  authenticateBusinessOwnerJWT,
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    try {
      const orderId = parseOrderId(req.params.orderId);
      if (!orderId) {
        res.status(400).json({ error: "Invalid order ID" });
        return;
      }

      const businessId = req.businessOwner?.businessId;
      if (!businessId) {
        res.status(401).json({ error: "Unauthorized: Missing businessId" });
        return;
      }

      const { vatLow, vatHigh, serviceTax, serviceCharge } = req.body;

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });
      if (!order || order.businessId !== businessId) {
        res.status(403).json({ error: "Unauthorized to update charges" });
        return;
      }
      if (!order.items) {
        res.status(400).json({ error: "Order items not found" });
        return;
      }

      const baseAmount = order.items.reduce(
        (sum: Decimal, item: OrderItem) =>
          sum.plus(new Decimal(item.price).mul(item.quantity)),
        new Decimal(0)
      );

      const { totalAmount } = calculateTotals(baseAmount, {
        vatLow,
        vatHigh,
        serviceTax,
        serviceCharge,
      });

      const updated = await prisma.$transaction(async (tx) => {
        const billUpdated = await tx.bill.update({
          where: { orderId },
          data: {
            vatLow: vatLow ?? undefined,
            vatHigh: vatHigh ?? undefined,
            serviceTax: serviceTax ?? undefined,
            serviceCharge: serviceCharge ?? undefined,
            totalAmount,
          },
        });

        await tx.order.update({
          where: { id: orderId },
          data: { totalAmount },
        });

        return billUpdated;
      });

      res
        .status(200)
        .json({ bill: updated, message: "Charges updated successfully" });
      return;
    } catch (err: any) {
      res.status(400).json({ error: err.message });
      return;
    }
  }
);

// Update billStoreLink for a specific bill
router.put(
  "/bill/:orderId/store-link",
  authenticateBusinessOwnerJWT,
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    try {
      const { error, value } = storeLinkSchema.validate(req.body);
      if (error) {
        res.status(400).json({ error: error.details[0].message });
        return;
      }

      const { billStoreLink, cloudinaryPublicId, isModified } = value;
      const orderId = parseOrderId(req.params.orderId);

      if (!orderId) {
        res.status(400).json({ error: "Invalid order ID" });
        return;
      }

      const businessId = req.businessOwner?.businessId;
      if (!businessId) {
        res.status(401).json({ error: "Unauthorized: Missing businessId" });
        return;
      }

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });
      if (!order || order.businessId !== businessId) {
        res.status(403).json({ error: "Unauthorized or order not found" });
        return;
      }
      if (!order.items) {
        res.status(400).json({ error: "Order items not found" });
        return;
      }

      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      const existingBill = await prisma.bill.findUnique({
        where: { orderId },
      });

      if (existingBill) {
        await prisma.bill.update({
          where: { orderId },
          data: {
            ...(isModified
              ? {
                  modifiedBillStoreLink: billStoreLink,
                  modifiedBillStorePublicId: cloudinaryPublicId,
                }
              : {
                  billStoreLink,
                  billStorePublicId: cloudinaryPublicId,
                }),
            expiresAt,
          },
        });
        res
          .status(200)
          .json({ message: "Bill store link updated successfully" });
        return;
      } else {
        const baseAmount = order.items.reduce(
          (sum: Decimal, item: OrderItem) =>
            sum.plus(new Decimal(item.price).mul(item.quantity)),
          new Decimal(0)
        );
        const totalAmount = round(baseAmount);

        await prisma.bill.create({
          data: {
            order: { connect: { id: orderId } },
            business: { connect: { id: businessId } },
            ...(isModified
              ? {
                  modifiedBillStoreLink: billStoreLink,
                  modifiedBillStorePublicId: cloudinaryPublicId,
                }
              : {
                  billStoreLink,
                  billStorePublicId: cloudinaryPublicId,
                }),
            expiresAt,
            totalAmount,
          },
        });
        res.status(201).json({ message: "Bill created with store link" });
        return;
      }
    } catch (error) {
      console.error("Error updating/creating bill store link:", error);
      res.status(500).json({ error: "Internal Server Error" });
      return;
    }
  }
);

// Update bill items (for modified bill)
router.put(
  "/bill/:orderId/update-items",
  authenticateBusinessOwnerJWT,
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    try {
      const { error, value } = updateItemsSchema.validate(req.body);
      if (error) {
        res.status(400).json({ error: error.details[0].message });
        return;
      }

      const { items } = value;
      const orderId = parseOrderId(req.params.orderId);

      if (!orderId) {
        res.status(400).json({ error: "Invalid order ID" });
        return;
      }

      const businessId = req.businessOwner?.businessId;
      if (!businessId) {
        res.status(401).json({ error: "Unauthorized: Missing businessId" });
        return;
      }

      const order = await prisma.order.findUnique({
        where: { id: orderId },
      });
      if (!order || order.businessId !== businessId) {
        res.status(403).json({ error: "Unauthorized or order not found" });
        return;
      }

      await prisma.$transaction(async (tx) => {
        await tx.orderItem.deleteMany({
          where: { orderId },
        });

        await tx.orderItem.createMany({
          data: items.map((item: any) => ({
            orderId,
            productId: item.productId || null,
            name: item.name,
            price: item.price,
            quantity: item.quantity,
          })),
        });

        const baseAmount = items.reduce(
          (sum: Decimal, item: OrderItem) =>
            sum.plus(new Decimal(item.price).mul(item.quantity)),
          new Decimal(0)
        );

        let bill = await tx.bill.findUnique({ where: { orderId } });
        if (!bill) {
          bill = await tx.bill.create({
            data: {
              order: { connect: { id: orderId } },
              business: { connect: { id: businessId } },
              totalAmount: round(baseAmount),
            },
          });
        }

        const { totalAmount } = calculateTotals(baseAmount, {
          vatLow: bill.vatLow,
          vatHigh: bill.vatHigh,
          serviceTax: bill.serviceTax,
          serviceCharge: bill.serviceCharge,
        });

        await tx.bill.update({
          where: { orderId },
          data: { totalAmount },
        });

        await tx.order.update({
          where: { id: orderId },
          data: { totalAmount },
        });
      });

      res.status(200).json({ message: "Bill items updated successfully" });
      return;
    } catch (error) {
      console.error("Error updating bill items:", error);
      res.status(500).json({ error: "Internal Server Error" });
      return;
    }
  }
);

// Get bill store link by orderId
router.get(
  "/bill/:orderId/link",
  authenticateBusinessOwnerJWT,
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    try {
      const orderId = parseOrderId(req.params.orderId);
      if (!orderId) {
        res.status(400).json({ error: "Invalid order ID" });
        return;
      }

      const businessId = req.businessOwner?.businessId;
      if (!businessId) {
        res.status(401).json({ error: "Unauthorized: Missing businessId" });
        return;
      }

      const bill = await prisma.bill.findUnique({
        where: { orderId },
        select: {
          billStoreLink: true,
          modifiedBillStoreLink: true, // ✅ Added
          order: { select: { businessId: true } },
        },
      });

      if (!bill || !bill.order || bill.order.businessId !== businessId) {
        res.status(403).json({ error: "Unauthorized or bill not found" });
        return;
      }

      res.status(200).json({
        billStoreLink: bill.billStoreLink,
        modifiedBillStoreLink: bill.modifiedBillStoreLink, // ✅ Added
      });
      return;
    } catch (error: any) {
      console.error("Error retrieving bill link:", error);
      res.status(500).json({ error: "Internal Server Error" });
      return;
    }
  }
);

export default router;
