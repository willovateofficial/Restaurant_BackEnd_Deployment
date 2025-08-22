import { Router, Response } from "express";
import { PrismaClient } from "@prisma/client";
import {
  authenticateBusinessOwnerJWT,
  BusinessOwnerRequest,
} from "../middleware/authenticateJWT";

const router = Router();
const prisma = new PrismaClient();

const isRoleAllowed = (role: string | undefined, allowedRoles: string[]) => {
  return allowedRoles.includes(role?.toLowerCase() || "");
};

// ✅ Create inventory item (Only owner, manager, staff)
router.post(
  "/",
  authenticateBusinessOwnerJWT,
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    const { name, quantity, unit, threshold } = req.body;
    const businessId = req.businessOwner?.businessId;
    const role = req.businessOwner?.role;

    if (!isRoleAllowed(role, ["owner", "manager", "staff"])) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    if (!businessId) {
      res.status(400).json({ error: "Business ID missing in token." });
      return;
    }

    try {
      const item = await prisma.inventoryItem.create({
        data: {
          name,
          quantity: Number(quantity),
          unit,
          threshold: Number(threshold),
          businessId,
        },
      });
      res.status(201).json(item);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Inventory creation failed" });
    }
  }
);

// ✅ Get inventory list (All roles)
router.get(
  "/",
  authenticateBusinessOwnerJWT,
  async (req: BusinessOwnerRequest, res: Response) => {
    const businessId = req.businessOwner?.businessId;

    if (!businessId) {
      res.status(400).json({ error: "Business ID missing in token." });
      return;
    }

    try {
      const items = await prisma.inventoryItem.findMany({
        where: { businessId },
      });
      res.json(items);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch inventory" });
    }
  }
);

// ✅ Update inventory (Only owner, manager, staff)
router.put(
  "/:id",
  authenticateBusinessOwnerJWT,
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    const { name, quantity, unit, threshold } = req.body;
    const id = Number(req.params.id);
    const role = req.businessOwner?.role;

    if (!isRoleAllowed(role, ["owner", "manager", "staff"])) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    try {
      const item = await prisma.inventoryItem.update({
        where: { id },
        data: { 
          name,
          quantity: Number(quantity),
          unit,
          threshold: Number(threshold),
        },
      });
      res.json(item);
    } catch (err) {
      res.status(500).json({ error: "Update failed" });
    }
  }
);

// ✅ Delete inventory item (Only owner, manager, staff)
router.delete(
  "/:id",
  authenticateBusinessOwnerJWT,
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    const id = Number(req.params.id);
    const role = req.businessOwner?.role;

    if (!isRoleAllowed(role, ["owner", "manager", "staff"])) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    try {
      await prisma.inventoryItem.delete({
        where: { id },
      });
      res.status(204).send();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to delete inventory item" });
    }
  }
);

export default router;