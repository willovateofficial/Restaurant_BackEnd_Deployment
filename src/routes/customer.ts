import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import {
  authenticateCustomerJWT,
  CustomerRequest,
} from "../middleware/authenticateJWT";

const router = express.Router();
const prisma = new PrismaClient();

interface CustomerTokenPayload {
  customerId: number;
  email: string;
  businessId: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: CustomerTokenPayload;
    }
  }
}

// ✅ POST /customer/register
router.post("/register", async (req: Request, res: Response): Promise<void> => {
  const { name, email, password, mobile, businessId } = req.body;

  try {
    if (!businessId || isNaN(Number(businessId))) {
      res.status(400).json({ error: "Invalid or missing businessId" });
      return;
    }

    // ✅ Check if business exists
    const businessExists = await prisma.business.findUnique({
      where: { id: Number(businessId) },
    });

    if (!businessExists) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    // ✅ Check if customer already registered
    const existingCustomer = await prisma.customer.findFirst({
      where: { email, businessId: Number(businessId) },
    });

    if (existingCustomer) {
      res
        .status(400)
        .json({ error: "Customer already registered. Please login." });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // ✅ Generate custom incremental customerId
    const lastCustomer = await prisma.customer.findFirst({
      where: { businessId: Number(businessId) },
      orderBy: { customerId: "desc" },
    });

    const newCustomerId = lastCustomer ? lastCustomer.customerId + 1 : 1;

    // ✅ Create customer
    const newCustomer = await prisma.customer.create({
      data: {
        name,
        email,
        password: hashedPassword,
        mobile,
        business: { connect: { id: Number(businessId) } },
        customerId: newCustomerId,
      },
    });

    res.status(201).json({
      message: "Customer registered successfully",
      customerId: newCustomer.customerId,
      id: newCustomer.id,
    });
  } catch (error: any) {
    console.error("❌ Customer registration error:", error);

    if (
      error.code === "P2003" &&
      error.meta?.field_name?.includes("businessId")
    ) {
      res
        .status(400)
        .json({ error: "Invalid business ID (foreign key error)" });
    } else {
      res.status(500).json({ error: "Failed to register customer" });
    }
  }
});

// ✅ POST /customer/login
router.post("/login", async (req: Request, res: Response): Promise<void> => {
  const { email, password, businessId } = req.body;

  try {
    const customer = await prisma.customer.findFirst({
      where: { email, businessId },
    });

    if (!customer) {
      res.status(404).json({
        error: "Customer not found for this restaurant. Please register.",
      });
      return;
    }

    const isMatch = await bcrypt.compare(password, customer.password);
    if (!isMatch) {
      res.status(401).json({ error: "Invalid password" });
      return;
    }

    const tokenPayload = {
      customerId: customer.customerId, // ✅ custom incremental ID
      email: customer.email,
      businessId: customer.businessId,
    };

    const token = jwt.sign(
      tokenPayload,
      process.env.JWT_SECRET || "your-secret-key",
      { expiresIn: "12h" }
    );
    res.json({
      message: "Login successful",
      token,
      customer: {
        id: customer.id, // internal DB ID
        customerId: customer.customerId, // ✅ custom unique customerId
        name: customer.name,
        email: customer.email,
        mobile: customer.mobile,
        businessId: customer.businessId,
      },
    });
  } catch (error) {
    console.error("Customer login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
});

// ✅ GET /customer
// ✅ GET /customer
router.get(
  "/customer",
  authenticateCustomerJWT,
  async (req: CustomerRequest, res: Response): Promise<void> => {
    try {
      const businessId = req.customer?.businessId;
      if (!businessId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const customers = await prisma.customer.findMany({
        where: { businessId },
        include: {
          orders: { select: { totalAmount: true } },
        },
      });

      const enrichedCustomers = customers.map((customer:any) => {
        const totalOrders = customer.orders.length;
        const totalMoneySpent = customer.orders.reduce(
          (sum: number, order: { totalAmount: number | null }) =>
            sum + (order.totalAmount ?? 0),
          0
        );

        return {
          id: customer.id,
          customerId: customer.customerId,
          name: customer.name,
          email: customer.email,
          mobile: customer.mobile,
          businessId: customer.businessId,
          totalOrders,
          totalMoneySpent,
          points: customer.points, // ✅ include points
        };
      });

      res.json(enrichedCustomers);
    } catch (error) {
      console.error("Get customers error:", error);
      res.status(500).json({ error: "Failed to fetch customers" });
    }
  }
);

// ✅ PUT /customer/:id
router.put(
  "/customer/:id",
  authenticateCustomerJWT,
  async (req: CustomerRequest, res: Response): Promise<void> => {
    const customerId = parseInt(req.params.id);
    const { name, mobile, password } = req.body;

    try {
      const updateData: any = {};
      if (name) updateData.name = name;
      if (mobile) updateData.mobile = mobile;
      if (password) updateData.password = await bcrypt.hash(password, 10);

      const updatedCustomer = await prisma.customer.update({
        where: { id: customerId },
        data: updateData,
      });

      res.json(updatedCustomer);
    } catch (error) {
      console.error("Customer update error:", error);
      res.status(500).json({ error: "Failed to update customer" });
    }
  }
);

// ✅ GET /api/customers/me
router.get(
  "/me",
  authenticateCustomerJWT,
  async (req: CustomerRequest, res: Response): Promise<void> => {
    try {
      const customerId = req.customer?.customerId; // ✅ use customerId from token
      const businessId = req.customer?.businessId;

      if (!customerId || !businessId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const customer = await prisma.customer.findFirst({
        where: {
          customerId: customerId,
          businessId: businessId,
        },
      });

      if (!customer) {
        res.status(404).json({ error: "Customer not found" });
        return;
      }

      res.json({
        id: customer.id, // internal DB ID
        customerId: customer.customerId, // custom customer ID
        name: customer.name,
        email: customer.email,
        mobile: customer.mobile,
        points: customer.points,
        businessId: customer.businessId,
      });
    } catch (err) {
      console.error("❌ Fetch customer profile failed:", err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

// ✅ PATCH /customer/:id
router.patch(
  "/customer/:id",
  authenticateCustomerJWT,
  async (req: CustomerRequest, res: Response): Promise<void> => {
    const customerId = parseInt(req.params.id);
    const { name, mobile } = req.body;

    try {
      const updateData: any = {};
      if (name) updateData.name = name;
      if (mobile) updateData.mobile = mobile;

      const updatedCustomer = await prisma.customer.update({
        where: { id: customerId },
        data: updateData,
      });

      res.json({
        message: "Customer updated successfully (PATCH)",
        customer: updatedCustomer,
      });
    } catch (error) {
      console.error("Customer patch update error:", error);
      res.status(500).json({ error: "Failed to update customer" });
    }
  }
);

// ✅ PUT /customer/:id/full
router.put(
  "/customer/:id/full",
  authenticateCustomerJWT,
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { name, mobile, password } = req.body;

    try {
      if (!name || !mobile) {
        res.status(400).json({ error: "Name and mobile are required" });
        return;
      }

      const customerId = parseInt(id);
      if (isNaN(customerId)) {
        res.status(400).json({ error: "Invalid customer ID" });
        return;
      }

      const updateData: any = {
        name,
        mobile,
      };

      if (password) {
        updateData.password = await bcrypt.hash(password, 10);
      }

      const updatedCustomer = await prisma.customer.update({
        where: { id: customerId },
        data: updateData,
      });

      res.status(200).json({
        message: "Customer profile updated successfully",
        customer: updatedCustomer,
      });
    } catch (error) {
      console.error("Error updating customer:", error);
      res.status(500).json({ error: "Failed to update customer" });
    }
  }
);

export default router;
