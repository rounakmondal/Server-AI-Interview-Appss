/**
 * Personalized Dashboard Routes
 * ─────────────────────────────
 * GET  /api/personal-dashboard/analysis      – weak-area analysis per user
 * POST /api/personal-dashboard/weak-area-test – AI-generated targeted test
 * POST /api/personal-dashboard/send-test-email – email personalized test
 * GET  /api/personal-dashboard/daily-target  – get today's target
 * POST /api/personal-dashboard/daily-target  – upsert today's target
 * POST /api/personal-dashboard/daily-target/increment – increment today's count
 */

import { Router }   from 'express';
import { ObjectId } from 'mongodb';
import nodemailer   from 'nodemailer';
import { getDb }    from '../database/mongo.js';
import { authMiddleware } from '../middleware/auth.js';
import { callLLMWithFallback } from '../utils/llmFallback.js';

const router = Router();

const VALID_SUBJECTS = ['History', 'Geography', 'Polity', 'Reasoning', 'Math', 'Current Affairs'];
const SUBJECT_BN = {
  History:         'ইতিহাস',
  Geography:       'ভূগোল',
  Polity:          'রাজনীতি',
  Reasoning:       'যুক্তিবিদ্যা',
  Math:            'গণিত',
  'Current Affairs': 'সাম্প্রতিক',
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function classify(accuracy) {
  if (accuracy < 60) return 'Weak';
  if (accuracy <= 80) return 'Average';
  return 'Strong';
}

function levelColor(level) {
  return level === 'Weak' ? '🔴' : level === 'Average' ? '🟡' : '🟢';
}

function createMailTransporter() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST || 'smtp.gmail.com',
    port:   Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    tls:    { rejectUnauthorized: false },
  });
}

/** Build "today" date range (UTC midnight → next midnight) */
function todayRange() {
  const start = new Date(); start.setUTCHours(0, 0, 0, 0);
  const end   = new Date(start.getTime() + 86_400_000);
  return { start, end };
}

// ─── GET /analysis ─────────────────────────────────────────────────────────

router.get('/analysis', authMiddleware, async (req, res) => {
  try {
    const db     = getDb();
    const userId = new ObjectId(req.userId);

    // Aggregate scores per subject (last 90 days)
    const since = new Date(Date.now() - 90 * 86_400_000);
    const pipeline = [
      { $match: { userId, createdAt: { $gte: since } } },
      {
        $group: {
          _id:            { subject: '$subject' },
          totalQuestions: { $sum: '$totalQuestions' },
          correct:        { $sum: '$correct' },
          attempts:       { $sum: 1 },
          lastAttempt:    { $max: '$createdAt' },
        },
      },
    ];
    const subjectStats = await db.collection('scores').aggregate(pipeline).toArray();

    // Build performance array
    const performance = VALID_SUBJECTS.map(sub => {
      const stat = subjectStats.find(s => s._id.subject === sub);
      const total   = stat?.totalQuestions ?? 0;
      const correct = stat?.correct ?? 0;
      const accuracy = total > 0 ? Math.round((correct / total) * 100) : null;
      return {
        topic:          sub,
        subTopic:       sub,
        totalQuestions: total,
        correctAnswers: correct,
        attempts:       stat?.attempts ?? 0,
        accuracy,          // null = no data
        level:          accuracy !== null ? classify(accuracy) : 'No Data',
        lastAttempt:    stat?.lastAttempt ?? null,
      };
    });

    // Today's progress
    const { start, end } = todayRange();
    const todayDoc = await db.collection('daily_targets').findOne({
      userId,
      date: { $gte: start, $lt: end },
    });
    const todayProgress = {
      attempted: todayDoc?.attempted ?? 0,
      target:    todayDoc?.target    ?? 10,
    };

    // Build AI prompt input
    const aiPerf = performance
      .filter(p => p.accuracy !== null)
      .map(p => ({
        topic:          p.topic,
        subTopic:       p.subTopic,
        totalQuestions: p.totalQuestions,
        correctAnswers: p.correctAnswers,
        avgTime:        50, // stored aggregation — placeholder
      }));

    let aiAnalysis = null;

    if (aiPerf.length > 0) {
      const systemPrompt = `You are an AI tutor for government exam preparation.
Analyze the user's performance data and generate a personalized dashboard response.

Rules:
1. Calculate accuracy = (correctAnswers / totalQuestions) * 100
2. Classify: <60% = Weak | 60-80% = Average | >80% = Strong
3. Identify weakest subTopic with lowest accuracy
4. Suggest next action: Weak→Practice Easy test | Average→Practice Medium test | Strong→Full Mock Test
5. Daily progress: if attempted < target show remaining, else mark Completed.

Respond ONLY with valid JSON, no markdown fences, no explanation.`;

      const userPrompt = `Input:
${JSON.stringify({ userId: req.userId, performance: aiPerf, todayProgress }, null, 2)}

Output JSON:
{
  "weakAreas": [{"subTopic":"","accuracy":0,"level":"Weak/Average/Strong"}],
  "recommendedAction": "",
  "dailyTarget": {"total":10,"completed":0,"remaining":0,"status":"Pending/Completed"},
  "message": ""
}`;

      try {
        const resp = await callLLMWithFallback(
          process.env.GROQ_API_KEY,
          [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userPrompt },
          ],
          { model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant', temperature: 0.3, max_tokens: 1000, stream: false },
          null,
          'personal-dashboard',
        );

        const data    = await resp.json();
        const raw     = data?.choices?.[0]?.message?.content
                     ?? data?.candidates?.[0]?.content?.parts?.[0]?.text
                     ?? '';

        // Strip any accidental markdown fences
        const jsonStr = raw.replace(/```json?/gi, '').replace(/```/g, '').trim();
        aiAnalysis = JSON.parse(jsonStr);
      } catch (aiErr) {
        console.warn('[personal-dashboard] AI analysis failed:', aiErr.message);
        // Fall through — we still return raw performance data
      }
    }

    // Always return formatted performance + AI overlay
    return res.json({
      success:       true,
      performance,
      todayProgress,
      aiAnalysis,   // may be null if AI failed or no data
    });
  } catch (err) {
    console.error('[personal-dashboard] analysis error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load analysis' });
  }
});

