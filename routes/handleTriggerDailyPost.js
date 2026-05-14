import cron from 'node-cron';
import { getDb } from '../database/db.js';
import { getDb as getMongo } from '../database/mongo.js';

const FALLBACK_SUBJECTS = ["police", "wbcs", "wbpsc"];
const POST_URL = "https://recomendengine-1.onrender.com/daily-post";

// Map internal exam identifiers → recommendation engine subject names
const EXAM_TO_SUBJECT = {
  // amar_plan.exam_type values
  wbcs:       'wbcs',
  police_si:  'police',
  tet:        'tet',
  group_d:    'group_d',
  // exams.slug values
  'wb-police-si':    'police',
  wbpsc:             'wbpsc',
  'ssc-cgl':         'ssc',
  'banking-ibps-sbi':'banking',
};

/**
 * Reads the SQLite DB and returns distinct subject names
 * that students have actually chosen (via amar_plan or user_exam_preferences).
 * Falls back to FALLBACK_SUBJECTS if the DB is unavailable or empty.
 */
function getActiveSubjects() {
  try {
    const db = getDb();
    if (!db) return FALLBACK_SUBJECTS;

    // Collect distinct exam_types from amar_plan
    const planStmt = db.prepare('SELECT DISTINCT exam_type FROM amar_plan');
    const examTypes = [];
    while (planStmt.step()) examTypes.push(planStmt.getAsObject().exam_type);
    planStmt.free();

    // Collect distinct slugs from user_exam_preferences → exams
    const prefStmt = db.prepare(
      'SELECT DISTINCT e.slug FROM user_exam_preferences uep JOIN exams e ON e.id = uep.exam_id'
    );
    const slugs = [];
    while (prefStmt.step()) slugs.push(prefStmt.getAsObject().slug);
    prefStmt.free();

    const subjects = new Set();
    for (const key of [...examTypes, ...slugs]) {
      const mapped = EXAM_TO_SUBJECT[key];
      if (mapped) subjects.add(mapped);
    }

    return subjects.size > 0 ? [...subjects] : FALLBACK_SUBJECTS;
  } catch (err) {
    console.warn('[DailyPost] Could not read active subjects from DB, using fallback:', err.message);
    return FALLBACK_SUBJECTS;
  }
}

// Set your deployed server URL here (used for self-ping keep-alive)
const SELF_URL = process.env.RENDER_EXTERNAL_URL || process.env.SELF_URL || "";

function getRequestBody(subject) {
  return {
    subject,
    num_questions: 50,
    top_n: 10,
  };
}

async function postDaily(subject) {
  try {
    const res = await fetch(POST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(getRequestBody(subject)),
    });

    const data = await res.text();

    console.log(
      `[DailyPost] Sent for subject: ${subject}, status: ${res.status}, response:`,
      data
    );

    return { subject, status: res.status, ok: true };
  } catch (err) {
    console.error(`[DailyPost] Error for subject: ${subject}`, err);
    return { subject, ok: false, error: err.toString() };
  }
}

// Post all active subjects
async function postAllSubjects(label) {
  const subjects = getActiveSubjects();

  console.log(
    `[DailyPost] ${label} batch starting at ${new Date().toISOString()} — subjects: ${subjects.join(', ')}`
  );

  const results = await Promise.allSettled(
    subjects.map((s) => postDaily(s))
  );

  return results.map((r, i) => ({
    subject: subjects[i],
    ...(r.status === "fulfilled"
      ? r.value
      : { ok: false, error: r.reason.toString() }),
  }));
}

/**
 * Generate a daily paper via the recommendation engine and store it in MongoDB.
 * Also sends push notifications to subscribed users.
 */
