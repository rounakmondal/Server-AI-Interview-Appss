import { chapterQueries, subjectQueries, examQueries } from '../database/examDb.js';
import { callLLMWithFallback, streamLLMWithFallback, convertGeminiToOpenAI } from '../utils/llmFallback.js';

/**
 * AI Agent Service - Handles streaming responses from Groq API with fallback to Gemini
 * Used for chapter guides, study assistance, and exam prep
 */

const GROQ_MODELS = [
    process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
    'llama-3.1-8b-instant',
];

/**
 * Validates API key configuration
 * @returns {string} API key
 * @throws {Error} If API key is not configured
 */
function getApiKey() {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        throw new Error('AI service not configured: GROQ_API_KEY is missing');
    }
    return apiKey;
}

/**
 * Sanitizes user query to prevent prompt injection
 * @param {string} query - Raw user query
 * @returns {string} Sanitized query
 */
function sanitizeQuery(query) {
    return String(query).slice(0, 500).replace(/[<>]/g, '');
}

/**
 * Builds system prompt for chapter guide
 * @param {Object} chapter - Chapter object with name
 * @param {Object} subject - Subject object with name (optional)
 * @param {Object} exam - Exam object with name (optional)
 * @returns {string} System prompt
 */
function buildChapterSystemPrompt(chapter, subject, exam) {
    return `You are a study assistant for Indian competitive exams.
Chapter: ${chapter.name}
Subject: ${subject?.name ?? 'General'}
Exam:    ${exam?.name    ?? 'Indian Competitive Exam'}

Answer the student's question clearly and concisely with exam relevance in mind.
Use bullet points or numbered steps where it helps. Keep the response under 400 words.
Do not make up facts. If unsure, say so.`;
}

/**
 * Streams chapter guide from Groq API via SSE
 * @param {Object} res - Express response object
 * @param {Object} req - Express request object
 * @param {number} chapterId - Chapter ID
 * @param {string} userQuery - User's question
 * @param {string} chapterName - Optional: Chapter name for fallback lookup
 * @returns {Promise<void>}
 */
export async function streamChapterGuide(res, req, chapterId, userQuery, chapterName) {
    try {
        let chapter = null;

        // Try to get chapter by ID first
        if (chapterId) {
            const cid = parseInt(chapterId, 10);
            if (!isNaN(cid) && cid > 0) {
                chapter = chapterQueries.getById(cid);
            }
        }

        // Fallback: Try to get chapter by name if ID lookup failed
        if (!chapter && chapterName) {
            chapter = chapterQueries.getByName(chapterName);
            // If exact match fails, try fuzzy search
            if (!chapter) {
                chapter = chapterQueries.getByNameFuzzy(chapterName);
            }
        }

        // If still not found, return error
        if (!chapter) {
            if (!res.headersSent) {
                return res.status(404).json({
                    success: false,
                    error: `Chapter not found (id: ${chapterId}, name: ${chapterName || 'not provided'})`
                });
            }
            res.write(`data: ${JSON.stringify({ error: 'Chapter not found' })}\n\n`);
            res.end();
            return;
        }

        const subject = subjectQueries.getById(chapter.subject_id);
        const exam = subject ? examQueries.getById(subject.exam_id) : null;

        // Get API key
        const apiKey = getApiKey();

        // Sanitize query
        const safeQuery = sanitizeQuery(userQuery);

        // Build system prompt
        const systemPrompt = buildChapterSystemPrompt(chapter, subject, exam);

        // Set SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        // Setup timeout and abort controller
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 60_000);

        // Abort if client disconnects
        if (req) req.on('close', () => controller.abort());

        // Call Groq API with streaming
        await streamGroqResponse(res, apiKey, systemPrompt, safeQuery, timer, controller);
    } catch (err) {
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: err.message });
        } else {
            res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
            res.end();
        }
    }
}

/**
 * Calls Groq API and streams response via SSE
 * @param {Object} res - Express response object
 * @param {string} apiKey - Groq API key
 * @param {string} systemPrompt - System prompt for AI
 * @param {string} userQuery - User query
 * @param {NodeJS.Timeout} timer - Timeout timer
 * @param {AbortController} controller - Abort controller
 * @returns {Promise<void>}
 */
