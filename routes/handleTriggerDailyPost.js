const fetch = require("node-fetch");
const cron = require("node-cron");

const SUBJECTS = ["police", "wbcs", "wbpsc"];
const POST_URL = "https://recomendengine-1.onrender.com/daily-post";

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

// Post all subjects
async function postAllSubjects(label) {
  console.log(
    `[DailyPost] ${label} batch starting at ${new Date().toISOString()}`
  );

  const results = await Promise.allSettled(
    SUBJECTS.map((s) => postDaily(s))
  );

  return results.map((r, i) => ({
    subject: SUBJECTS[i],
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

module.exports = {
  scheduleDailyPosts,
  handleTriggerDailyPost,
};