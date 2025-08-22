import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

// BusinessOwner token payload
export interface BusinessOwnerPayload {
  userId: number;
  email: string;
  businessId: number;
  role: "Owner" | "SuperAdmin";
}

export interface CustomerPayload {
  customerId: number;
  email: string;
  businessId: number;
}

// Extend request interfaces
export interface BusinessOwnerRequest extends Request {
  businessOwner?: BusinessOwnerPayload;
}

export interface CustomerRequest extends Request {
  customer?: CustomerPayload;
}

// Middleware for BusinessOwner
export function authenticateBusinessOwnerJWT(
  req: BusinessOwnerRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authorization token missing" });
    return;
  }

  const token = authHeader.split(" ")[1];

  try {
    const secret = process.env.JWT_SECRET || "your-secret-key";
    const payload = jwt.verify(token, secret) as BusinessOwnerPayload;
    req.businessOwner = payload;
    next();
  } catch (error) {
    console.error("❌ BusinessOwner JWT verification failed:", error);
    res.status(403).json({ error: "Invalid or expired token" });
  }
}

// Middleware for Customer
export function authenticateCustomerJWT(
  req: CustomerRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authorization token missing" });
    return;
  }

  const token = authHeader.split(" ")[1];

  try {
    const secret = process.env.JWT_SECRET || "your-secret-key";
    const payload = jwt.verify(token, secret) as CustomerPayload;
    req.customer = payload;
    next();
  } catch (error) {
    console.error("❌ Customer JWT verification failed:", error);
    res.status(403).json({ error: "Invalid or expired token" });
  }
}
