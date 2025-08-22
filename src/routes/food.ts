import upload from "../middleware/multer";
import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const router = Router();
const prisma = new PrismaClient();

router.post(
  "/",
  upload.single("image"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        name,
        description,
        fullPrice,
        halfPrice,
        ingredients,
        spicyLevel,
        about,
        userId,
        businessId,
        productType,
      } = req.body;

      if (!userId || isNaN(Number(userId))) {
        res.status(400).json({ error: "Invalid or missing userId" });
        return;
      }

      if (!businessId || isNaN(Number(businessId))) {
        res.status(400).json({ error: "Invalid or missing businessId" });
        return;
      }

      const imageUrl = req.file?.path;

      if (!imageUrl) {
        res.status(400).json({ error: "Image upload failed or image missing" });
        return;
      }

      const productData = {
        name,
        description,
        price: parseFloat(fullPrice),
        businessId: Number(businessId),
        createdBy: Number(userId),
        productType: productType || "food",
        metadata: {
          halfPrice: halfPrice ? parseFloat(halfPrice) : null,
          ingredients,
          spicyLevel: spicyLevel ? parseInt(spicyLevel) : null,
          about,
          image: imageUrl,
        },
      };

      const product = await prisma.product.create({
        data: productData,
      });

      res.json({ message: "Product created", product });
    } catch (error) {
      console.error("Create product error:", error);
      res.status(500).json({ error: "Something went wrong" });
    }
  }
);

router.get("/", async (_req, res) => {
  try {
    const products = await prisma.product.findMany({
      include: { business: true },
    });
    res.json(products);
  } catch (error) {
    console.error("Get products error:", error);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

router.put("/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const { name, description, price, metadata } = req.body;

  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid product id" });
    return;
  }

  try {
    const updatedProduct = await prisma.product.update({
      where: { id },
      data: {
        name,
        description,
        price: price ? Number(price) : undefined,
        metadata: metadata ? metadata : undefined,
      },
    });

    res.json(updatedProduct);
  } catch (error) {
    console.error("Update product error:", error);
    res.status(400).json({ error: "Error updating product" });
  }
});

router.delete("/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);

  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid product id" });
    return;
  }

  try {
    await prisma.product.delete({ where: { id } });
    res.json({ message: "Product deleted" });
  } catch (error) {
    console.error("Delete product error:", error);
    res.status(400).json({ error: "Error deleting product" });
  }
});

export default router;
