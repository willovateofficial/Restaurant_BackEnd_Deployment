import { Router, Response } from "express";
import { PrismaClient } from "@prisma/client";
import {
  authenticateBusinessOwnerJWT,
  BusinessOwnerRequest,
} from "../middleware/authenticateJWT";

const router = Router();
const prisma = new PrismaClient();

// Helper: Backend → Frontend
const mapBackendToFrontendStatus = (backendStatus: string): string => {
  switch (backendStatus) {
    case "active":
      return "verified";
    case "expired":
    case "cancelled":
      return "unverified";
    case "pending":
    default:
      return "pending";
  }
};

// Helper: Frontend → Backend
const mapFrontendToBackendStatus = (frontendStatus: string): string => {
  switch (frontendStatus) {
    case "verified":
      return "active";
    case "unverified":
      return "expired";
    case "pending":
    default:
      return "pending";
  }
};

// ✅ CHECK subscription status
router.get(
  "/subscription/status/:businessId",
  authenticateBusinessOwnerJWT,
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    try {
      const businessId = parseInt(req.params.businessId);
      const subscription = await prisma.plan.findUnique({
        where: { businessId },
      });

      if (!subscription) {
        res.status(404).json({ message: "No subscription found" });
        return;
      }

      const currentDate = new Date();
      const isExpired = subscription.expiresAt < currentDate;
      let updatedStatus = subscription.status;

      // ✅ Auto-mark as expired if past expiresAt
      if (isExpired && subscription.status === "active") {
        await prisma.plan.update({
          where: { businessId },
          data: { status: "expired" },
        });
        updatedStatus = "expired";
      }

      const isVerified = updatedStatus === "active";

      res.status(200).json({
        subscription: {
          ...subscription,
          status: updatedStatus,
          displayStatus: mapBackendToFrontendStatus(updatedStatus),
          isVerified,
          isExpired,
        },
      });
    } catch (error) {
      console.error("Error getting subscription status:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// ✅ UPSERT a plan (create or update)
// ✅ UPSERT a plan (create or update)
router.post(
  "/plan",
  authenticateBusinessOwnerJWT,
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    let { name, features, expiresAt, paymentProofUrl, status } = req.body;
    const businessId = req.businessOwner?.businessId;

    if (!businessId) {
      res.status(400).json({ error: "Business ID missing in token" });
      return;
    }

    if (status && ["verified", "unverified", "pending"].includes(status)) {
      status = mapFrontendToBackendStatus(status);
    }

    const now = new Date();

    try {
      const existingPlan = await prisma.plan.findUnique({
        where: { businessId },
      });

      // ✅ Prevent double verified plans
      if (
        existingPlan &&
        existingPlan.status === "active" &&
        existingPlan.expiresAt &&
        existingPlan.expiresAt > now
      ) {
        res.status(400).json({
          error: "Verified subscription already exists",
          message:
            "Aapka subscription already verified hai. Dobara subscription nahi le sakte.",
          existingPlan: {
            name: existingPlan.name,
            status: mapBackendToFrontendStatus(existingPlan.status),
            expiresAt: existingPlan.expiresAt,
          },
        });
        return;
      }

      // ✅ Auto-expiry logic based on name
      if (name?.toLowerCase() === "trial" || name === "Free Trial") {
        name = "Free Trial";
        expiresAt = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000); // +5 days
      } else if (
        name?.toLowerCase().includes("monthly")
      ) {
        expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // +30 days
      } else if (
        name?.toLowerCase().includes("annual") ||
        name?.toLowerCase().includes("yearly")
      ) {
        expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // +1 year
      } else if (!expiresAt) {
        expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // fallback: +30 days
      } else {
        expiresAt = new Date(expiresAt); // use provided
      }

      const plan = await prisma.plan.upsert({
        where: { businessId },
        update: {
          name,
          features,
          expiresAt,
          paymentProofUrl,
          status,
        },
        create: {
          businessId,
          name,
          features,
          expiresAt,
          paymentProofUrl,
          status,
        },
      });

      res.status(200).json({
        message: "Plan created or updated successfully",
        plan: {
          ...plan,
          displayStatus: mapBackendToFrontendStatus(plan.status),
        },
      });
    } catch (error) {
      console.error("Upsert plan error:", error);
      res.status(500).json({ error: "Failed to create or update plan" });
    }
  }
);

// ✅ READ current plan
// ✅ READ current plan
router.get(
  "/plan",
  authenticateBusinessOwnerJWT,
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    const businessId = req.businessOwner?.businessId;

    if (!businessId) {
      res.status(401).json({ message: "Unauthorized: Business not found in token" });
      return;
    }

    try {
      const existingPlan = await prisma.plan.findUnique({
        where: { businessId },
      });

      if (!existingPlan) {
        res.status(404).json({ message: "No plan found" });
        return;
      }

      const currentDate = new Date();
      const isExpired = existingPlan.expiresAt < currentDate;
      let updatedStatus = existingPlan.status;

      if (isExpired && existingPlan.status === "active") {
        await prisma.plan.update({
          where: { businessId },
          data: { status: "expired" },
        });
        updatedStatus = "expired";
      }

      res.status(200).json({
        ...existingPlan,
        status: updatedStatus,
        displayStatus: mapBackendToFrontendStatus(updatedStatus),
        isExpired,
      });
    } catch (error) {
      console.error("Error fetching plan", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);


// ✅ DELETE plan (with businessId check)
router.delete(
  "/plan/:businessId",
  authenticateBusinessOwnerJWT,
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    const businessId = Number(req.params.businessId);
    const userBusinessId = req.businessOwner?.businessId;

    if (userBusinessId !== businessId) {
      res.status(403).json({ error: "Unauthorized to delete this plan" });
      return;
    }

    try {
      await prisma.plan.delete({ where: { businessId } });
      res.status(200).json({ message: "Plan deleted successfully" });
    } catch (error) {
      console.error("Delete plan error:", error);
      res.status(500).json({ error: "Failed to delete plan" });
    }
  }
);

// ✅ UPDATE plan status (with businessId check)
router.patch(
  "/plan/:businessId/status",
  authenticateBusinessOwnerJWT,
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    const businessId = Number(req.params.businessId);
    const user = req.businessOwner;

    // ✅ Allow only SuperAdmin or same-business users
    if (user?.role !== "SuperAdmin" && user?.businessId !== businessId) {
      res.status(403).json({ error: "Unauthorized to update this plan" });
      return;
    }

    let { status } = req.body;
    const validFrontendStatuses = ["verified", "unverified", "pending"];
    const validBackendStatuses = ["pending", "active", "expired", "cancelled"];

    if (validFrontendStatuses.includes(status)) {
      status = mapFrontendToBackendStatus(status);
    } else if (!validBackendStatuses.includes(status)) {
      res.status(400).json({
        error: "Invalid status value",
        message:
          "Use: verified, unverified, pending (or backend equivalents: active, expired, pending, cancelled)",
      });
      return;
    }

    try {
      const currentPlan = await prisma.plan.findUnique({
        where: { businessId },
      });

      if (!currentPlan) {
        res.status(404).json({ error: "Plan not found" });
        return;
      }

      // Prevent re-verification if already active
      if (currentPlan.status === "active" && status === "active") {
        res.status(400).json({
          error: "Plan already verified",
          message:
            "Yeh plan already verified hai. Dobara verify nahi kar sakte.",
          plan: {
            ...currentPlan,
            displayStatus: mapBackendToFrontendStatus(currentPlan.status),
          },
        });
        return;
      }

      const updatedPlan = await prisma.plan.update({
        where: { businessId },
        data: { status },
      });

      let successMessage = "Plan status updated successfully";
      if (status === "active") successMessage = "Plan verified successfully";
      else if (status === "expired")
        successMessage = "Plan marked as unverified";
      else if (status === "pending")
        successMessage = "Plan status set to pending";

      res.status(200).json({
        message: successMessage,
        plan: {
          ...updatedPlan,
          displayStatus: mapBackendToFrontendStatus(updatedPlan.status),
        },
      });
    } catch (error) {
      console.error("Update plan status error:", error);
      res.status(500).json({ error: "Failed to update plan status" });
    }
  }
);

export default router;