// ─── POST /weak-area-test ──────────────────────────────────────────────────

router.post('/weak-area-test', authMiddleware, async (req, res) => {
  try {
    const { subject, difficulty = 'Easy', count = 10, exam = 'WBCS', language = 'en' } = req.body;

    if (!subject || !VALID_SUBJECTS.includes(subject))
      return res.status(400).json({ success: false, message: 'Valid subject is required' });

    const isBengali = language === 'bn';
    const langInstruction = isBengali
      ? `Write ALL questions, options, and explanations in Bengali (বাংলা). Do not use English except for proper nouns.`
      : `Write ALL questions, options, and explanations in English.`;

    const systemPrompt = `You are an expert Indian competitive exam question maker.
Generate exactly ${count} MCQ questions on "${subject}" (${SUBJECT_BN[subject]}) for ${exam} exam at ${difficulty} difficulty.
${langInstruction}
Each question must have exactly 4 options and one correct answer specified as correctIndex (0-3).
Return ONLY a valid JSON array, no markdown fences, no extra text.`;

    const userPrompt = `Generate ${count} MCQ questions on ${subject} (${SUBJECT_BN[subject]}) for ${exam} exam, ${difficulty} difficulty.
Language: ${isBengali ? 'Bengali (বাংলা)' : 'English'}

Return JSON array only:
[{
  "question": "${isBengali ? 'প্রশ্নটি বাংলায়...' : 'Question text...'}",
  "options": ["${isBengali ? 'বিকল্প ক' : 'Option A'}...", "${isBengali ? 'বিকল্প খ' : 'Option B'}...", "${isBengali ? 'বিকল্প গ' : 'Option C'}...", "${isBengali ? 'বিকল্প ঘ' : 'Option D'}..."],
  "correctIndex": 0,
  "explanation": "${isBengali ? 'ব্যাখ্যা...' : 'Explanation...'}",
  "subject": "${subject}",
  "exam": "${exam}",
  "difficulty": "${difficulty}"
}]`;

    const resp = await callLLMWithFallback(
      process.env.GROQ_API_KEY,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      { model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant', temperature: 0.7, max_tokens: 4000, stream: false },
      null,
      'weak-area-test',
    );

    const data    = await resp.json();
    const raw     = data?.choices?.[0]?.message?.content
                 ?? data?.candidates?.[0]?.content?.parts?.[0]?.text
                 ?? '[]';
    const jsonStr = raw.replace(/```json?/gi, '').replace(/```/g, '').trim();

    let questions;
    try {
      questions = JSON.parse(jsonStr);
    } catch {
      return res.status(500).json({ success: false, message: 'AI returned malformed JSON' });
    }

    // Normalise questions: strip A)/B)/C)/D) prefix from options
    const stripPrefix = s => String(s ?? '').replace(/^[A-Da-d][.):\s-]+\s*/, '').trim();
    const normalized = (Array.isArray(questions) ? questions : []).map((q, idx) => ({
      id:           Date.now() + idx,
      question:     String(q.question ?? ''),
      options:      (Array.isArray(q.options) ? q.options : ['', '', '', '']).map(stripPrefix),
      correctIndex: Number(q.correctIndex ?? 0),
      explanation:  String(q.explanation ?? ''),
      subject:      String(q.subject ?? subject),
      exam:         String(q.exam ?? exam),
      difficulty:   String(q.difficulty ?? difficulty),
      language,
    }));

    return res.json({ success: true, questions: normalized, subject, difficulty, language, count: normalized.length });
  } catch (err) {
    console.error('[personal-dashboard] weak-area-test error:', err);
    return res.status(500).json({ success: false, message: 'Failed to generate test' });
  }
});

