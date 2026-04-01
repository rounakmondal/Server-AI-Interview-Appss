import { Router } from 'express';
import {
    examQueries,
    subjectQueries,
    chapterQueries,
    studyPlanQueries,
} from '../database/examDb.js';

const router = Router();

// ─── Groq helper (non-streaming) ─────────────────────────────────────────────

const GROQ_MODELS = [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'openai/gpt-oss-120b',
    'meta-llama/llama-4-scout-17b-16e-instruct'
];

async function callGroq(systemPrompt, userPrompt, maxTokens = 4000) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY is not configured');

    for (const model of GROQ_MODELS) {
        const controller = new AbortController();
        const timer      = setTimeout(() => controller.abort(), 60_000);
        try {
            const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method:  'POST',
                headers: {
                    Authorization:  `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model,
                    temperature: 0.7,
                    max_tokens:  maxTokens,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user',   content: userPrompt   },
                    ],
                }),
                signal: controller.signal,
            });
            clearTimeout(timer);

            if (!res.ok) {
                console.warn(`[studyplan] ${model} HTTP ${res.status}`);
                continue;
            }
            const data    = await res.json();
            const content = data.choices?.[0]?.message?.content?.trim();
            if (!content) { console.warn(`[studyplan] ${model} empty content`); continue; }
            return content;
        } catch (err) {
            clearTimeout(timer);
            console.warn(`[studyplan] ${model} error:`, err.message);
        }
    }
    throw new Error('All Groq models failed for study plan generation');
}

function extractJSON(text) {
    const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const start   = cleaned.indexOf('{');
    if (start === -1) throw new Error('No JSON found in AI response');

    let partial = cleaned.slice(start);
    try {
        return JSON.parse(partial);
    } catch {
        // Repair truncated JSON by closing unclosed brackets
        const opens  = (partial.match(/{/g) || []).length;
        const closes = (partial.match(/}/g) || []).length;
        partial += '}'.repeat(Math.max(0, opens - closes));
        return JSON.parse(partial);
    }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /api/studyplan/template/:examId
// Returns template plan rows grouped by phase → week
router.get('/studyplan/template/:examId', (req, res) => {
    try {
        const examId = parseInt(req.params.examId, 10);
        if (isNaN(examId) || examId < 1) {
            return res.status(400).json({ success: false, error: 'Invalid examId' });
        }
        const exam = examQueries.getById(examId);
        if (!exam) return res.status(404).json({ success: false, error: 'Exam not found' });

        const rows = studyPlanQueries.template(examId);

        // Group: phase → weekNumber → entries[]
        const phaseMap = {};
        for (const r of rows) {
            const phase = r.phase       || 'General';
            const week  = r.week_number || 1;
            if (!phaseMap[phase])       phaseMap[phase]       = {};
            if (!phaseMap[phase][week]) phaseMap[phase][week] = [];
            phaseMap[phase][week].push({
                subjectId:   r.subject_id,
                subjectName: r.subject_name,
                chapterId:   r.chapter_id,
                chapterName: r.chapter_name,
                notes:       r.notes,
            });
        }

        res.json({ success: true, exam, data: phaseMap });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/studyplan/ai
// Generates a week-by-week AI study plan and saves it
router.post('/studyplan/ai', async (req, res) => {
    try {
        const { userId, examId, examDate, hoursPerDay } = req.body;

        if (!userId || !examId || hoursPerDay === undefined) {
            return res.status(400).json({
                success: false,
                error: 'userId, examId, and hoursPerDay are required',
            });
        }
        const eid   = parseInt(examId, 10);
        if (isNaN(eid) || eid < 1) {
            return res.status(400).json({ success: false, error: 'Invalid examId' });
        }
        const hours = parseFloat(hoursPerDay);
        if (!Number.isFinite(hours) || hours <= 0 || hours > 16) {
            return res.status(400).json({
                success: false,
                error: 'hoursPerDay must be a number between 0.5 and 16',
            });
        }
        if (examDate && !/^\d{4}-\d{2}-\d{2}$/.test(examDate)) {
            return res.status(400).json({ success: false, error: 'examDate must be YYYY-MM-DD' });
        }

        const exam = examQueries.getById(eid);
        if (!exam) return res.status(404).json({ success: false, error: 'Exam not found' });

        // Build syllabus summary for the prompt
        const subjects     = subjectQueries.byExam(eid);
        const syllabusLines = [];
        for (const subj of subjects) {
            const chapters    = chapterQueries.bySubject(subj.id);
            const chapterList = chapters.map(c => c.name).join(', ');
            syllabusLines.push(`  • ${subj.name}: ${chapterList}`);
        }

        const today      = new Date().toISOString().split('T')[0];
        const targetDate = examDate || 'Not specified';

        const systemPrompt =
`You are an expert exam coach for Indian competitive exams.
Generate a complete week-by-week study plan for ${exam.name}.
Exam date: ${targetDate}. Study start date: ${today}. Available study hours per day: ${hours}.
Syllabus:
${syllabusLines.join('\n')}

Return ONLY valid JSON — no extra text. Format:
{
  "weeks": [
    {
      "weekNumber": 1,
      "focus": "<brief theme for the week>",
      "subjects": [
        { "name": "<subject name>", "chapters": ["<chapter name>", ...] }
      ]
    }
  ]
}`;

        const raw  = await callGroq(systemPrompt, `Generate the full study plan for ${exam.name}.`, 4000);
        const plan = extractJSON(raw);

        // Persist to DB
        studyPlanQueries.saveAi(String(userId), eid, examDate || null, hours, plan);

        res.json({ success: true, data: plan });
    } catch (err) {
        console.error('[studyplan/ai] error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/studyplan/ai/:userId/:examId
// Fetches the latest saved AI study plan
router.get('/studyplan/ai/:userId/:examId', (req, res) => {
    try {
        const { userId } = req.params;
        const examId     = parseInt(req.params.examId, 10);

        if (isNaN(examId) || examId < 1) {
            return res.status(400).json({ success: false, error: 'Invalid examId' });
        }

        const record = studyPlanQueries.latestAi(String(userId), examId);
        if (!record) return res.status(404).json({ success: false, error: 'No saved AI plan found' });

        let plan;
        try { plan = JSON.parse(record.plan_json); }
        catch { plan = record.plan_json; }

        const { plan_json: _omit, ...meta } = record;
        res.json({ success: true, data: { ...meta, plan } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

export default router;
