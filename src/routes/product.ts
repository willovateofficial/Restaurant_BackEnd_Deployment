import upload from "../middleware/multer";
import { Router, Response } from "express";
import { PrismaClient, Prisma } from "@prisma/client";
import { authenticateBusinessOwnerJWT, BusinessOwnerRequest } from "../middleware/authenticateJWT";

const router = Router();
const prisma = new PrismaClient();

// ✅ Create a product
router.post(
  "/",
  authenticateBusinessOwnerJWT,
  upload.array("images", 10),
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    try {
      const { name, description, price, productType, category, metadata } = req.body;
      const businessId = req.businessOwner?.businessId;

      if (!name || !price || !businessId) {
        res.status(400).json({ error: "Missing required fields" });
        return;
      }

      const files = req.files as Express.Multer.File[] | undefined;
      if (!files || files.length === 0) {
        res.status(400).json({ error: "Images upload failed or missing" });
        return;
      }

      const imageUrls = files.map((file) => file.path);

      let parsedMetadata = {};
      if (metadata) {
        try {
          parsedMetadata =
            typeof metadata === "string" ? JSON.parse(metadata) : metadata;
        } catch (e) {
          console.warn("Failed to parse metadata JSON:", e);
        }
      }

      const finalMetadata = { ...parsedMetadata, images: imageUrls };

      const product = await prisma.product.create({
        data: {
          name,
          description,
          price: Number(price),
          businessId,
          productType: productType || "generic",
          category: category || null,
          metadata: finalMetadata,
          isActive: true,
        },
      });

      res.status(201).json(product);
    } catch (error) {
      console.error("Create product error:", error);
      res.status(500).json({ error: "Failed to create product" });
    }
  }
);

// ✅ Get all products for a business
router.get("/", async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
  try {
    const queryBusinessId = req.query.businessId as string;

    if (!queryBusinessId || isNaN(Number(queryBusinessId))) {
      res.status(400).json({ error: "Valid Business ID is required" });
      return;
    }

    const products = await prisma.product.findMany({
      where: { businessId: Number(queryBusinessId) },
    });

    res.json(products);
  } catch (error) {
    console.error("Get products error:", error);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

// ✅ Get single product by ID
router.get(
  "/:id",
  authenticateBusinessOwnerJWT,
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    try {
      const id = Number(req.params.id);
      const businessId = req.businessOwner?.businessId;

      const product = await prisma.product.findFirst({
        where: { id, businessId },
        include: { business: true },
      });

      if (!product) {
        res.status(404).json({ error: "Product not found or not authorized" });
        return;
      }

      res.json(product);
    } catch (error) {
      console.error("Get product error:", error);
      res.status(500).json({ error: "Failed to fetch product" });
    }
  }
);

// ✅ Update product
router.put(
  "/:id",
  authenticateBusinessOwnerJWT,
  upload.array("images", 10),
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    try {
      const id = Number(req.params.id);
      const businessId = req.businessOwner?.businessId;

      const { name, description, price, productType, category, metadata, isActive } = req.body;

      let parsedMetadata: any = {};
      if (metadata) {
        try {
          parsedMetadata =
            typeof metadata === "string" ? JSON.parse(metadata) : metadata;
        } catch (e) {
          console.warn("Failed to parse metadata JSON:", e);
        }
      }

      const files = req.files as Express.Multer.File[] | undefined;
      const newImageUrls = files ? files.map((file) => file.path) : [];

      const existingProduct = await prisma.product.findFirst({
        where: { id, businessId },
      });

      if (!existingProduct) {
        res.status(404).json({ error: "Product not found or not authorized" });
        return;
      }

      let oldImages: string[] = [];
      if (
        existingProduct?.metadata &&
        typeof existingProduct.metadata === "object" &&
        !Array.isArray(existingProduct.metadata) &&
        "images" in existingProduct.metadata &&
        Array.isArray(existingProduct.metadata.images)
      ) {
        oldImages = existingProduct.metadata.images.filter(
          (img): img is string => typeof img === "string"
        );
      }

      if (newImageUrls.length > 0) {
        parsedMetadata.images = newImageUrls;
      } else if (oldImages.length > 0) {
        parsedMetadata.images = oldImages;
      }

      const updateData: any = {
        name,
        description,
        price: price !== undefined ? Number(price) : undefined,
        productType,
        category: category || undefined,
        metadata: parsedMetadata,
      };

      if (isActive !== undefined) {
        updateData.isActive = isActive === "true" || isActive === true;
      }

      Object.keys(updateData).forEach((key) => {
        if (updateData[key] === undefined) delete updateData[key];
      });

      const updatedProduct = await prisma.product.update({
        where: { id },
        data: updateData,
      });

      res.json(updatedProduct);
    } catch (error) {
      console.error("Update product error:", error);
      res.status(500).json({ error: "Failed to update product" });
    }
  }
);

// ✅ Bulk delete products by categoryId (using category name lookup)
router.delete(
  "/",
  authenticateBusinessOwnerJWT,
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    try {
      const categoryId = Number(req.query.categoryId);
      const businessId = req.businessOwner?.businessId;

      if (!businessId) {
        res.status(403).json({ error: "Unauthorized - Business ID missing" });
        return;
      }

      if (!categoryId || isNaN(categoryId)) {
        res.status(400).json({ error: "Valid categoryId is required" });
        return;
      }

      // Find category by ID
      const categoryRecord = await prisma.category.findUnique({
        where: { id: categoryId },
      });

      if (!categoryRecord) {
        res.status(404).json({ error: "Category not found" });
        return;
      }

      // Delete all products with that category name for this business
      await prisma.product.deleteMany({
        where: { category: categoryRecord.name, businessId },
      });

      res.status(200).json({ message: "All dishes in category deleted" });
    } catch (error) {
      console.error("Error bulk deleting products:", error);
      res.status(500).json({ error: "Failed to bulk delete products" });
    }
  }
);

// ✅ Delete single product by ID
router.delete(
  "/:id",
  authenticateBusinessOwnerJWT,
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    try {
      const id = Number(req.params.id);
      const businessId = req.businessOwner?.businessId;

      if (!businessId) {
        res.status(403).json({ error: "Unauthorized - Business ID missing" });
        return;
      }

      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid product ID" });
        return;
      }

      const existingProduct = await prisma.product.findFirst({
        where: { id, businessId },
      });

      if (!existingProduct) {
        res.status(404).json({ error: "Product not found or not authorized" });
        return;
      }

      await prisma.product.delete({ where: { id } });
      res.status(200).json({ message: "Product deleted successfully" });
    } catch (error) {
      console.error("Delete product error:", error);
      res.status(500).json({ error: "Failed to delete product" });
    }
  }
);

export default router;