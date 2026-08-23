import { Router } from 'express';
import { getDb } from '../database/mongo.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// ─── Valid skills ────────────────────────────────────────────────────────────
const VALID_SKILLS = new Set([
  'dsa', 'system-design', 'web-dev', 'dbms',
  'oop', 'os-networking', 'aptitude', 'behavioral',
]);

const SKILL_NAMES = {
  dsa:            'Data Structures & Algorithms',
  'system-design':'System Design',
  'web-dev':      'Web Development',
  dbms:           'DBMS',
  oop:            'Object-Oriented Programming',
  'os-networking':'OS & Networking',
  aptitude:       'Aptitude & Logical Reasoning',
  behavioral:     'Behavioral & HR',
};

const SKILL_TOPICS = {
  dsa:            'Arrays, Linked Lists, Trees, Graphs, DP, Sorting, Searching, Recursion, Hashing, Stacks, Queues',
  'system-design':'Scalability, Load Balancers, Caching, DB Sharding, Microservices, CAP theorem, Rate Limiting, Message Queues',
  'web-dev':      'HTML/CSS, JavaScript ES6+, React, Node.js, REST APIs, Auth (JWT/OAuth), Performance, Browser APIs',
  dbms:           'SQL Queries, Normalization, Indexing, Transactions, ACID, Joins, NoSQL, Stored Procedures, Views',
  oop:            'Encapsulation, Inheritance, Polymorphism, Abstraction, SOLID principles, Design Patterns, UML, Composition vs Inheritance',
  'os-networking':'Processes, Threads, Scheduling, Memory Management, Virtual Memory, TCP/IP, HTTP/HTTPS, DNS, OSI Model, Deadlocks',
  aptitude:       'Number Systems, Percentages, Time/Speed/Distance, Probability, Permutations, Logical Reasoning, Puzzles, Data Interpretation',
  behavioral:     'Tell Me About Yourself, Strengths/Weaknesses, STAR Method, Teamwork, Conflict Resolution, Why This Company, Leadership',
};

// ─── AI helper: Groq → SambaNova fallback ────────────────────────────────────
const GROQ_MODELS = [
  process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'llama-3.1-8b-instant',
];

const SAMBANOVA_MODELS = [
  'Meta-Llama-3.3-70B-Instruct',
  'Meta-Llama-3.1-70B-Instruct',
  'Meta-Llama-3.1-8B-Instruct',
];

const MODEL_TOKEN_CAPS = {
  'llama-3.1-8b-instant': 4000,
  'openai/gpt-oss-120b':     4000,
  'openai/gpt-oss-20b':      4000,
  'llama-3.1-8b-instant':    4000,
  'Meta-Llama-3.3-70B-Instruct': 6000,
  'Meta-Llama-3.1-70B-Instruct': 6000,
  'Meta-Llama-3.1-8B-Instruct':  4000,
};

async function callGroq(systemPrompt, userPrompt, maxTokens = 6000) {
  const groqKey = process.env.GROQ_API_KEY;
  const sambaKey = process.env.SAMBANOVA_API_KEY;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userPrompt },
  ];

  // ── Try Groq models ──
  if (groqKey) {
    for (const model of GROQ_MODELS) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60000);
      const effectiveTokens = Math.min(maxTokens, MODEL_TOKEN_CAPS[model] ?? 4000);

      try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            temperature: 0.7,
            max_tokens: effectiveTokens,
            top_p: 0.9,
            messages,
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          console.warn(`[skill-matrix] Groq ${model} HTTP ${res.status}: ${errText.slice(0, 120)}`);
          continue;
        }

        const data    = await res.json();
        const content = data.choices?.[0]?.message?.content?.trim();
        if (!content) { console.warn(`[skill-matrix] Groq ${model} empty content`); continue; }

        console.log(`[skill-matrix] success with Groq ${model}`);
        return content;
      } catch (err) {
        clearTimeout(timer);
        console.warn(`[skill-matrix] Groq ${model} error:`, err.message);
      }
    }
  }

  // ── Try SambaNova models ──
  if (sambaKey) {
    for (const model of SAMBANOVA_MODELS) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60000);
      const effectiveTokens = Math.min(maxTokens, MODEL_TOKEN_CAPS[model] ?? 4000);

      try {
        const res = await fetch('https://api.sambanova.ai/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${sambaKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            temperature: 0.7,
            max_tokens: effectiveTokens,
            top_p: 0.9,
            messages,
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          console.warn(`[skill-matrix] SambaNova ${model} HTTP ${res.status}: ${errText.slice(0, 120)}`);
          continue;
        }

        const data    = await res.json();
        const content = data.choices?.[0]?.message?.content?.trim();
        if (!content) { console.warn(`[skill-matrix] SambaNova ${model} empty content`); continue; }

        console.log(`[skill-matrix] success with SambaNova ${model}`);
        return content;
      } catch (err) {
        clearTimeout(timer);
        console.warn(`[skill-matrix] SambaNova ${model} error:`, err.message);
      }
    }
  }

  throw new Error('All AI providers failed (Groq + SambaNova)');
}

