import { Router } from 'express';
import { streamChapterGuide, getChapterGuideFull, queryAI } from '../services/aiAgent.js';

const router = Router();

/**
 * POST /api/ai/chapter-guide
 * Streams an AI answer for a chapter-specific user query via SSE
 *
 * Request body:
 * {
 *   "chapterId": 3,
 *   "chapterName": "Seating Arrangement",  (optional, used for fallback lookup)
 *   "userQuery": "Give me a comprehensive overview and all key concepts for this chapter."
 * }
 *
 * Response (200 OK - Server-Sent Events stream):
 * data: {"content": "text chunk"}
 * data: [DONE]
 */
router.post('/ai/chapter-guide', async (req, res) => {
    const { chapterId, chapterName, userQuery } = req.body;

    // Validate required fields
    if (!userQuery || !String(userQuery).trim()) {
        return res.status(400).json({
            success: false,
            error: 'userQuery is required',
        });
    }

    if (!chapterId && !chapterName) {
        return res.status(400).json({
            success: false,
            error: 'Either chapterId or chapterName is required',
        });
    }

    // Stream response from AI service
    await streamChapterGuide(res, req, chapterId, userQuery, chapterName);
});

/**
 * POST /api/ai/chapter-guide-full
 * Gets complete chapter guidance (non-streaming)
 *
 * Request body:
 * {
 *   "chapterId": 3,
 *   "chapterName": "Seating Arrangement",  (optional, used for fallback lookup)
 *   "userQuery": "Explain this concept"
 * }
 *
 * Response (200 OK - JSON):
 * {
 *   "success": true,
 *   "answer": "Complete response text..."
 * }
 */
router.post('/ai/chapter-guide-full', async (req, res) => {
    const { chapterId, chapterName, userQuery } = req.body;

    // Validate required fields
    if (!userQuery || !String(userQuery).trim()) {
        return res.status(400).json({
            success: false,
            error: 'userQuery is required',
        });
    }

    if (!chapterId && !chapterName) {
        return res.status(400).json({
            success: false,
            error: 'Either chapterId or chapterName is required',
        });
    }

    try {
        const answer = await getChapterGuideFull(chapterId, userQuery, chapterName);
        res.json({
            success: true,
            answer,
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message,
        });
    }
});

export default router;

/**
 * POST /api/ai/generate-mcq
 * Generates MCQ questions using the AI agent and returns JSON array:
 * [ { "q": "...", "options": ["a","b","c","d"], "answer": "a" }, ... ]
 */
router.post('/ai/generate-mcq', async (req, res) => {
    try {
        const { topic = 'Panchayat exam (West Bengal)', count = 50, language = 'English' } = req.body || {};
        const num = parseInt(count, 10) || 50;
        if (num <= 0 || num > 200) return res.status(400).json({ success: false, error: 'count must be between 1 and 200' });

        const systemPrompt = `You are an experienced question-writer for Indian state-level Panchayat recruitment exams (West Bengal). Produce well-formed multiple-choice questions suitable for objective tests.`;

        const userQuery = `Generate ${num} multiple-choice questions in ${language} about ${topic}. Respond ONLY with a JSON array. Each item must be an object with keys: "q" (the question text), "options" (an array of 4 option strings), and "answer" (the exact text of the correct option). Do not include explanations, markdown, or extra text. Make questions factual, concise, and relevant to Panchayat roles, local governance, schemes, and processes.`;

        const aiText = await queryAI(systemPrompt, userQuery, { stream: false, maxTokens: 5000 });

        // Try to parse AI output as JSON
        try {
            const parsed = JSON.parse(aiText.trim());
            if (!Array.isArray(parsed)) throw new Error('AI returned non-array');
            return res.json({ success: true, questions: parsed.slice(0, num) });
        } catch (parseErr) {
            // Return raw AI text for debugging if parsing fails
            return res.status(500).json({ success: false, error: 'Failed to parse AI output as JSON', raw: aiText });
        }
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});
