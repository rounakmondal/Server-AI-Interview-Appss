import { Router } from 'express';
import { chapterQueries, subjectQueries, examQueries } from '../database/examDb.js';

const router = Router();

// POST /api/ai/chapter-guide
// Streams an AI answer for a chapter-specific user query via SSE
router.post('/ai/chapter-guide', async (req, res) => {
    const { chapterId, userQuery } = req.body;

    if (!chapterId || !userQuery || !String(userQuery).trim()) {
        return res.status(400).json({
            success: false,
            error: 'chapterId and userQuery are required',
        });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ success: false, error: 'AI service not configured' });
    }

    const cid = parseInt(chapterId, 10);
    if (isNaN(cid) || cid < 1) {
        return res.status(400).json({ success: false, error: 'Invalid chapterId' });
    }

    const chapter = chapterQueries.getById(cid);
    if (!chapter) return res.status(404).json({ success: false, error: 'Chapter not found' });

    const subject = subjectQueries.getById(chapter.subject_id);
    const exam    = subject ? examQueries.getById(subject.exam_id) : null;

    // Sanitize: cap length and strip angle-bracket characters to prevent prompt injection
    const safeQuery = String(userQuery).slice(0, 500).replace(/[<>]/g, '');

    const systemPrompt =
`You are a study assistant for Indian competitive exams.
Chapter: ${chapter.name}
Subject: ${subject?.name ?? 'General'}
Exam:    ${exam?.name    ?? 'Indian Competitive Exam'}

Answer the student's question clearly and concisely with exam relevance in mind.
Use bullet points or numbered steps where it helps. Keep the response under 400 words.
Do not make up facts. If unsure, say so.`;

    // Set SSE headers before the async fetch so the client gets a streaming connection
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.flushHeaders();

    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), 60_000);

    // Abort stream if the client disconnects
    req.on('close', () => controller.abort());

    try {
        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method:  'POST',
            headers: {
                Authorization:  `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model:       'llama-3.3-70b-versatile',
                temperature: 0.7,
                max_tokens:  1000,
                stream:      true,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user',   content: safeQuery    },
                ],
            }),
            signal: controller.signal,
        });
        clearTimeout(timer);

        if (!groqRes.ok) {
            res.write(`data: ${JSON.stringify({ error: `AI service error: ${groqRes.status}` })}\n\n`);
            res.end();
            return;
        }

        const reader  = groqRes.body.getReader();
        const decoder = new TextDecoder();

        // Relay SSE chunks from Groq to the client
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            for (const line of chunk.split('\n')) {
                if (!line.startsWith('data: ')) continue;
                const payload = line.slice(6).trim();
                if (payload === '[DONE]') {
                    res.write('data: [DONE]\n\n');
                    break;
                }
                try {
                    const parsed  = JSON.parse(payload);
                    const content = parsed.choices?.[0]?.delta?.content;
                    if (content) res.write(`data: ${JSON.stringify({ content })}\n\n`);
                } catch {
                    // Skip malformed SSE lines from upstream
                }
            }
        }
        res.end();
    } catch (err) {
        clearTimeout(timer);
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: err.message });
        } else {
            res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
            res.end();
        }
    }
});

export default router;