// ─── JSON extraction with truncation repair ──────────────────────────────────
function extractJSON(text) {
  try {
    const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const start = cleaned.indexOf('[');
    if (start === -1) return null;

    let depth = 0, inString = false, escapeNext = false, end = -1;
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (escapeNext)    { escapeNext = false; continue; }
      if (ch === '\\')   { escapeNext = true;  continue; }
      if (ch === '"')    { inString = !inString; continue; }
      if (!inString) {
        if (ch === '[') depth++;
        else if (ch === ']') { depth--; if (depth === 0) { end = i + 1; break; } }
      }
    }

    if (end !== -1) return JSON.parse(cleaned.substring(start, end));

    // Truncated repair
    const partial = cleaned.substring(start);
    const stack = [];
    inString = false; escapeNext = false;
    let lastComma = -1;
    for (let i = 0; i < partial.length; i++) {
      const ch = partial[i];
      if (escapeNext)   { escapeNext = false; continue; }
      if (ch === '\\')  { escapeNext = true;  continue; }
      if (ch === '"')   { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{' || ch === '[') stack.push(ch);
      else if (ch === '}' || ch === ']') stack.pop();
      else if (ch === ',' && stack.length === 1) lastComma = i;
    }

    let safe = lastComma > 0 ? partial.substring(0, lastComma) : partial;
    const closings = stack.reverse().map(c => c === '{' ? '}' : ']').join('');
    return JSON.parse(safe + closings);
  } catch {
    return null;
  }
}

// ─── Practice question cache (skillId → { data, timestamp }) ─────────────────
const practiceCache = new Map();
const PRACTICE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// ═══════════════════════════════════════════════════════════════════════════════
// ENDPOINT 1: GET /api/skill-matrix — Get user's saved scores
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const doc = await db.collection('skill_matrix').findOne({ userId: req.userId });

    return res.json({
      success: true,
      scores: doc?.scores || {},
    });
  } catch (err) {
    console.error('[skill-matrix] GET error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to retrieve scores' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ENDPOINT 2: POST /api/skill-matrix — Save/update user's scores
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/', authMiddleware, async (req, res) => {
  const { scores } = req.body;

  // Validate scores object
  if (!scores || typeof scores !== 'object' || Array.isArray(scores)) {
    return res.status(400).json({ success: false, error: 'Invalid scores format' });
  }

  for (const [key, value] of Object.entries(scores)) {
    if (!VALID_SKILLS.has(key)) {
      return res.status(400).json({ success: false, error: `Invalid scores format` });
    }
    if (!Number.isInteger(value) || value < 0 || value > 5) {
      return res.status(400).json({ success: false, error: 'Invalid scores format' });
    }
  }

  try {
    const db = getDb();
    await db.collection('skill_matrix').updateOne(
      { userId: req.userId },
      {
        $set: {
          scores,
          updatedAt: new Date(),
        },
        $setOnInsert: { userId: req.userId, createdAt: new Date() },
      },
      { upsert: true },
    );

    return res.json({ success: true, message: 'Scores saved successfully' });
  } catch (err) {
    console.error('[skill-matrix] POST error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to save scores' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ENDPOINT 3: GET /api/skill-matrix/practice/:skillId — Practice questions
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/practice/:skillId', async (req, res) => {
  const skillId = req.params.skillId.toLowerCase();

  if (!VALID_SKILLS.has(skillId)) {
    return res.status(404).json({ success: false, error: `Unknown skill: ${req.params.skillId}` });
  }

  // Check cache
  const cached = practiceCache.get(skillId);
  if (cached && Date.now() - cached.timestamp < PRACTICE_CACHE_TTL) {
    return res.json(cached.data);
  }

  const skillName = SKILL_NAMES[skillId];
  const topics    = SKILL_TOPICS[skillId];

  const needsOptions = !['behavioral', 'system-design'].includes(skillId);

  const systemPrompt = `You are an expert tech interview coach. Generate practice questions for "${skillName}". Output ONLY a valid JSON array — no markdown, no explanation.`;

  const userPrompt = `Generate exactly 20 practice questions for "${skillName}".

Topics to cover: ${topics}

Each question object must have this EXACT structure:
{
  "id": <number starting from 1>,
  "question": "<clear interview question>",
  ${needsOptions ? '"options": ["<option A>", "<option B>", "<option C>", "<option D>"],' : ''}
  "answer": "<correct answer${needsOptions ? ' — must match one of the options exactly' : ''}>",
  "explanation": "<2-4 sentence explanation of why this is correct>",
  "difficulty": "<Easy|Medium|Hard>"
}

Rules:
- Mix: ~40% Easy, ~40% Medium, ~20% Hard
- difficulty must be exactly "Easy", "Medium", or "Hard"
${needsOptions ? '- "options" must have exactly 4 choices\n- "answer" must exactly match one of the options' : '- Do NOT include "options" field — these are open-ended questions\n- "answer" should be a detailed 3-5 sentence model answer'}
- explanation must be 2-4 sentences
- Output ONLY a JSON array of 20 objects. No wrapping, no markdown fences.`;

  try {
    const raw = await callGroq(systemPrompt, userPrompt, 6000);

    let questions = extractJSON(raw);
    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      console.error('[skill-matrix] Failed to parse AI response for', skillId);
      return res.status(500).json({ success: false, error: 'Failed to generate questions' });
    }

    // Normalize
    questions = questions.map((q, i) => {
      const obj = {
        id: i + 1,
        question: q.question || '',
        answer: q.answer || '',
        explanation: q.explanation || '',
        difficulty: ['Easy', 'Medium', 'Hard'].includes(q.difficulty) ? q.difficulty : 'Medium',
      };
      if (Array.isArray(q.options) && q.options.length === 4) {
        obj.options = q.options;
      }
      return obj;
    });

    const payload = {
      success: true,
      skillId,
      skillName,
      totalQuestions: questions.length,
      questions,
    };

    practiceCache.set(skillId, { data: payload, timestamp: Date.now() });

    return res.json(payload);
  } catch (err) {
    console.error(`[skill-matrix] practice error for "${skillId}":`, err.message);
    return res.status(500).json({ success: false, error: 'Failed to generate practice questions' });
  }
});

export default router;
