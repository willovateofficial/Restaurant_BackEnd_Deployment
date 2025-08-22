import { Router, Response } from "express";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import {
  authenticateBusinessOwnerJWT,
  BusinessOwnerRequest,
} from "../middleware/authenticateJWT";
import { authorizeRoles } from "../middleware/authorizeRoles";

const router = Router();
const prisma = new PrismaClient();

interface AddUserBody {
  name: string;
  email: string;
  password: string;
  role: string; // Owner, Manager, Staff
  phone?: string;
  address?: string;
}

interface EditUserBody {
  name?: string;
  password?: string;
  role?: string;
  phone?: string;
  address?: string;
}

// CREATE User
router.post(
  "/business/:businessId/add-user",
  authenticateBusinessOwnerJWT,
  authorizeRoles("Owner", "Manager"),
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    const { businessId } = req.params;
    const { name, email, password, role, phone, address } =
      req.body as AddUserBody;

    if (!req.businessOwner) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const businessIdNum = Number(businessId);
    if (isNaN(businessIdNum)) {
      res.status(400).json({ error: "Invalid business ID" });
      return;
    }

    // Verify logged-in user belongs to this business
    if (req.businessOwner.businessId !== businessIdNum) {
      res.status(403).json({ error: "You do not belong to this business" });
      return;
    }

    try {
      // Check if business exists
      const business = await prisma.business.findUnique({
        where: { id: businessIdNum },
      });
      if (!business) {
        res.status(404).json({ error: "Business not found" });
        return;
      }

      // Check if user with same email already exists
      const existingUser = await prisma.businessOwner.findUnique({
        where: { email },
      });
      if (existingUser) {
        res.status(400).json({ error: "Email already exists" });
        return;
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create new user linked to the business
      const newUser = await prisma.businessOwner.create({
        data: {
          name,
          email,
          phone,
          address,
          password: hashedPassword,
          businessId: businessIdNum,
          role,
        },
      });

      res.status(201).json({
        message: "User added successfully",
        userId: newUser.id,
      });
    } catch (error) {
      console.error("Add user error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// READ Users
router.get(
  "/business/:businessId/users",
  authenticateBusinessOwnerJWT,
  authorizeRoles("Owner", "Manager", "Staff"),
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    const { businessId } = req.params;
    const businessIdNum = Number(businessId);

    if (isNaN(businessIdNum)) {
      res.status(400).json({ error: "Invalid business ID" });
      return;
    }

    if (!req.businessOwner) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (req.businessOwner.businessId !== businessIdNum) {
      res.status(403).json({ error: "You do not belong to this business" });
      return;
    }

    try {
      const users = await prisma.businessOwner.findMany({
        where: { businessId: businessIdNum },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          phone: true,
          address: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      });

      res.json({ users });
    } catch (error) {
      console.error("Get users error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// UPDATE User
router.put(
  "/users/:userId",
  authenticateBusinessOwnerJWT,
  authorizeRoles("Owner", "Manager"),
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    const { userId } = req.params;
    const { name, password, role, phone, address } = req.body as EditUserBody;

    if (!req.businessOwner) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const userIdNum = Number(userId);
    if (isNaN(userIdNum)) {
      res.status(400).json({ error: "Invalid user ID" });
      return;
    }

    try {
      // Find user to update
      const userToUpdate = await prisma.businessOwner.findUnique({
        where: { id: userIdNum },
      });

      if (!userToUpdate) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      // Verify the user belongs to the same business as logged-in user
      if (userToUpdate.businessId !== req.businessOwner.businessId) {
        res
          .status(403)
          .json({ error: "You do not have permission to update this user" });
        return;
      }

      // Prevent role change if user is Owner
      if (userToUpdate.role === "Owner" && role && role !== "Owner") {
        res.status(403).json({ error: "Cannot change role of an Owner user" });
        return;
      }

      // Hash password if provided
      let hashedPassword: string | undefined = undefined;
      if (password && password.trim() !== "") {
        hashedPassword = await bcrypt.hash(password, 10);
      }

      // Update user
      const updatedUser = await prisma.businessOwner.update({
        where: { id: userIdNum },
        data: {
          name,
          role,
          phone,
          address,
          ...(hashedPassword ? { password: hashedPassword } : {}),
        },
      });

      res.json({
        message: "User updated successfully",
        userId: updatedUser.id,
      });
    } catch (error) {
      console.error("Update user error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// DELETE User
router.delete(
  "/users/:userId",
  authenticateBusinessOwnerJWT,
  authorizeRoles("Owner", "Manager"),
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    const { userId } = req.params;

    if (!req.businessOwner) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const userIdNum = Number(userId);
    if (isNaN(userIdNum)) {
      res.status(400).json({ error: "Invalid user ID" });
      return;
    }

    try {
      const userToDelete = await prisma.businessOwner.findUnique({
        where: { id: userIdNum },
      });

      if (!userToDelete) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      if (userToDelete.businessId !== req.businessOwner.businessId) {
        res
          .status(403)
          .json({ error: "You do not have permission to delete this user" });
        return;
      }

      if (userToDelete.role === "Owner") {
        res.status(403).json({ error: "Cannot delete an Owner user" });
        return;
      }

      await prisma.businessOwner.delete({
        where: { id: userIdNum },
      });

      res.json({ message: "User deleted successfully" });
    } catch (error) {
      console.error("Delete user error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