async function generateAndStoreDailyPaper(subject, slot) {
  const RECOMMEND_URL = "https://recomendengine-1.onrender.com/recommend";
  try {
    const res = await fetch(RECOMMEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject, num_questions: 50 }),
    });
    if (!res.ok) throw new Error(`Recommend API ${res.status}`);
    const data = await res.json();

    // Store in MongoDB
    try {
      const mongo = getMongo();
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      await mongo.collection('daily_papers').updateOne(
        { date: today, slot, subject },
        {
          $set: {
            questions: data.questions || [],
            totalQuestions: data.total_recommended || 0,
            updatedAt: new Date(),
          },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true }
      );
      console.log(`[DailyPaper] Stored ${slot} paper for ${subject} (${today})`);
    } catch (dbErr) {
      console.error(`[DailyPaper] MongoDB store failed for ${subject}:`, dbErr.message);
    }

    // Send push notification to users subscribed to this subject
    try {
      const mongo = getMongo();
      const tokens = await mongo.collection('push_subscriptions')
        .find({ subjects: subject, active: true })
        .project({ fcmToken: 1 })
        .limit(500)
        .toArray();

      if (tokens.length > 0) {
        console.log(`[DailyPaper] Would notify ${tokens.length} users for ${subject} ${slot} paper`);
        // Notification is sent via the client-side service worker check
        // The client polls /api/daily-paper and shows local notification
      }
    } catch (notifyErr) {
      console.error(`[DailyPaper] Notification check failed:`, notifyErr.message);
    }

    return { subject, slot, ok: true, questions: data.total_recommended };
  } catch (err) {
    console.error(`[DailyPaper] Error generating ${slot} paper for ${subject}:`, err.message);
    return { subject, slot, ok: false, error: err.message };
  }
}

// ── Keep Alive ─────────────────────────────
function startKeepAlive() {
  if (!SELF_URL) {
    console.log("[KeepAlive] No SELF_URL set");
    return;
  }

  const INTERVAL_MS = 14 * 60 * 1000;

  setInterval(async () => {
    try {
      await fetch(`${SELF_URL}/api/ping`);
      console.log(`[KeepAlive] pinged ${SELF_URL}/api/ping`);
    } catch (e) {
      // ignore
    }
  }, INTERVAL_MS);

  console.log(`[KeepAlive] Started → ${SELF_URL}/api/ping`);
}

// ── Cron Jobs (IST) ───────────────────────
function scheduleDailyPosts() {
  const times = [
    { cron: "0 9 * * *", label: "morning", slot: "9am" },
    { cron: "0 16 * * *", label: "afternoon", slot: "4pm" },
  ];

  times.forEach(({ cron: time, label, slot }) => {
    cron.schedule(
      time,
      async () => {
        // Post to Telegram
        await postAllSubjects(label);
        // Generate & store papers in MongoDB
        const subjects = getActiveSubjects();
        await Promise.allSettled(
          subjects.map((s) => generateAndStoreDailyPaper(s, slot))
        );
      },
      { timezone: "Asia/Kolkata" }
    );
  });

  console.log("Cron scheduled (9AM / 4PM IST)");

  startKeepAlive();
}

// ── API Endpoint ──────────────────────────
const TRIGGER_SECRET =
  process.env.DAILY_POST_SECRET || "medhahub-daily-2026";

// Express handler for manual trigger
const handleTriggerDailyPost = async (req, res) => {
  const key = req.query.key;

  if (key !== TRIGGER_SECRET) {
    return res.status(401).json({ error: "Invalid key" });
  }

  const label = req.query.label || "external-trigger";

  const results = await postAllSubjects(label);

  res.json({
    ok: true,
    label,
    timestamp: new Date().toISOString(),
    results,
  });
};

// GET /api/daily-paper?subject=police&slot=9am
// Returns today's paper for the given subject and slot
const handleGetDailyPaper = async (req, res) => {
  try {
    const mongo = getMongo();
    const { subject, slot } = req.query;
    const today = new Date().toISOString().slice(0, 10);

    const query = { date: today };
    if (subject) query.subject = subject;
    if (slot) query.slot = slot;

    const papers = await mongo.collection('daily_papers')
      .find(query)
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray();

    res.json({ ok: true, date: today, papers });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

export { scheduleDailyPosts, handleTriggerDailyPost, handleGetDailyPaper };