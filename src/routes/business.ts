import express, { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import upload from "../middleware/multer";
import {
  authenticateBusinessOwnerJWT,
  BusinessOwnerRequest,
} from "../middleware/authenticateJWT";

const router = Router();
const prisma = new PrismaClient();

interface BusinessBody {
  name?: string;
  type?: string;
  tagline?: string;
}

router.get(
  "/my-business",
  authenticateBusinessOwnerJWT,
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    try {
      const businessId = req.businessOwner?.businessId;

      if (!businessId) {
        res.status(400).json({ error: "Business ID not found in token" });
        return;
      }

      const business = await prisma.business.findUnique({
        where: { id: businessId },
      });

      if (!business) {
        res.status(404).json({ error: "Business not found" });
        return;
      }

      res.json(business);
    } catch (error) {
      res.status(500).json({ error: "Server error" });
    }
  }
);

router.post(
  "/business",
  authenticateBusinessOwnerJWT,
  upload.single("logo"),
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    const { name, type, tagline } = req.body;
    const file = req.file;
    const userId = req.businessOwner?.userId;

    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (!name || !type) {
      res.status(400).json({ error: "Name and Type are required" });
      return;
    }

    if (!file || !file.path) {
      res.status(400).json({ error: "Logo upload failed or missing" });
      return;
    }

    try {
      const user = await prisma.businessOwner.findUnique({
        where: { id: userId },
        include: { business: true },
      });

      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      // If business not created, create it
      if (!user.businessId) {
        const newBusiness = await prisma.business.create({
          data: {
            name,
            type,
            tagline,
            logoUrl: file.path,
          },
        });

        await prisma.businessOwner.update({
          where: { id: userId },
          data: {
            businessId: newBusiness.id,
            role: "owner",
          },
        });

        res.json({
          message: "Business created successfully",
          business: newBusiness,
        });
        return;
      }

      // If already edited once, block further updates
      if (user.restaurantEditCount >= 1) {
        res.status(403).json({
          error:
            "You have already updated your business once. No further updates allowed.",
        });
        return;
      }

      // Update business (allowed only once)
      const updatedBusiness = await prisma.business.update({
        where: { id: user.businessId },
        data: {
          name,
          type,
          tagline,
          logoUrl: file.path,
        },
      });

      await prisma.businessOwner.update({
        where: { id: userId },
        data: {
          restaurantEditCount: { increment: 1 },
        },
      });

      res.json({
        message: "Business updated successfully (once allowed)",
        business: updatedBusiness,
      });
    } catch (error) {
      console.error("Error in creating/updating business:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.get(
  "/business/:id",
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const businessId = parseInt(req.params.id);
    try {
      const business = await prisma.business.findUnique({
        where: { id: businessId },
      });
      if (!business) {
        res.status(404).json({ error: "Business not found" });
        return;
      }
      res.json(business);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.put(
  "/business/:id",
  authenticateBusinessOwnerJWT,
  upload.single("logo"),
  async (
    req: BusinessOwnerRequest & Request<{ id: string }, {}, BusinessBody>,
    res: Response
  ): Promise<void> => {
    const businessId = parseInt(req.params.id);
    const { name, type, tagline } = req.body;
    const file = req.file;
    const userId = req.businessOwner?.userId;

    try {
      const user = await prisma.businessOwner.findUnique({
        where: { id: userId },
      });

      if (!user || user.businessId !== businessId) {
        res.status(403).json({ error: "Unauthorized to update this business" });
        return;
      }

      if (user.restaurantEditCount >= 1) {
        res.status(403).json({
          error:
            "You have already updated your business once. PUT not allowed.",
        });
        return;
      }

      const existingBusiness = await prisma.business.findUnique({
        where: { id: businessId },
      });

      if (!existingBusiness) {
        res.status(404).json({ error: "Business not found" });
        return;
      }

      const data: any = {};
      if (name !== undefined) data.name = name;
      if (type !== undefined) data.type = type;
      if (tagline !== undefined) data.tagline = tagline;
      if (file && file.path) data.logoUrl = file.path;

      const updatedBusiness = await prisma.business.update({
        where: { id: businessId },
        data,
      });

      await prisma.businessOwner.update({
        where: { id: userId },
        data: {
          restaurantEditCount: { increment: 1 },
        },
      });

      res.json({
        message: "Business updated successfully (once allowed)",
        business: updatedBusiness,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
