import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import upload from "../middleware/multer";
import {
  authenticateBusinessOwnerJWT,
  BusinessOwnerRequest,
} from "../middleware/authenticateJWT";
import { BusinessOwnerPayload } from "../middleware/authenticateJWT";

const router = express.Router();
const prisma = new PrismaClient();

interface RegisterBody {
  name: string;
  email: string;
  business_name: string;
  business_type?: string;
  phone?: string;
  address?: string;
  password: string;
  role?: string;
}

// ✅ PUT /user (update user)
router.put(
  "/user",
  authenticateBusinessOwnerJWT,
  upload.fields([
    { name: "profilePhoto", maxCount: 1 },
    { name: "qrCode", maxCount: 1 },
  ]),
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    try {
      if (!req.businessOwner?.userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const userId = req.businessOwner.userId;
      const businessId = req.businessOwner.businessId;
      const { name, phone, address, businessName } = req.body;

      const files = req.files as {
        [fieldname: string]: Express.Multer.File[];
      };

      const profilePhoto = files?.profilePhoto?.[0];
      const qrCode = files?.qrCode?.[0];

      const updateData: any = {
        name,
        phone,
        address,
      };

      if (profilePhoto) {
        updateData.profilePhotoUrl = profilePhoto.path;
      }

      if (qrCode) {
        updateData.qrCodeUrl = qrCode.path;
      }

      if (businessName && businessId) {
        await prisma.business.update({
          where: { id: businessId },
          data: { name: businessName },
        });
      }

      const updatedUser = await prisma.businessOwner.update({
        where: { id: userId },
        data: updateData,
        include: {
          business: {
            include: { plan: true },
          },
        },
      });

      res.json(updatedUser);
    } catch (error) {
      console.error("Error updating user profile:", error);
      res.status(500).json({
        error: "Failed to update profile",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
);

// ✅ GET /user
router.get(
  "/user",
  authenticateBusinessOwnerJWT,
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    try {
      const userId = req.businessOwner!.userId;

      const user = await prisma.businessOwner.findUnique({
        where: { id: userId },
        include: {
          business: {
            include: { plan: true },
          },
        },
      });

      if (!user || !user.business) {
        res.status(404).json({ error: "User or business not found" });
        return;
      }

      res.json({
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        address: user.address,
        role: user.role,
        profilePhotoUrl: user.profilePhotoUrl,
        qrCodeUrl: user.qrCodeUrl, // ✅ Correctly placed
        business: {
          id: user.business.id,
          name: user.business.name,
          type: user.business.type,
          logoUrl: user.business.logoUrl,
          plan: {
            name: user.business.plan?.name,
            features: user.business.plan?.features,
            expiresAt: user.business.plan?.expiresAt,
            status: user.business.plan?.status,
          },
        },
      });
    } catch (error) {
      console.error("Get user error:", error);
      res.status(500).json({ error: "Failed to fetch user" });
    }
  }
);

// ✅ POST /register
router.post(
  "/register",
  async (req: Request<{}, {}, RegisterBody>, res: Response): Promise<void> => {
    const {
      name,
      email,
      phone,
      address,
      password,
      role,
      business_name,
      business_type,
    } = req.body;

    try {
      const existingUser = await prisma.businessOwner.findUnique({
        where: { email },
      });
      if (existingUser) {
        res.status(400).json({ message: "Email already registered" }); // unified key
        return;
      }

      const hashedPassword = await bcrypt.hash(password, 12);

      const createdUser = await prisma.$transaction(async (tx: any) => {
        const business = await tx.business.create({
          data: {
            name: business_name,
            type: business_type || "restaurant",
          },
        });

        const user = await tx.businessOwner.create({
          data: {
            name,
            email,
            phone,
            address,
            password: hashedPassword,
            role: role || "Owner",
            business: {
              connect: { id: business.id },
            },
          },
          include: {
            business: true,
          },
        });

        return user;
      });

      res.status(201).json({
        message: "Successfully registered",
        userId: createdUser.id,
        businessId: createdUser.businessId,
      });
    } catch (err: any) {
      console.error("Registration error:", err);

      // Prisma unique constraint
      if (err.code === "P2002" && err.meta?.target?.includes("email")) {
        res.status(400).json({ message: "Email already registered" });
        return;
      }

      res.status(500).json({ message: "Registration failed" });
    }
  }
);


// ✅ POST /login
router.post("/login", async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;

  try {
    // ✅ SuperAdmin Bypass
    if (
      email === "willovateofficial@gmail.com" &&
      password === "Willovate@321"
    ) {
      const tokenPayload: BusinessOwnerPayload = {
        userId: 1,
        email,
        businessId: 1,
        role: "SuperAdmin",
      };
      const token = jwt.sign(
        tokenPayload,
        process.env.JWT_SECRET || "your-secret-key",
        {
          expiresIn: "24h",
        }
      );

      res.json({
        token,
        user: {
          id: 1,
          name: "Super Admin",
          email,
          phone: "0000000000",
          address: "Admin HQ",
          role: "SuperAdmin",
          business: {
            id: 1,
            name: "Willovate HQ",
            type: "Admin",
            logoUrl: "https://cdn-icons-png.flaticon.com/512/149/149071.png",
            themeColor: "#FF5733",
            plan: {
              name: "Super Plan",
              features: ["All Access", "Full Control", "No Expiry"],
              expiresAt: null,
              status: "active",
            },
          },
        },
      });
      return;
    }

    let user = await prisma.businessOwner.findUnique({
      where: { email },
      include: {
        business: {
          include: {
            plan: true,
          },
        },
      },
    });

    if (!user || !user.business) {
      res.status(400).json({ error: "User or business not found" });
      return;
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      res.status(400).json({ error: "Invalid password" });
      return;
    }

    // ✅ Auto-create Free Trial if no plan
    if (!user.business.plan) {
      await prisma.plan.create({
        data: {
          businessId: user.business.id,
          name: "Free Trial",
          features: ["Basic Listing", "Limited Support"],
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      user = await prisma.businessOwner.findUnique({
        where: { email },
        include: {
          business: {
            include: {
              plan: true,
            },
          },
        },
      });

      if (!user || !user.business) {
        res
          .status(500)
          .json({ error: "Failed to fetch user after plan creation" });
        return;
      }
    }

    if (user.businessId === null) {
      res.status(500).json({ error: "User's businessId is null" });
      return;
    }

    const tokenPayload: BusinessOwnerPayload = {
      userId: user.id,
      email: user.email,
      businessId: user.businessId,
      role: user.role as "Owner" | "SuperAdmin",
    };

    const token = jwt.sign(
      tokenPayload,
      process.env.JWT_SECRET || "your-secret-key",
      { expiresIn: "24h" }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        address: user.address,
        role: user.role,
        business: user.business
          ? {
              id: user.business.id,
              name: user.business.name,
              type: user.business.type,
              logoUrl: user.business.logoUrl,
              plan: {
                name: user.business.plan?.name,
                features: user.business.plan?.features,
                expiresAt: user.business.plan?.expiresAt,
                status: user.business.plan?.status,
              },
            }
          : null,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get(
  "/business/:id",
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    try {
      const business = await prisma.business.findUnique({
        where: { id: Number(id) },
        include: {
          users: {
            where: { role: "Owner" },
            select: { email: true },
          },
        },
      });

      if (!business) {
        res.status(404).json({ message: "Business not found" });
        return;
      }

      const responseData = {
        name: business.name,
        logoUrl: business.logoUrl,
      };

      res.json(responseData);
    } catch (err) {
      console.error("❌ Error in fetching business:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

export default router;
