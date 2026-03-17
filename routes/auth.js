import { Router } from 'express';
import { ObjectId } from 'mongodb';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import { getDb } from '../database/mongo.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

const JWT_SECRET      = process.env.JWT_SECRET || 'interviewsathi_jwt_secret_key_2025';
const JWT_EXPIRES     = '7d';
const TEMP_JWT_EXPIRES = '10m';
const OTP_EXPIRY_MS   = 5 * 60 * 1000; // 5 minutes
const BCRYPT_ROUNDS   = 10;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function generateOTP() {
  return crypto.randomInt(100000, 999999).toString();
}

function signSessionToken(user) {
  return jwt.sign(
    { id: user._id.toString(), email: user.email },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES },
  );
}

function signTempToken(email) {
  return jwt.sign({ email }, JWT_SECRET, { expiresIn: TEMP_JWT_EXPIRES });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function sanitiseUser(user) {
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    district: user.district || '',
    state: user.state || '',
    avatar: user.avatar || '',
    createdAt: user.createdAt,
  };
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── 1. POST /send-otp ───────────────────────────────────────────────────────

router.post('/send-otp', async (req, res) => {
  try {
    const rawEmail = req.body.email;
    if (!rawEmail || !emailRegex.test(rawEmail))
      return res.status(400).json({ success: false, message: 'Valid email is required' });

    const email = rawEmail.toLowerCase().trim();

    if (!process.env.SMTP_USER || !process.env.SMTP_PASS)
      return res.status(500).json({ success: false, message: 'Email service not configured' });

    const db  = getDb();
    const otp = generateOTP();

    // Upsert OTP document (one per email)
    await db.collection('otps').updateOne(
      { email },
      { $set: { otp, expiresAt: new Date(Date.now() + OTP_EXPIRY_MS), verified: false } },
      { upsert: true },
    );

    const transporter = createTransporter();
    await transporter.sendMail({
      from: `"InterviewSathi" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Your OTP for InterviewSathi',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#f9fafb;border-radius:12px">
          <h2 style="color:#2F50B7;text-align:center">InterviewSathi</h2>
          <p>Your one-time password is:</p>
          <div style="text-align:center;font-size:32px;letter-spacing:8px;font-weight:bold;color:#2F50B7;padding:16px 0">${otp}</div>
          <p style="color:#666;font-size:13px">This code expires in 5 minutes. Do not share it with anyone.</p>
        </div>`,
    });

    return res.json({ success: true, message: 'OTP sent to your email' });
  } catch (err) {
    console.error('[auth /send-otp]', err);
    return res.status(500).json({ success: false, message: 'Failed to send OTP' });
  }
});

// ─── 2. POST /verify-otp ─────────────────────────────────────────────────────

router.post('/verify-otp', async (req, res) => {
  try {
    const rawEmail = req.body.email;
    const { otp } = req.body;
    if (!rawEmail || !otp)
      return res.status(400).json({ success: false, message: 'Email and OTP are required' });

    const email  = rawEmail.toLowerCase().trim();
    const db     = getDb();
    const record = await db.collection('otps').findOne({ email });

    console.log('[verify-otp] Looking up email:', email, '| Record found:', !!record);

    if (!record)
      return res.status(400).json({ success: false, message: 'No OTP found. Please request a new one' });

    if (new Date() > record.expiresAt)
      return res.status(400).json({ success: false, message: 'OTP expired. Please request a new one' });

    // Constant-time comparison to prevent timing attacks
    if (!crypto.timingSafeEqual(Buffer.from(String(otp)), Buffer.from(String(record.otp))))
      return res.status(400).json({ success: false, message: 'Invalid OTP' });

    // Mark as verified and delete OTP
    await db.collection('otps').deleteOne({ email });

    const tempToken = signTempToken(email);
    return res.json({ success: true, message: 'OTP verified', tempToken });
  } catch (err) {
    console.error('[auth /verify-otp]', err);
    return res.status(500).json({ success: false, message: 'Verification failed' });
  }
});

// ─── 3. POST /signup ──────────────────────────────────────────────────────────

router.post('/signup', async (req, res) => {
  try {
    const { tempToken, name, password } = req.body;
    if (!tempToken || !name || !password)
      return res.status(400).json({ success: false, message: 'tempToken, name and password are required' });

    if (password.length < 6)
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });

    let payload;
    try { payload = verifyToken(tempToken); }
    catch { return res.status(401).json({ success: false, message: 'Invalid or expired token. Please verify OTP again' }); }

    const { email } = payload;
    const db = getDb();

    const existing = await db.collection('users').findOne({ email });
    if (existing)
      return res.status(409).json({ success: false, message: 'Account already exists. Please login' });

    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const now = new Date().toISOString();

    const result = await db.collection('users').insertOne({
      email,
      name: name.trim(),
      password: hashedPassword,
      createdAt: now,
    });

    const user = { _id: result.insertedId, email, name: name.trim(), createdAt: now };
    const token = signSessionToken(user);

    return res.status(201).json({ success: true, message: 'Account created', token, user: sanitiseUser(user) });
  } catch (err) {
    console.error('[auth /signup]', err);
    return res.status(500).json({ success: false, message: 'Signup failed' });
  }
});

