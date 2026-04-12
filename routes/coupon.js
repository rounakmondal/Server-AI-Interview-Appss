import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../database/mongo.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// ─── Admin guard ──────────────────────────────────────────────────────────────
function adminMiddleware(req, res, next) {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) {
    return res.status(500).json({ success: false, message: 'ADMIN_EMAIL not configured.' });
  }
  if (req.email !== adminEmail) {
    return res.status(403).json({ success: false, message: 'Admin access required.' });
  }
  next();
}

// ─── POST /api/coupon/validate ────────────────────────────────────────────────
// Any logged-in user can validate a coupon before paying
router.post('/validate', authMiddleware, async (req, res) => {
  try {
    const { code, plan } = req.body;
    if (!code) return res.status(400).json({ success: false, message: 'Coupon code required.' });

    const db = getDb();
    const coupon = await db.collection('coupons').findOne({
      code: code.toUpperCase().trim(),
      active: true,
    });

    if (!coupon) return res.status(404).json({ success: false, message: 'Invalid coupon code.' });

    if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
      return res.status(400).json({ success: false, message: 'Coupon has expired.' });
    }

    if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
      return res.status(400).json({ success: false, message: 'Coupon usage limit reached.' });
    }

    if (coupon.minPlan && plan && coupon.minPlan !== plan) {
      return res.status(400).json({
        success: false,
        message: `This coupon is only valid for the ${coupon.minPlan} plan.`,
      });
    }

    const label =
      coupon.discountType === 'percent'
        ? `${coupon.discount}% off`
        : `₹${coupon.discount} off`;

    res.json({
      success: true,
      code: coupon.code,
      discount: coupon.discount,
      discountType: coupon.discountType,
      label,
    });
  } catch (err) {
    console.error('[coupon] validate error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ─── Admin: GET /api/coupon/admin/list ────────────────────────────────────────
router.get('/admin/list', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const coupons = await db.collection('coupons').find({}).sort({ createdAt: -1 }).toArray();
    res.json({ success: true, coupons });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ─── Admin: POST /api/coupon/admin/create ─────────────────────────────────────
router.post('/admin/create', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { code, discount, discountType, maxUses, expiresAt, minPlan } = req.body;

    if (!code || discount === undefined || !discountType) {
      return res.status(400).json({
        success: false,
        message: 'code, discount and discountType are required.',
      });
    }

    if (!['percent', 'flat'].includes(discountType)) {
      return res.status(400).json({ success: false, message: 'discountType must be "percent" or "flat".' });
    }

    const discountNum = Number(discount);
    if (isNaN(discountNum) || discountNum <= 0) {
      return res.status(400).json({ success: false, message: 'discount must be a positive number.' });
    }
    if (discountType === 'percent' && discountNum > 100) {
      return res.status(400).json({ success: false, message: 'Percent discount cannot exceed 100.' });
    }

    const db = getDb();
    const upperCode = code.toUpperCase().trim();
    const existing = await db.collection('coupons').findOne({ code: upperCode });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Coupon code already exists.' });
    }

    const coupon = {
      code: upperCode,
      discount: discountNum,
      discountType,
      maxUses: maxUses ? Number(maxUses) : null,
      usedCount: 0,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      minPlan: minPlan || null,
      active: true,
      createdAt: new Date(),
    };

    const result = await db.collection('coupons').insertOne(coupon);
    res.status(201).json({ success: true, coupon: { ...coupon, _id: result.insertedId } });
  } catch (err) {
    console.error('[coupon] create error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ─── Admin: PUT /api/coupon/admin/:id ─────────────────────────────────────────
router.put('/admin/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { discount, discountType, maxUses, expiresAt, active, minPlan } = req.body;
    const db = getDb();
    const update = {};

    if (discount !== undefined) update.discount = Number(discount);
    if (discountType !== undefined) update.discountType = discountType;
    if (maxUses !== undefined) update.maxUses = maxUses ? Number(maxUses) : null;
    if (expiresAt !== undefined) update.expiresAt = expiresAt ? new Date(expiresAt) : null;
    if (active !== undefined) update.active = Boolean(active);
    if (minPlan !== undefined) update.minPlan = minPlan || null;

    await db.collection('coupons').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: update }
    );

    res.json({ success: true, message: 'Coupon updated.' });
  } catch (err) {
    console.error('[coupon] update error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ─── Admin: DELETE /api/coupon/admin/:id ──────────────────────────────────────
router.delete('/admin/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const db = getDb();
    await db.collection('coupons').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ success: true, message: 'Coupon deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

export default router;
