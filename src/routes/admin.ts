import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { authenticateBusinessOwnerJWT } from "../middleware/authenticateJWT";

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/admin/all-users
router.get(
  "/all-users",
  authenticateBusinessOwnerJWT,
  async (req: Request, res: Response) => {
    try {
      const users = await prisma.businessOwner.findMany({
        include: {
          business: true,
        },
      });

      const formattedUsers = await Promise.all(
        users.map(async (user:any) => {
          let latestPlan = null;

          if (user.business) {
            latestPlan = await prisma.plan.findUnique({
              where: {
                businessId: user.business.id,
              },
            });

            console.log(
              "User:",
              user.email,
              "Business ID:",
              user.business.id,
              "Plan:",
              latestPlan?.name
            );
          }

          return {
            name: user.name,
            email: user.email,
            phone: user.phone,
            address: user.address,
            business: user.business
              ? {
                  id: user.business.id,
                  name: user.business.name,
                  plan: latestPlan
                    ? {
                        name: latestPlan.name,
                        features: latestPlan.features,
                        expiresAt: latestPlan.expiresAt.toISOString(),
                        paymentProofUrl: latestPlan.paymentProofUrl,
                        status: latestPlan.status,
                      }
                    : null,
                }
              : null,
          };
        })
      );

      res.status(200).json({ users: formattedUsers });
    } catch (error) {
      console.error("Admin fetch error:", error);
      res.status(500).json({ error: "Failed to fetch user data" });
    }
  }
);

export default router;