// ─── POST /send-test-email ─────────────────────────────────────────────────

router.post('/send-test-email', authMiddleware, async (req, res) => {
  try {
    const db   = getDb();
    const user = await db.collection('users').findOne({ _id: new ObjectId(req.userId) });
    if (!user?.email)
      return res.status(400).json({ success: false, message: 'User email not found' });

    const { weakAreas = [], recommendedAction = '', message = '' } = req.body;

    // Build HTML table of weak areas
    const rows = weakAreas.map(w =>
      `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${w.subTopic}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${w.accuracy ?? 'N/A'}%</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:${w.level==='Weak'?'#ef4444':w.level==='Average'?'#f59e0b':'#10b981'}">${levelColor(w.level)} ${w.level}</td>
      </tr>`
    ).join('');

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:'Segoe UI',Arial,sans-serif">
<div style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.08)">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px 24px;text-align:center">
    <img src="https://medhahub.in/wbcs.avif" alt="MedhaHub" style="height:36px;margin-bottom:12px;border-radius:8px" onerror="this.style.display='none'">
    <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700">📊 Your Personalized Study Report</h1>
    <p style="color:rgba(255,255,255,.85);margin:8px 0 0;font-size:14px">Based on your recent test performance</p>
  </div>

  <!-- Greeting -->
  <div style="padding:24px 24px 0">
    <p style="color:#374151;font-size:15px;margin:0">Hi <strong>${user.name}</strong>,</p>
    <p style="color:#6b7280;font-size:14px;margin:8px 0 0">${message || 'Here is a breakdown of your performance. Keep practising to improve your weak areas!'}</p>
  </div>

  <!-- Weak Areas Table -->
  ${rows ? `
  <div style="padding:20px 24px">
    <h2 style="font-size:15px;font-weight:600;color:#111827;margin:0 0 12px">📌 Subject Performance</h2>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#f3f4f6">
          <th style="padding:8px 12px;text-align:left;color:#6b7280;font-weight:600">Subject</th>
          <th style="padding:8px 12px;text-align:left;color:#6b7280;font-weight:600">Accuracy</th>
          <th style="padding:8px 12px;text-align:left;color:#6b7280;font-weight:600">Level</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>` : ''}

  <!-- Recommended Action -->
  ${recommendedAction ? `
  <div style="padding:0 24px 20px">
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:16px">
      <p style="margin:0;font-size:13px;color:#1e40af"><strong>🎯 Recommended Next Step:</strong><br>${recommendedAction}</p>
    </div>
  </div>` : ''}

  <!-- CTA Button -->
  <div style="padding:0 24px 32px;text-align:center">
    <a href="https://medhahub.in/personal-dashboard" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;text-decoration:none;padding:12px 32px;border-radius:999px;font-size:14px;font-weight:600">
      📚 Start Weak Area Practice
    </a>
  </div>

  <!-- Footer -->
  <div style="background:#f9fafb;padding:16px 24px;text-align:center;border-top:1px solid #e5e7eb">
    <p style="margin:0;font-size:12px;color:#9ca3af">MedhaHub · <a href="https://medhahub.in" style="color:#6b7280">medhahub.in</a></p>
    <p style="margin:4px 0 0;font-size:11px;color:#d1d5db">You're receiving this because you opted in to personalized reports.</p>
  </div>
</div>
</body></html>`;

    const transporter = createMailTransporter();
    await transporter.sendMail({
      from:    `"MedhaHub" <${process.env.SMTP_USER}>`,
      to:      user.email,
      subject: `📊 Your Weak Area Report — ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`,
      html,
    });

    return res.json({ success: true, message: 'Report sent to ' + user.email });
  } catch (err) {
    console.error('[personal-dashboard] send-test-email error:', err);
    return res.status(500).json({ success: false, message: 'Failed to send email' });
  }
});

// ─── GET /daily-target ─────────────────────────────────────────────────────

router.get('/daily-target', authMiddleware, async (req, res) => {
  try {
    const db     = getDb();
    const userId = new ObjectId(req.userId);
    const { start, end } = todayRange();
    const doc = await db.collection('daily_targets').findOne({
      userId,
      date: { $gte: start, $lt: end },
    });
    return res.json({
      success:   true,
      attempted: doc?.attempted ?? 0,
      target:    doc?.target    ?? 10,
    });
  } catch (err) {
    console.error('[personal-dashboard] daily-target GET error:', err);
    return res.status(500).json({ success: false, message: 'Failed to get daily target' });
  }
});

// ─── POST /daily-target ────────────────────────────────────────────────────

router.post('/daily-target', authMiddleware, async (req, res) => {
  try {
    const db     = getDb();
    const userId = new ObjectId(req.userId);
    const target = Math.max(1, Math.min(200, Number(req.body.target) || 10));
    const { start, end } = todayRange();

    await db.collection('daily_targets').updateOne(
      { userId, date: { $gte: start, $lt: end } },
      {
        $set:         { target },
        $setOnInsert: { userId, date: new Date(), attempted: 0 },
      },
      { upsert: true },
    );

    return res.json({ success: true, target });
  } catch (err) {
    console.error('[personal-dashboard] daily-target POST error:', err);
    return res.status(500).json({ success: false, message: 'Failed to save target' });
  }
});

// ─── POST /daily-target/increment ──────────────────────────────────────────

router.post('/daily-target/increment', authMiddleware, async (req, res) => {
  try {
    const db     = getDb();
    const userId = new ObjectId(req.userId);
    const by     = Math.max(1, Math.min(50, Number(req.body.by) || 1));
    const { start, end } = todayRange();

    const result = await db.collection('daily_targets').findOneAndUpdate(
      { userId, date: { $gte: start, $lt: end } },
      {
        $inc:         { attempted: by },
        $setOnInsert: { userId, date: new Date(), target: 10 },
      },
      { upsert: true, returnDocument: 'after' },
    );

    const doc = result?.value ?? result;
    return res.json({
      success:   true,
      attempted: doc?.attempted ?? by,
      target:    doc?.target    ?? 10,
    });
  } catch (err) {
    console.error('[personal-dashboard] daily-target increment error:', err);
    return res.status(500).json({ success: false, message: 'Failed to increment' });
  }
});

// ─── POST /post-test-analytics ─────────────────────────────────────────────
// No auth required — works for guests and logged-in users alike.
router.post('/post-test-analytics', async (req, res) => {
  try {
    const {
      questions = [],
      answers   = [],
      exam      = 'WBCS',
      subject,
      difficulty = 'Medium',
      language   = 'en',
      timeTakenSeconds = 0,
      studentName = '',
    } = req.body;

    // ── compute per-subject stats ──────────────────────────────────
    const subjPerf = {};
    questions.forEach(q => {
      const ans    = answers.find(a => a.questionId === q.id);
      const uIdx   = (ans && typeof ans.selectedIndex === 'number') ? ans.selectedIndex : null;
      const sub    = q.subject || 'General';
      if (!subjPerf[sub]) subjPerf[sub] = { correct: 0, wrong: 0, unanswered: 0, total: 0 };
      subjPerf[sub].total++;
      if (uIdx === null)              subjPerf[sub].unanswered++;
      else if (uIdx === q.correctIndex) subjPerf[sub].correct++;
      else                              subjPerf[sub].wrong++;
    });

    const subjectSummary = Object.entries(subjPerf).map(([sub, s]) => ({
      subject:  sub,
      correct:  s.correct,
      total:    s.total,
      accuracy: s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0,
    }));

    const weakSubjects = subjectSummary
      .filter(s => s.accuracy < 70)
      .sort((a, b) => a.accuracy - b.accuracy);

    const totalQs   = questions.length;
    const totalCorr = subjectSummary.reduce((n, x) => n + x.correct, 0);
    const overall   = totalQs > 0 ? Math.round((totalCorr / totalQs) * 100) : 0;
    const avgTime   = totalQs > 0 ? Math.round(timeTakenSeconds / totalQs) : 0;
    const name      = studentName || 'there';

    // ── AI prompt — PERSONAL MENTOR VOICE ─────────────────────────
    const isBn = language === 'bn';
    const isHi = language === 'hi';

    const systemPrompt = isBn
      ? `তুমি MedhaHub-এর ব্যক্তিগত শিক্ষক "মেধা দিদি"। ছাত্রকে নাম ধরে ডাকো। তুমি তার কাছের মানুষের মতো কথা বলো — উষ্ণ, সৎ, এবং সবসময় তাকে এগিয়ে নিতে চাও। ভুলগুলো নিয়ে বকবে না, বরং কোন chapter-এ দুর্বল এবং কীভাবে ঠিক করবে তা বলবে। শুধু valid JSON দেবে, কোনো markdown নয়।`
      : isHi
      ? `तुम MedhaHub की पर्सनल टीचर "मेधा दीदी" हो। छात्र को नाम से बुलाओ। तुम उसकी सबसे करीबी टीचर की तरह बात करो — गर्मजोशी, ईमानदारी, और हमेशा आगे बढ़ाने की चाह। गलतियों पर डांटो मत, बल्कि कौन सा chapter कमज़ोर है और कैसे सुधारना है बताओ। सिर्फ valid JSON दो, markdown नहीं।`
      : `You are "Medha", the student's personal AI mentor on MedhaHub. Address them by name ("Hey ${name}"). You speak like a caring older sister/teacher — warm, honest, and always pushing them forward. NEVER be clinical or cold. When they fail, comfort them and show the exact path to recover. When they do well, celebrate genuinely. Focus on WHICH specific chapters/topics need work and give a concrete 3-day mini-plan to fix weak areas. Respond ONLY with valid JSON, no markdown fences.`;

    const userPrompt = [
      `Student name: ${name}`,
      `Exam: ${exam} | Topic: ${subject || 'Mixed'} | Difficulty: ${difficulty}`,
      `Score: ${totalCorr}/${totalQs} (${overall}%) | Avg time/question: ${avgTime}s`,
      `Subject breakdown: ${JSON.stringify(subjectSummary)}`,
      weakSubjects.length
        ? `Struggling in: ${weakSubjects.map(s => `${s.subject}(${s.accuracy}%)`).join(', ')}`
        : 'All subjects above 70%! 🎉',
      overall >= 80 ? `This is a GREAT score — celebrate this win!` : '',
      overall < 40 ? `This is a tough result — be extra gentle and encouraging.` : '',
      isBn
        ? `বাংলায় JSON:\n{"insight":"${name}-কে নাম ধরে ডাকো। ২-৩ বাক্যে ব্যক্তিগত বিশ্লেষণ — কোন chapter দুর্বল ও কেন","recommendations":["নির্দিষ্ট chapter-ভিত্তিক পরামর্শ ১","পরামর্শ ২","৩ দিনের mini-plan"],"message":"আবেগপূর্ণ উৎসাহ — ব্যক্তিগত ও উষ্ণ (১-২ বাক্য)","recoveryPlan":"দুর্বল বিষয়গুলোর জন্য ৩ দিনের নির্দিষ্ট plan"}`
        : isHi
        ? `हिंदी में JSON:\n{"insight":"${name} को नाम से बुलाओ। 2-3 वाक्यों में व्यक्तिगत विश्लेषण — कौन सा chapter कमज़ोर और क्यों","recommendations":["chapter-विशिष्ट सुझाव 1","सुझाव 2","3 दिन का mini-plan"],"message":"भावनात्मक प्रोत्साहन — व्यक्तिगत और गर्मजोशी (1-2 वाक्य)","recoveryPlan":"कमज़ोर विषयों के लिए 3 दिन का plan"}`
        : `JSON:\n{"insight":"Address ${name} by name. 2-3 sentence personal analysis — which specific chapters are weak and why","recommendations":["chapter-specific tip 1","tip 2","3-day mini recovery plan"],"message":"emotional encouragement — personal and warm, like a friend who believes in them (1-2 sentences)","recoveryPlan":"concrete 3-day plan to fix the weakest subject: Day 1 do X, Day 2 do Y, Day 3 test again"}`,
    ].filter(Boolean).join('\n');

    let analytics = null;
    try {
      const resp = await callLLMWithFallback(
        process.env.GROQ_API_KEY,
        [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt },
        ],
        { model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant', temperature: 0.6, max_tokens: 900, stream: false },
        null,
        'post-test-analytics',
      );
      const data    = await resp.json();
      const raw     = data?.choices?.[0]?.message?.content
                   ?? data?.candidates?.[0]?.content?.parts?.[0]?.text
                   ?? '';
      const jsonStr = raw.replace(/```json?/gi, '').replace(/```/g, '').trim();
      analytics     = JSON.parse(jsonStr);
    } catch {
      // Graceful warm fallback without AI
      const nameGreet = name !== 'there' ? name : 'buddy';
      analytics = overall >= 60
        ? {
            insight: isBn
              ? `দারুণ কাজ, ${nameGreet}! তুমি ${totalQs}টির মধ্যে ${totalCorr}টি সঠিক করেছ (${overall}%)। তোমার পরিশ্রম ফল দিচ্ছে! ${weakSubjects.length ? `শুধু ${weakSubjects[0]?.subject}-এ একটু বেশি focus দাও।` : ''}`
              : isHi
              ? `शानदार, ${nameGreet}! ${totalQs} में से ${totalCorr} सही (${overall}%)। तुम्हारी मेहनत रंग ला रही है! ${weakSubjects.length ? `बस ${weakSubjects[0]?.subject} पर थोड़ा और ध्यान दो।` : ''}`
              : `Great job, ${nameGreet}! You got ${totalCorr}/${totalQs} right (${overall}%). Your hard work is showing! ${weakSubjects.length ? `Just give a bit more attention to ${weakSubjects[0]?.subject}.` : 'Keep this momentum going!'}`,
            recommendations: weakSubjects.slice(0, 3).map(s =>
              isBn ? `${s.subject}-এর chapter গুলো আরেকবার পড়ো ও ১০টি practice question সমাধান করো।`
              : isHi ? `${s.subject} के chapter दोबारा पढ़ो और 10 practice questions हल करो।`
              : `Revise ${s.subject} chapters and solve 10 targeted practice questions today.`
            ),
            message: isBn ? `তুমি পারবে, ${nameGreet} — এটা আমি জানি! 💪`
              : isHi ? `तुम कर सकते हो, ${nameGreet} — मुझे पूरा भरोसा है! 💪`
              : `You've got this, ${nameGreet} — I believe in you! 💪`,
            recoveryPlan: null,
          }
        : {
            insight: isBn
              ? `${nameGreet}, এই result দেখে হতাশ হয়ো না। তুমি ${totalCorr}/${totalQs} পেয়েছ (${overall}%) — কিন্তু এটা শেখার একটা ধাপ। ${weakSubjects.length ? `${weakSubjects.map(s => s.subject).join(', ')}-এ তোমাকে focus করতে হবে।` : ''}`
              : isHi
              ? `${nameGreet}, इस result से निराश मत हो। ${totalCorr}/${totalQs} (${overall}%) — लेकिन ये सीखने का हिस्सा है। ${weakSubjects.length ? `${weakSubjects.map(s => s.subject).join(', ')} पर focus करो।` : ''}`
              : `Hey ${nameGreet}, don't be discouraged by this result. ${totalCorr}/${totalQs} (${overall}%) is just a stepping stone. ${weakSubjects.length ? `Let's focus on fixing ${weakSubjects.map(s => s.subject).join(' and ')} — that's where the easy marks are hiding.` : ''}`,
            recommendations: weakSubjects.slice(0, 3).map(s =>
              isBn ? `আজই ${s.subject}-এর basic concepts আবার পড়ো। ছোট ছোট notes বানাও।`
              : isHi ? `आज ही ${s.subject} के basic concepts दोबारा पढ़ो। छोटे notes बनाओ।`
              : `Today: re-read the basics of ${s.subject}. Make small handwritten notes on key concepts.`
            ),
            message: isBn ? `মনে রেখো ${nameGreet}, একটা কঠিন দিন মানে শেষ না — এটা শুরু। কাল আবার চেষ্টা করো! 🌟`
              : isHi ? `याद रखो ${nameGreet}, एक कठिन दिन अंत नहीं — ये शुरुआत है। कल फिर कोशिश करो! 🌟`
              : `Remember ${nameGreet}, a tough day isn't the end — it's the beginning. Come back tomorrow stronger! 🌟`,
            recoveryPlan: null,
          };
    }

    return res.json({ success: true, analytics, weakSubjects });
  } catch (err) {
    console.error('[post-test-analytics] error:', err);
    return res.status(500).json({ success: false, message: 'Analytics failed' });
  }
});

export default router;
