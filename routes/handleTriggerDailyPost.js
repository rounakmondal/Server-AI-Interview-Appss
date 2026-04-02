import fetch from 'node-fetch';
import cron from 'node-cron';
import { getDb } from '../database/db.js';

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
    { cron: "0 7 * * *", label: "morning" },
    { cron: "0 12 * * *", label: "noon" },
    { cron: "0 18 * * *", label: "evening" },
  ];

  times.forEach(({ cron: time, label }) => {
    cron.schedule(
      time,
      () => postAllSubjects(label),
      { timezone: "Asia/Kolkata" }
    );
  });

  console.log("Cron scheduled (7AM / 12PM / 6PM IST)");

  startKeepAlive();
}

// ── API Endpoint ──────────────────────────
const TRIGGER_SECRET =
  process.env.DAILY_POST_SECRET || "medhahub-daily-2026";

// Express handler
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

export { scheduleDailyPosts, handleTriggerDailyPost };