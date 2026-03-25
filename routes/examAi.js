import { Router } from 'express';
import { streamChapterGuide, getChapterGuideFull } from '../services/aiAgent.js';

const router = Router();

/**
 * POST /api/ai/chapter-guide
 * Streams an AI answer for a chapter-specific user query via SSE
 *
 * Request body:
 * {
 *   "chapterId": 3,
 *   "userQuery": "Give me a comprehensive overview and all key concepts for this chapter."
 * }
 *
 * Response (200 OK - Server-Sent Events stream):
 * data: {"content": "text chunk"}
 * data: [DONE]
 */
router.post('/ai/chapter-guide', async (req, res) => {
    const { chapterId, userQuery } = req.body;

    // Validate required fields
    if (!chapterId || !userQuery || !String(userQuery).trim()) {
        return res.status(400).json({
            success: false,
            error: 'chapterId and userQuery are required',
        });
    }

    // Stream response from AI service
    await streamChapterGuide(res, req, chapterId, userQuery);
});

/**
 * POST /api/ai/chapter-guide-full
 * Gets complete chapter guidance (non-streaming)
 *
 * Request body:
 * {
 *   "chapterId": 3,
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
    const { chapterId, userQuery } = req.body;

    // Validate required fields
    if (!chapterId || !userQuery || !String(userQuery).trim()) {
        return res.status(400).json({
            success: false,
            error: 'chapterId and userQuery are required',
        });
    }

    try {
        const answer = await getChapterGuideFull(chapterId, userQuery);
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
