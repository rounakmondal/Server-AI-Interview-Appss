/**
 * examSyllabusSearch.js — AI-powered exam syllabus search
 * GET /api/exam-syllabus?q={search_query}
 */

import { Router } from 'express';

const router = Router();

// ─── Groq AI helper ─────────────────────────────────────────────────────────

const GROQ_MODELS = [
    'llama-3.3-70b-versatile',
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'llama-3.1-8b-instant',
];

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function callGroq(systemPrompt, userPrompt, maxTokens = 8000) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY is not configured');
    
    const { callLLMWithFallback, convertGeminiToOpenAI } = await import('../utils/llmFallback.js');

    let lastError = null;

    for (const model of GROQ_MODELS) {
        // Retry up to 2 times per model for rate-limit (429)
        for (let attempt = 0; attempt < 2; attempt++) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 60_000);
            try {
                const res = await callLLMWithFallback(
                    apiKey,
                    [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt },
                    ],
                    {
                        model,
                        temperature: 0.4,
                        max_tokens: maxTokens
                    },
                    controller.signal,
                    'exam-syllabus'
                );
                clearTimeout(timer);

                if (res.status === 429) {
                    // Rate limited — wait and retry same model once
                    const retryAfter = parseInt(res.headers.get('retry-after') || '3', 10);
                    const waitMs = Math.min(retryAfter * 1000, 10_000);
                    console.warn(`[exam-syllabus] ${model} rate-limited (429), retrying in ${waitMs}ms (attempt ${attempt + 1})`);
                    lastError = new Error(`${model} rate-limited`);
                    await delay(waitMs);
                    continue; // retry same model
                }

                if (res.status === 413) {
                    // Payload too large — skip to next model
                    console.warn(`[exam-syllabus] ${model} payload too large (413), skipping`);
                    lastError = new Error(`${model} payload too large`);
                    break; // next model
                }

                if (!res.ok) {
                    console.warn(`[exam-syllabus] ${model} HTTP ${res.status}`);
                    lastError = new Error(`${model} HTTP ${res.status}`);
                    break; // next model
                }

                const data = await res.json();
                // Handle Gemini response format (different from OpenAI)
                const finalData = data.candidates ? convertGeminiToOpenAI(data) : data;
                const content = finalData.choices?.[0]?.message?.content?.trim();
                if (!content) {
                    console.warn(`[exam-syllabus] ${model} empty content`);
                    lastError = new Error(`${model} empty content`);
                    break; // next model
                }
                console.log(`[exam-syllabus] Success with model: ${model}`);
                return content;
            } catch (err) {
                clearTimeout(timer);
                console.warn(`[exam-syllabus] ${model} error:`, err.message);
                lastError = err;
                break; // next model
            }
        }
    }
    throw lastError || new Error('All Groq models failed');
}

// ─── JSON extraction helper ─────────────────────────────────────────────────

function extractJSON(text) {
    const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const start = cleaned.indexOf('{');
    if (start === -1) throw new Error('No JSON found in AI response');

    let partial = cleaned.slice(start);
    try {
        return JSON.parse(partial);
    } catch {
        // Repair truncated JSON — balance braces and brackets
        const openBraces = (partial.match(/{/g) || []).length;
        const closeBraces = (partial.match(/}/g) || []).length;
        const openBrackets = (partial.match(/\[/g) || []).length;
        const closeBrackets = (partial.match(/]/g) || []).length;
        partial += ']'.repeat(Math.max(0, openBrackets - closeBrackets));
        partial += '}'.repeat(Math.max(0, openBraces - closeBraces));
        return JSON.parse(partial);
    }
}

// ─── System prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an Indian competitive exam syllabus expert. Return matching exam syllabus data as JSON.

Cover: WBCS, WB Police SI, WB Police Constable, WBPSC Clerkship, WB Primary TET, SSC CGL, SSC CHSL, SSC MTS, IBPS PO, IBPS Clerk, SBI PO, UPSC CSE, NDA, RRB NTPC, Railway Group D, CTET, and others.

RULES:
- "exams": array of matches (multiple for broad queries), [] if none
- "category": "state-govt"|"central-govt"|"bank"|"defence"|"teaching"|"railway"|"corporate"
- Round "type": "written"|"physical"|"interview"|"skill"|"medical"|"document"|"online"
- Rounds ordered by sequence. Topics have optional marks, questions, subtopics.
- "id": URL-safe slug. "tips", "applicationFee", "vacancies", "officialWebsite" optional.
- "cutoffs": optional array, 1–3 years of previous cutoff data. Each entry: year, stage, source (optional), categories array with category/cutoffMarks/maxMarks(optional). Use realistic data.

Return ONLY valid JSON:
{"success":true,"query":"<q>","exams":[{"id":"slug","name":"Full Name","shortName":"SHORT","conductedBy":"Body","category":"state-govt","eligibility":"...","ageLimit":"...","applicationFee":"...","frequency":"...","vacancies":"...","officialWebsite":"https://...","description":"...","rounds":[{"name":"Round","type":"written","duration":"...","totalMarks":200,"totalQuestions":200,"negativeMarking":"...","passingMarks":"...","description":"...","topics":[{"name":"Topic","marks":25,"questions":25,"subtopics":["Sub1"]}]}],"tips":["tip1"],"tags":["tag1"],"cutoffs":[{"year":2024,"stage":"Prelims","source":"Official","categories":[{"category":"General","cutoffMarks":130,"maxMarks":200}]}]}]}`;

// ─── GET /api/exam-syllabus?q={search_query} ───────────────────────────────

router.get('/exam-syllabus', async (req, res) => {
    try {
        const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';

        if (!query) {
            return res.status(400).json({
                success: false,
                error: 'Missing required query parameter: q',
            });
        }

        if (query.length > 200) {
            return res.status(400).json({
                success: false,
                error: 'Query too long (max 200 characters)',
            });
        }

        const userPrompt = `Search query: "${query}"

Return exams matching the query. If the query is broad (e.g. "police", "bank", "SSC"), return ALL matching exams. If specific (e.g. "WBCS"), return that one exam with full details. Return "exams": [] if no match.`;

        const raw = await callGroq(SYSTEM_PROMPT, userPrompt);
        const parsed = extractJSON(raw);

        // Ensure the response has the expected structure
        const result = {
            success: true,
            query,
            exams: Array.isArray(parsed.exams) ? parsed.exams : [],
        };

        res.json(result);
    } catch (err) {
        console.error('[exam-syllabus] Error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch exam syllabus data',
        });
    }
});

export default router;
