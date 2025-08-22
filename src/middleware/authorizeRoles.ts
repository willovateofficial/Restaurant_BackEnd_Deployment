import { Response, NextFunction } from "express";
import { BusinessOwnerRequest } from "./authenticateJWT";

export function authorizeRoles(...allowedRoles: ("Owner" | "SuperAdmin" | "Manager" | "Staff")[]) {
  return (
    req: BusinessOwnerRequest,
    res: Response,
    next: NextFunction
  ): void => {
    const user = req.businessOwner;

    if (!user || !user.role) {
      res.status(401).json({ error: "Unauthorized: No role found" });
      return;
    }

    // Normalize both sides to lowercase for comparison
    const userRole = user.role.toLowerCase();
    const normalizedAllowedRoles = allowedRoles.map((role) => role.toLowerCase());

    if (!normalizedAllowedRoles.includes(userRole)) {
      res.status(403).json({ error: "Forbidden: Insufficient role" });
      return;
    }

    next();
  };
}
