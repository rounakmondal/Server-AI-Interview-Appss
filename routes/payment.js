import { Router } from 'express';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { ObjectId } from 'mongodb';
import { getDb } from '../database/mongo.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// Razorpay instance — created lazily so dotenv.config() runs first
let _razorpay = null;
function getRazorpay() {
  if (!_razorpay) {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set in .env');
    }
    _razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return _razorpay;
}

// Plan config (amounts in paise — INR × 100)
const PLANS = {
  // ₹9 — one-time, unlocks a single specific exam forever
  single_exam: {
    amount: 900,
    currency: 'INR',
    label: 'Single Exam Pass',
    durationDays: 0, // never expires — stored as permanent flag
  },
  // ₹29/month — unlocks all exams (no PDF)
  monthly_pass: {
    amount: 2900,
    currency: 'INR',
    label: 'All Exams Monthly Pass',
    durationDays: 30,
  },
  // ₹99/month — all exams + PDF downloads
  pro_monthly: {
    amount: 9900,
    currency: 'INR',
    label: 'Pro Monthly (All exams + PDF)',
    durationDays: 30,
  },
};

// ─── POST /api/payment/create-order ─────────────────────────────────────────
// Creates a Razorpay order for the requested plan
router.post('/create-order', authMiddleware, async (req, res) => {
  try {
    const { plan, examType, couponCode } = req.body; // examType required for single_exam plan

    if (!PLANS[plan]) {
      return res.status(400).json({ success: false, message: 'Invalid plan selected.' });
    }

    if (plan === 'single_exam' && !examType) {
      return res.status(400).json({ success: false, message: 'examType is required for single exam pass.' });
    }

    const planConfig = PLANS[plan];
    let finalAmount = planConfig.amount;
    let appliedCoupon = null;

    // Apply coupon if provided
    if (couponCode) {
      const db = getDb();
      const coupon = await db.collection('coupons').findOne({
        code: couponCode.toUpperCase().trim(),
        active: true,
      });

      if (coupon) {
        const expired = coupon.expiresAt && new Date(coupon.expiresAt) < new Date();
        const limitReached = coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses;
        const wrongPlan = coupon.minPlan && coupon.minPlan !== plan;

        if (!expired && !limitReached && !wrongPlan) {
          if (coupon.discountType === 'percent') {
            finalAmount = Math.round(finalAmount * (1 - coupon.discount / 100));
          } else {
            finalAmount = Math.max(100, finalAmount - coupon.discount * 100); // min ₹1
          }
          appliedCoupon = coupon;
        }
      }
    }

    const order = await getRazorpay().orders.create({
      amount: finalAmount,
      currency: planConfig.currency,
      receipt: `r_${req.userId.slice(-8)}_${Date.now().toString().slice(-10)}`,
      notes: {
        userId: req.userId,
        plan,
        label: planConfig.label,
        examType: examType || '',
        couponCode: appliedCoupon?.code || '',
      },
    });

    res.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      originalAmount: planConfig.amount,
      couponApplied: appliedCoupon ? {
        code: appliedCoupon.code,
        label: appliedCoupon.discountType === 'percent'
          ? `${appliedCoupon.discount}% off`
          : `₹${appliedCoupon.discount} off`,
      } : null,
    });
  } catch (err) {
    console.error('[payment] create-order error:', err);
    res.status(500).json({ success: false, message: 'Failed to create payment order.' });
  }
});

// ─── POST /api/payment/verify ────────────────────────────────────────────────
// Verifies Razorpay signature and activates premium for the user
router.post('/verify', authMiddleware, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan, examType, couponCode } = req.body;

    // 1. Verify signature
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Payment verification failed.' });
    }

    // 2. Validate plan
    const planConfig = PLANS[plan];
    if (!planConfig) {
      return res.status(400).json({ success: false, message: 'Invalid plan.' });
    }

    // 3. Update user premium status in MongoDB
    const db = getDb();
    const now = new Date();

    let premiumUpdate;

    if (plan === 'single_exam') {
      // Push examType into a set of unlocked exams (permanent)
      premiumUpdate = {
        $set: {
          'premium.active': true,
          'premium.plan': 'single_exam',
          'premium.lastPaymentId': razorpay_payment_id,
          'premium.lastOrderId': razorpay_order_id,
        },
        $addToSet: {
          'premium.unlockedExams': examType,
        },
      };
    } else {
      // monthly_pass or pro_monthly — timed subscription
      const expiresAt = new Date(now.getTime() + planConfig.durationDays * 24 * 60 * 60 * 1000);
      premiumUpdate = {
        $set: {
          'premium.active': true,
          'premium.plan': plan,
          'premium.activatedAt': now,
          'premium.expiresAt': expiresAt,
          'premium.lastPaymentId': razorpay_payment_id,
          'premium.lastOrderId': razorpay_order_id,
        },
      };
    }

    await db.collection('users').updateOne({ _id: new ObjectId(req.userId) }, premiumUpdate);

    // 4. Store payment record
    await db.collection('payments').insertOne({
      userId: req.userId,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      plan,
      examType: examType || null,
      couponCode: couponCode || null,
      amount: planConfig.amount,
      currency: planConfig.currency,
      paidAt: now,
    });

    // 5. Increment coupon usage count if a coupon was used
    if (couponCode) {
      await db.collection('coupons').updateOne(
        { code: couponCode.toUpperCase().trim() },
        { $inc: { usedCount: 1 } }
      );
    }

    // 5. Return updated status
    const updatedUser = await db.collection('users').findOne(
      { _id: new ObjectId(req.userId) },
      { projection: { premium: 1 } }
    );

    res.json({
      success: true,
      message: 'Payment verified. Access activated!',
      premium: updatedUser?.premium || {},
    });
  } catch (err) {
    console.error('[payment] verify error:', err);
    res.status(500).json({ success: false, message: 'Server error during payment verification.' });
  }
});

// ─── GET /api/payment/status ─────────────────────────────────────────────────
// Returns current premium status for the logged-in user
router.get('/status', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const user = await db.collection('users').findOne(
      { _id: new ObjectId(req.userId) },
      { projection: { premium: 1 } }
    );

    const premium = user?.premium || { active: false, unlockedExams: [] };
    if (!premium.unlockedExams) premium.unlockedExams = [];

    // Auto-deactivate timed plans if expired
    if (premium.active && premium.expiresAt && new Date(premium.expiresAt) < new Date()) {
      premium.active = false;
      await db.collection('users').updateOne(
        { _id: new ObjectId(req.userId) },
        { $set: { 'premium.active': false } }
      );
    }

    res.json({ success: true, premium });
  } catch (err) {
    console.error('[payment] status error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch premium status.' });
  }
});

export default router;