// ─── 4. POST /login ──────────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  try {
    const { password } = req.body;
    const rawEmail = req.body.email;
    if (!rawEmail || !password)
      return res.status(400).json({ success: false, message: 'Email and password are required' });

    const email = rawEmail.toLowerCase().trim();
    const db   = getDb();
    const user = await db.collection('users').findOne({ email });

    if (!user)
      return res.status(401).json({ success: false, message: 'Invalid email or password' });

    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.status(401).json({ success: false, message: 'Invalid email or password' });

    const token = signSessionToken(user);
    return res.json({ success: true, message: 'Login successful', token, user: sanitiseUser(user) });
  } catch (err) {
    console.error('[auth /login]', err);
    return res.status(500).json({ success: false, message: 'Login failed' });
  }
});

// ─── 5. POST /reset-password ─────────────────────────────────────────────────

router.post('/reset-password', async (req, res) => {
  try {
    const { tempToken, newPassword } = req.body;
    if (!tempToken || !newPassword)
      return res.status(400).json({ success: false, message: 'tempToken and newPassword are required' });

    if (newPassword.length < 6)
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });

    let payload;
    try { payload = verifyToken(tempToken); }
    catch { return res.status(401).json({ success: false, message: 'Invalid or expired token. Please verify OTP again' }); }

    const { email } = payload;
    const db   = getDb();
    const user = await db.collection('users').findOne({ email });

    if (!user)
      return res.status(404).json({ success: false, message: 'Account not found' });

    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await db.collection('users').updateOne({ email }, { $set: { password: hashedPassword } });

    // Issue fresh session token so the user is logged in immediately
    const updatedUser = { ...user, password: hashedPassword };
    const token = signSessionToken(updatedUser);

    return res.json({ success: true, message: 'Password reset successful', token, user: sanitiseUser(user) });
  } catch (err) {
    console.error('[auth /reset-password]', err);
    return res.status(500).json({ success: false, message: 'Password reset failed' });
  }
});

// ─── 6. POST /update-profile ──────────────────────────────────────────────────

const MAX_AVATAR_SIZE = 500 * 1024; // 500 KB base64 string limit

router.post('/update-profile', authMiddleware, async (req, res) => {
  try {
    const { name, district, state, avatar } = req.body;
    const db = getDb();

    const updates = {};
    if (typeof name === 'string' && name.trim())       updates.name     = name.trim();
    if (typeof district === 'string')                   updates.district = district.trim();
    if (typeof state === 'string')                      updates.state    = state.trim();
    if (typeof avatar === 'string') {
      if (avatar.length > MAX_AVATAR_SIZE)
        return res.status(400).json({ success: false, message: 'Avatar too large (max 500 KB)' });
      updates.avatar = avatar;
    }

    if (Object.keys(updates).length === 0)
      return res.status(400).json({ success: false, message: 'No valid fields to update' });

    await db.collection('users').updateOne(
      { _id: new ObjectId(req.userId) },
      { $set: updates },
    );

    const user = await db.collection('users').findOne(
      { _id: new ObjectId(req.userId) },
    );

    return res.json({ success: true, user: sanitiseUser(user) });
  } catch (err) {
    console.error('[auth /update-profile]', err);
    return res.status(500).json({ success: false, message: 'Profile update failed' });
  }
});

// ─── DEBUG: List all OTPs in MongoDB (remove in production) ──────────────────

router.get('/debug/otps', async (_req, res) => {
  try {
    const db = getDb();
    const otps = await db.collection('otps').find({}).toArray();
    console.log('[debug/otps] All OTP records:', otps);
    return res.json({ success: true, count: otps.length, otps });
  } catch (err) {
    console.error('[debug/otps]', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── DEBUG: List all Users in MongoDB (remove in production) ─────────────────

router.get('/debug/users', async (_req, res) => {
  try {
    const db = getDb();
    const users = await db.collection('users').find({}).project({ password: 0 }).toArray();
    console.log('[debug/users] All user records:', users);
    return res.json({ success: true, count: users.length, users });
  } catch (err) {
    console.error('[debug/users]', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
