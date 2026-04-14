import { Router } from 'express';
import { getDb } from '../database/mongo.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

/**
 * POST /api/mock-test/save-result
 * Body: { examType, paperName, totalQuestions, correct, wrong, skipped, timeTakenSecs, score }
 */
router.post('/save-result', authMiddleware, async (req, res) => {
  try {
    const {
      examType,
      paperName,
      totalQuestions,
      correct,
      wrong,
      skipped,
      timeTakenSecs,
      score,
    } = req.body;

    if (!examType || !paperName) {
      return res.status(400).json({ success: false, message: 'examType and paperName are required' });
    }

    const db = getDb();
    const record = {
      userId:         String(req.userId),
      examType:       String(examType),
      paperName:      String(paperName),
      totalQuestions: Number(totalQuestions) || 0,
      correct:        Number(correct)        || 0,
      wrong:          Number(wrong)          || 0,
      skipped:        Number(skipped)        || 0,
      timeTakenSecs:  Number(timeTakenSecs)  || 0,
      score:          Number(score)          || 0, // percentage 0–100
      createdAt:      new Date(),
    };

    await db.collection('scores').insertOne(record);
    res.json({ success: true });
  } catch (err) {
    console.error('[mock-test] save-result error:', err);
    res.status(500).json({ success: false, message: 'Failed to save result' });
  }
});

/**
 * GET /api/mock-test/analytics
 * Returns last 50 attempts + aggregated stats per exam for the logged-in user.
 */
router.get('/analytics', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const scores = await db.collection('scores')
      .find({ userId: String(req.userId) })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    // Aggregate per-exam stats
    const byExam = {};
    for (const s of scores) {
      if (!byExam[s.examType]) {
        byExam[s.examType] = { attempts: 0, bestScore: 0, totalScore: 0, avgScore: 0 };
      }
      byExam[s.examType].attempts++;
      byExam[s.examType].totalScore += s.score;
      if (s.score > byExam[s.examType].bestScore) {
        byExam[s.examType].bestScore = s.score;
      }
    }
    for (const key of Object.keys(byExam)) {
      byExam[key].avgScore = Math.round(byExam[key].totalScore / byExam[key].attempts);
    }

    res.json({ success: true, scores, byExam });
  } catch (err) {
    console.error('[mock-test] analytics error:', err);
    res.status(500).json({ success: false, message: 'Failed to load analytics' });
  }
});

export default router;
