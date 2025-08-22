import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";

const router = Router();
const prisma = new PrismaClient();

router.get("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId, month, dateRange, day } = req.query;

    if (!businessId || typeof businessId !== "string") {
      res.status(400).json({ error: "Missing or invalid businessId" });
      return;
    }

    const currentYear = new Date().getFullYear();

    const startDay =
      dateRange === "01 - 10" ? 1 : dateRange === "11 - 20" ? 11 : 21;
    const endDay =
      dateRange === "01 - 10" ? 10 : dateRange === "11 - 20" ? 20 : 31;
    const monthIndex = new Date(`${month} 1, ${currentYear}`).getMonth();

    const startDate = new Date(currentYear, monthIndex, startDay);
    const endDate = new Date(currentYear, monthIndex, endDay + 1);

    // ✅ Fetch only SERVED orders
    const orders = await prisma.order.findMany({
      where: {
        businessId: Number(businessId),
        status: "Completed",
        createdAt: {
          gte: startDate,
          lt: endDate,
        },
      },
      include: {
        items: true,
      },
    });

    // Optional: filter by specific day
    let filteredOrders = orders;
    if (day) {
      const selectedDate = dayjs(
        new Date(currentYear, monthIndex, Number(day))
      ).format("YYYY-MM-DD");
      filteredOrders = orders.filter(
        (o:any) => dayjs(o.createdAt).format("YYYY-MM-DD") === selectedDate
      );
    }

    // 📊 Group orders by date
    const ordersByDate = Array.from(
      { length: endDay - startDay + 1 },
      (_, i) => {
        const date = dayjs(startDate).add(i, "day").format("YYYY-MM-DD");
        const count = orders.filter(
          (o:any) => dayjs(o.createdAt).format("YYYY-MM-DD") === date
        ).length;
        return { date, count };
      }
    );

    // 💰 Correct total income calculation using order.totalAmount
    const totalIncome = filteredOrders.reduce((sum:any, order:any) => {
      return sum + Number(order.totalAmount);
    }, 0);

    const totalOrders = filteredOrders.length;

    // 🍽️ Top 5 dishes
    const productMap: Record<string, number> = {};
    filteredOrders.forEach((order : any) => {
      order.items.forEach((item : any) => {
        productMap[item.name] = (productMap[item.name] || 0) + item.quantity;
      });
    });

    const topDishes = Object.entries(productMap)
      .map(([name, orders]) => ({ name, orders }))
      .sort((a, b) => b.orders - a.orders)
      .slice(0, 5);

    res.json({
      orders: ordersByDate,
      totalIncome,
      totalOrders,
      topDishes,
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
