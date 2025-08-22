import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import {
  authenticateBusinessOwnerJWT,
  BusinessOwnerRequest,
} from "../middleware/authenticateJWT";

const router = express.Router();
const prisma = new PrismaClient();

// ✅ Save or update WhatsApp API credentials
router.post(
  "/setup",
  authenticateBusinessOwnerJWT,
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    try {
      const businessId = req.businessOwner?.businessId;
      const { phoneNumberId, accessToken, wabaId, whatsappNumber } = req.body;

      if (
        !businessId ||
        !phoneNumberId ||
        !accessToken ||
        !wabaId ||
        !whatsappNumber
      ) {
        res.status(400).json({ error: "All fields are required" });
        return;
      }

      const existing = await prisma.whatsAppCredential.findUnique({
        where: { businessId },
      });

      if (existing) {
        await prisma.whatsAppCredential.update({
          where: { businessId },
          data: { phoneNumberId, accessToken, wabaId, whatsappNumber },
        });
      } else {
        await prisma.whatsAppCredential.create({
          data: {
            businessId,
            phoneNumberId,
            accessToken,
            wabaId,
            whatsappNumber,
          },
        });
      }

      res
        .status(200)
        .json({ message: "WhatsApp credentials saved successfully." });
    } catch (error) {
      console.error("Error saving WhatsApp credentials:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ✅ Get WhatsApp API credentials for a business
router.get("/setup", async (req: Request, res: Response): Promise<void> => {
  try {
    const businessId = parseInt(req.query.businessId as string);
    if (!businessId || isNaN(businessId)) {
      res.status(400).json({ error: "Missing or invalid businessId" });
      return;
    }

    const data = await prisma.whatsAppCredential.findUnique({
      where: { businessId },
    });

    if (!data) {
      res.status(404).json({ error: "WhatsApp credentials not found" });
      return;
    }

    res.json(data);
  } catch (error) {
    console.error("Error fetching WhatsApp credentials:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ✅ Get customer count for a business
router.get(
  "/customer-count",
  authenticateBusinessOwnerJWT,
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    try {
      const businessId = req.businessOwner?.businessId;

      if (!businessId) {
        res.status(400).json({ error: "Missing businessId" });
        return;
      }

      const count = await prisma.customer.count({
        where: { businessId },
      });

      res.json({ count });
    } catch (error) {
      console.error("Error fetching customer count:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ✅ Send Promo Message API (✅ FIXED)
router.post(
  "/send-promo",
  authenticateBusinessOwnerJWT,
  async (req: BusinessOwnerRequest, res: Response): Promise<void> => {
    try {
      const { businessId: rawBusinessId, count } = req.body;
      const businessId = parseInt(rawBusinessId);

      if (!businessId || !count) {
        res.status(400).json({ error: "Missing businessId or count" });
        return;
      }

      // 1. Get business WhatsApp API credentials
      const creds = await prisma.whatsAppCredential.findUnique({
        where: { businessId },
      });

      if (!creds) {
        res.status(404).json({ error: "WhatsApp credentials not found" });
        return;
      }

      // 2. Get the business/restaurant name
      const businessOwner = await prisma.businessOwner.findUnique({
        where: { id: businessId },
        select: { name: true },
      });

      if (!businessOwner) {
        res.status(404).json({ error: "Business owner not found" });
        return;
      }

      // 3. Get X customers
      const customers = await prisma.customer.findMany({
        where: { businessId },
        take: parseInt(count),
      });

      if (!customers.length) {
        res.status(404).json({ error: "No customers found to send messages" });
        return;
      }

      // 4. Prepare WhatsApp message
      const promoMessage = `🎉 Hey there! Check out our new dishes & offers at ${businessOwner.name}!`;

      // 5. Send message to each customer
      const sendResults = await Promise.all(
        customers.map(async (customer:any) => {
          const body = {
            messaging_product: "whatsapp",
            to: customer.mobile,
            type: "text",
            text: { body: promoMessage },
          };

          const response = await fetch(
            `https://graph.facebook.com/v19.0/${creds.phoneNumberId}/messages`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${creds.accessToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(body),
            }
          );

          return { customer: customer.name, status: response.status };
        })
      );

      res.json({
        success: true,
        message: `Promo message sent to ${sendResults.length} customers`,
        results: sendResults,
      });
    } catch (error) {
      console.error("Error sending promo message:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
