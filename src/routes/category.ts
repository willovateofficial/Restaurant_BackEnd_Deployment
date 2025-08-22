import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import {
  authenticateBusinessOwnerJWT,
  BusinessOwnerRequest,
} from "../middleware/authenticateJWT";
import upload from "../middleware/multer";

const router = express.Router();
const prisma = new PrismaClient();

// ✅ Create category with image
router.post(
  "/",
  authenticateBusinessOwnerJWT,
  upload.single("image"),
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    try {
      const { name } = req.body;
      const businessId = req.businessOwner?.businessId;
      const file = req.file;
      const imageUrl = file ? file.path : null;

      if (!name || !businessId) {
        res
          .status(400)
          .json({ error: "Category name and businessId required" });
        return;
      }

      const existingBusiness = await prisma.business.findUnique({
        where: { id: businessId },
      });
      if (!existingBusiness) {
        res
          .status(400)
          .json({ error: "Invalid businessId. Business not found." });
        return;
      }

      const category = await prisma.category.create({
        data: {
          name,
          businessId,
          metadata: { imageUrl },
        },
      });

      res.status(201).json(category);
    } catch (error) {
      console.error("Error creating category:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ✅ Get all categories for a business
router.get("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const businessId = parseInt(req.query.businessId as string);
    if (!businessId || isNaN(businessId)) {
      res.status(400).json({ error: "Missing or invalid businessId" });
      return;
    }

    const categories = await prisma.category.findMany({
      where: { businessId },
    });

    const formatted = categories.map((cat:any) => ({
      ...cat,
      imageUrl: (cat.metadata as any)?.imageUrl || null,
    }));

    res.json(formatted);
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ✅ Update category name/image
router.put(
  "/:id",
  authenticateBusinessOwnerJWT,
  upload.single("image"),
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    try {
      const categoryId = parseInt(req.params.id);
      const { name } = req.body;
      const businessId = req.businessOwner?.businessId;
      const file = req.file;

      const category = await prisma.category.findUnique({
        where: { id: categoryId },
      });
      if (!category) {
        res.status(404).json({ error: "Category not found" });
        return;
      }

      if (category.businessId !== businessId) {
        res.status(403).json({ error: "Not allowed to edit this category" });
        return;
      }

      const currentMeta = (category.metadata as any) || {};
      const imageUrl = file ? file.path : currentMeta?.imageUrl || null;

      const updated = await prisma.category.update({
        where: { id: categoryId },
        data: {
          name,
          metadata: { imageUrl },
        },
      });

      res.json(updated);
    } catch (error) {
      console.error("Error updating category:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ✅ Delete category
// ✅ Delete category + all its dishes
router.delete(
  "/:id",
  authenticateBusinessOwnerJWT,
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    try {
      const categoryId = parseInt(req.params.id);
      const businessId = req.businessOwner?.businessId;

      const category = await prisma.category.findUnique({
        where: { id: categoryId },
      });

      if (!category || category.businessId !== businessId) {
        res.status(403).json({ error: "Not allowed to delete this category" });
        return;
      }

      // ** 1. Delete all products that belong to this category and business **
      await prisma.product.deleteMany({
        where: {
          category: category.name,   // assuming product.category is a name string
          businessId: businessId
        },
      });

      // ** 2. Delete the category **
      await prisma.category.delete({
        where: { id: categoryId },
      });

      res.status(200).json({
        message: "Category and its dishes deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting category:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);


export default router;