async function streamGroqResponse(res, apiKey, systemPrompt, userQuery, timer, controller) {
    try {
        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: GROQ_MODELS[0], // Use main model
                temperature: 0.7,
                max_tokens: 1000,
                stream: true,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userQuery },
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

        // Stream SSE chunks from Groq
        const reader = groqRes.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            for (const line of chunk.split('\n')) {
                if (!line.startsWith('data: ')) continue;
                const payload = line.slice(6).trim();
                if (payload === '[DONE]') {
                    res.write('data: [DONE]\n\n');
                    res.end();
                    return;
                }
                try {
                    const parsed = JSON.parse(payload);
                    const content = parsed.choices?.[0]?.delta?.content;
                    if (content) res.write(`data: ${JSON.stringify({ content })}\n\n`);
                } catch {
                    // Skip malformed SSE lines
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
}

/**
 * Gets non-streaming chapter guidance (full response at once)
 * @param {number} chapterId - Chapter ID
 * @param {string} userQuery - User's question
 * @param {string} chapterName - Optional: Chapter name for fallback lookup
 * @returns {Promise<string>} Complete AI response
 */
export async function getChapterGuideFull(chapterId, userQuery, chapterName) {
    try {
        let chapter = null;

        // Try to get chapter by ID first
        if (chapterId) {
            const cid = parseInt(chapterId, 10);
            if (!isNaN(cid) && cid > 0) {
                chapter = chapterQueries.getById(cid);
            }
        }

        // Fallback: Try to get chapter by name if ID lookup failed
        if (!chapter && chapterName) {
            chapter = chapterQueries.getByName(chapterName);
            // If exact match fails, try fuzzy search
            if (!chapter) {
                chapter = chapterQueries.getByNameFuzzy(chapterName);
            }
        }

        // If still not found, throw error
        if (!chapter) {
            throw new Error(`Chapter not found (id: ${chapterId}, name: ${chapterName || 'not provided'})`);
        }

        const subject = subjectQueries.getById(chapter.subject_id);
        const exam = subject ? examQueries.getById(subject.exam_id) : null;

        // Get API key
        const apiKey = getApiKey();

        // Sanitize query
        const safeQuery = sanitizeQuery(userQuery);

        // Build system prompt
        const systemPrompt = buildChapterSystemPrompt(chapter, subject, exam);

        // Setup timeout and abort controller
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 60_000);

        try {
            const messages = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: safeQuery },
            ];
            
            const response = await callLLMWithFallback(
                apiKey,
                messages,
                {
                    model: GROQ_MODELS[0],
                    temperature: 0.7,
                    max_tokens: 1000
                },
                controller.signal,
                'chapter-guide'
            );

            clearTimeout(timer);

            if (!response.ok) {
                throw new Error(`AI service error: ${response.status}`);
            }

            const data = await response.json();
            
            // Handle Gemini response format (different from OpenAI)
            const finalData = data.candidates ? convertGeminiToOpenAI(data) : data;
            const content = finalData.choices?.[0]?.message?.content;

            if (!content) {
                throw new Error('No response from AI service');
            }

            return content;
        } catch (err) {
            clearTimeout(timer);
            throw err;
        }
    } catch (err) {
        throw new Error(`Chapter Guide Error: ${err.message}`);
    }
}

/**
 * Custom AI query with flexible system prompt (with Groq → Gemini fallback)
 * @param {string} systemPrompt - Custom system prompt
 * @param {string} userQuery - User query
 * @param {Object} options - Options { stream: boolean, maxTokens: number }
 * @returns {Promise<string|Object>} AI response
 */
export async function queryAI(systemPrompt, userQuery, options = {}) {
    try {
        const { stream = false, maxTokens = 1000 } = options;
        const apiKey = getApiKey();
        const safeQuery = sanitizeQuery(userQuery);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 60_000);

        try {
            const messages = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: safeQuery },
            ];
            
            const response = await callLLMWithFallback(
                apiKey,
                messages,
                {
                    model: GROQ_MODELS[0],
                    temperature: 0.7,
                    max_tokens: maxTokens,
                    stream
                },
                controller.signal,
                'custom-query'
            );

            clearTimeout(timer);

            if (!response.ok) {
                throw new Error(`AI service error: ${response.status}`);
            }

            if (stream) {
                return response; // Return response for streaming
            }

            const data = await response.json();
            // Handle Gemini response format (different from OpenAI)
            const finalData = data.candidates ? convertGeminiToOpenAI(data) : data;
            return finalData.choices?.[0]?.message?.content || 'No response from AI';
        } catch (err) {
            clearTimeout(timer);
            throw err;
        }
    } catch (err) {
        throw new Error(`AI Query Error: ${err.message}`);
    }
}

export default {
    streamChapterGuide,
    getChapterGuideFull,
    queryAI,
    sanitizeQuery,
    buildChapterSystemPrompt,
    getApiKey,
};
