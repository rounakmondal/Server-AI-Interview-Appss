
// Import fallback utility for Groq → Gemini fallback
import { callLLMWithFallback, convertGeminiToOpenAI } from '../utils/llmFallback.js';

// ─── Vision Models Config ────────────────────────────────────────────────────
const GROQ_VISION_MODELS = [
    'llama-3.2-90b-vision-preview',
    'llama-3.2-11b-vision-preview',
];

const GEMINI_VISION_MODELS = [
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-1.5-pro',
];

const VISION_SYSTEM_PROMPT = 'You are a helpful study assistant for Indian government exam aspirants. Help students with their questions, explain concepts clearly, and provide educational support. When shown images (textbook pages, handwritten notes, diagrams, question papers), analyze them thoroughly and provide relevant educational insights, solutions, or explanations. Always be encouraging and supportive.';

/**
 * Vision fallback chain: Groq Vision → Gemini Vision
 * Both are free and support image+text input.
 */
async function callVisionWithFallback(userText, imageBase64) {
    // ── Try Groq Vision models ──
    const groqKey = process.env.GROQ_API_KEY;
    if (groqKey) {
        for (const model of GROQ_VISION_MODELS) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 60_000);
            try {
                console.log(`[vision] Trying Groq ${model}`);
                const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model,
                        temperature: 0.7,
                        max_tokens: 1200,
                        messages: [
                            { role: 'system', content: VISION_SYSTEM_PROMPT },
                            {
                                role: 'user',
                                content: [
                                    { type: 'text', text: userText },
                                    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
                                ],
                            },
                        ],
                    }),
                    signal: controller.signal,
                });
                clearTimeout(timer);

                if (!res.ok) {
                    const errText = await res.text().catch(() => '');
                    console.warn(`[vision] Groq ${model} HTTP ${res.status}: ${errText.slice(0, 120)}`);
                    continue;
                }
                const data = await res.json();
                const content = data.choices?.[0]?.message?.content?.trim();
                if (!content) { console.warn(`[vision] Groq ${model} empty`); continue; }
                console.log(`[vision] success with Groq ${model}`);
                return content;
            } catch (err) {
                clearTimeout(timer);
                console.warn(`[vision] Groq ${model} error:`, err.message);
            }
        }
    }

    // ── Try Gemini Vision models ──
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
        for (const model of GEMINI_VISION_MODELS) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 60_000);
            try {
                console.log(`[vision] Trying Gemini ${model}`);
                const res = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{
                                parts: [
                                    { text: `${VISION_SYSTEM_PROMPT}\n\n${userText}` },
                                    { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
                                ],
                            }],
                            generationConfig: { temperature: 0.7, maxOutputTokens: 1200 },
                        }),
                        signal: controller.signal,
                    }
                );
                clearTimeout(timer);

                if (!res.ok) {
                    const errText = await res.text().catch(() => '');
                    console.warn(`[vision] Gemini ${model} HTTP ${res.status}: ${errText.slice(0, 120)}`);
                    continue;
                }
                const data = await res.json();
                const content = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
                if (!content) { console.warn(`[vision] Gemini ${model} empty`); continue; }
                console.log(`[vision] success with Gemini ${model}`);
                return content;
            } catch (err) {
                clearTimeout(timer);
                console.warn(`[vision] Gemini ${model} error:`, err.message);
            }
        }
    }

    throw new Error('All vision providers failed (Groq Vision + Gemini Vision)');
}

// Fallback to Groq for text-only if OpenAI not available, with Gemini fallback
async function getGroqChatCompletion(messages, maxTokens = 500) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        throw new Error('GROQ_API_KEY not found in .env');
    }

    const models = [
        process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        'openai/gpt-oss-120b',
        'openai/gpt-oss-20b',
        'llama-3.1-8b-instant'
    ];

    let lastError = null;

    for (const model of models) {
        console.log(`Trying model: ${model}`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        try {
            const response = await callLLMWithFallback(
                apiKey,
                messages,
                {
                    model: model,
                    temperature: 0.7,
                    max_tokens: maxTokens,
                    top_p: 0.9
                },
                controller.signal,
                'study-bot'
            );
  
            clearTimeout(timeoutId);

            if (!response.ok) {
                const error = await response.json();
                console.warn(`Model ${model} API error:`, error.error?.message || response.statusText);
                lastError = new Error(`API error: ${error.error?.message || response.statusText}`);
                continue;
            }

            const data = await response.json();
            // Handle Gemini response format (different from OpenAI)
            const finalData = data.candidates ? convertGeminiToOpenAI(data) : data;

            if (!finalData.choices || !finalData.choices[0] || !finalData.choices[0].message) {
                console.warn(`Model ${model} invalid response structure`);
                lastError = new Error('Invalid API response structure');
                continue;
            }

            const content = finalData.choices[0].message.content;

            if (!content || content.trim() === '') {
                console.warn(`Model ${model} returned empty content`);
                lastError = new Error('API returned empty content');
                continue;
            }

            console.log(`Success with model: ${model}`);
            return content.trim();

        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                lastError = new Error('API request timed out');
            } else {
                lastError = error;
            }
            console.warn(`Model ${model} error:`, lastError.message);
            continue;
        }
    }

    throw lastError || new Error('All models failed including Gemini fallback');
}

// Generate study bot response
export async function generateStudyResponse(messages, imageBase64 = null) {
    try {
        // If there's an image, use vision fallback chain: Groq Vision → Gemini Vision
        if (imageBase64) {
            const userText = messages[messages.length - 1]?.content || 'Please analyze this image for study purposes.';
            const content = await callVisionWithFallback(userText, imageBase64);
            return {
                success: true,
                response: content
            };
        } else {
            // Text-only, use Groq
            const groqMessages = [
                {
                    role: 'system',
                    content: 'You are a helpful study assistant. Help students with their questions, explain concepts clearly, provide educational support, and engage in educational conversations.'
                },
                ...messages
            ];

            const response = await getGroqChatCompletion(groqMessages, 1000);

            return {
                success: true,
                response: response
            };
        }
    } catch (error) {
        console.error('Study bot error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}