import express from "express";
import { PrismaClient } from "@prisma/client";
import nodemailer from "nodemailer";
import bcrypt from "bcrypt";

const router = express.Router();
const prisma = new PrismaClient();

// Simple in-memory rate limiter (per email)
const otpRequestTimes: Record<string, number[]> = {};
const OTP_REQUEST_LIMIT = 5; // max 5 requests
const OTP_WINDOW_MS = 60 * 60 * 1000; // 1 hour window

function cleanOldRequests(times: number[]) {
  const cutoff = Date.now() - OTP_WINDOW_MS;
  return times.filter((t) => t > cutoff);
}

// POST /api/password-reset - send OTP
router.post("/", async (req, res): Promise<void> => {
  let { email } = req.body;
  if (!email) {
    res.status(400).json({ error: "Email is required" });
    return;
  }
  email = email.toLowerCase();

  // Rate limiting check
  otpRequestTimes[email] = cleanOldRequests(otpRequestTimes[email] || []);
  if (otpRequestTimes[email].length >= OTP_REQUEST_LIMIT) {
    res
      .status(429)
      .json({ error: "Too many OTP requests. Please try again later." });
    return;
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // valid for 10 minutes

  try {
    // Clear previous OTPs for this email
    await prisma.passwordReset.deleteMany({ where: { email } });

    await prisma.passwordReset.create({
      data: { email, otp, expiresAt },
    });

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: `"Willovate Services" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Password Reset OTP",
      html: `<p>Your OTP for password reset is: <strong>${otp}</strong>. It expires in 10 minutes.</p>`,
    });

    // Track request time for rate limiting
    otpRequestTimes[email].push(Date.now());

    res.status(200).json({ message: "OTP sent to email" });
  } catch (error) {
    console.error("Error sending OTP:", error);
    res.status(500).json({ error: "Failed to send OTP" });
  }
});

// POST /api/password-reset/verify - verify OTP
router.post("/verify", async (req, res): Promise<void> => {
  let { email, otp } = req.body;
  if (!email || !otp) {
    res.status(400).json({ error: "Email and OTP are required" });
    return;
  }
  email = email.toLowerCase();

  try {
    const now = new Date();
    const record = await prisma.passwordReset.findFirst({
      where: {
        email,
        otp,
        expiresAt: { gte: now },
      },
    });

    if (!record) {
      res.status(400).json({ error: "Invalid or expired OTP" });
      return;
    }

    res.status(200).json({ message: "OTP verified" });
  } catch (error) {
    console.error("Error verifying OTP:", error);
    res.status(500).json({ error: "Verification failed" });
  }
});

// POST /api/password-reset/change - change password
router.post("/change", async (req, res): Promise<void> => {
  let { email, newPassword } = req.body;

  if (!email || !newPassword) {
    res.status(400).json({ error: "Email and newPassword are required" });
    return;
  }

  email = email.toLowerCase();

  try {
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.businessOwner.update({
      where: { email },
      data: { password: hashedPassword },
    });

    // Remove all password reset tokens for this email
    await prisma.passwordReset.deleteMany({ where: { email } });

    res.status(200).json({ message: "Password changed successfully" });
  } catch (error: any) {
    console.error("Error changing password:", error);

    if (error.code === "P2025") {
      res.status(404).json({ error: "User not found" });
    } else {
      res.status(500).json({ error: "Password update failed" });
    }
  }
});

export default router;
