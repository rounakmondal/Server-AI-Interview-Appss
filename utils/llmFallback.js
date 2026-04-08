/**
 * LLM Fallback Utility
 * Provides fallback mechanism from Groq to Gemini API
 * If Groq fails, automatically retries with Gemini using the same request body
 */

import fetch from 'node-fetch';

const GROQ_API_BASE = 'https://api.groq.com/openai/v1/chat/completions';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Groq models to try in order (429 is per-model, so rotating helps)
const GROQ_FALLBACK_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'meta-llama/llama-4-scout-17b-16e-instruct',
];

// Gemini models to try in order (quota may differ per model)
const GEMINI_FALLBACK_MODELS = [
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash',
  'gemini-1.5-flash-latest',
];

/**
 * Converts OpenAI format messages to Gemini format
 */
function convertToGeminiFormat(messages) {
  const parts = messages.map(msg => ({
    text: msg.content
  }));
  
  return {
    contents: [
      {
        parts: parts
      }
    ]
  };
}

/**
 * Calls Groq API with multi-model fallback, then Gemini multi-model fallback.
 * Order: Groq model1 → model2 → model3 → Gemini model1 → model2 → model3
 */
export async function callLLMWithFallback(apiKey, messages, options = {}, signal = null, source = 'standard') {
  const {
    model = 'llama-3.3-70b-versatile',
    temperature = 0.7,
    max_tokens = 1000,
    top_p = 0.9,
    stream = false
  } = options;

  // Build Groq model list: requested model first, then fallbacks
  const groqModels = [model, ...GROQ_FALLBACK_MODELS.filter(m => m !== model)];

  // ── Try all Groq models ──
  for (const groqModel of groqModels) {
    try {
      console.log(`[LLM-Fallback] Trying Groq ${groqModel} (${source})`);
      const groqResponse = await fetch(GROQ_API_BASE, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: groqModel,
          temperature,
          max_tokens,
          top_p,
          messages,
          stream
        }),
        signal
      });

      if (groqResponse.ok) {
        console.log(`[LLM-Fallback] Groq ${groqModel} succeeded (${source})`);
        return groqResponse;
      }

      const errText = await groqResponse.text().catch(() => '');
      console.warn(`[LLM-Fallback] Groq ${groqModel} → ${groqResponse.status}: ${errText.slice(0, 80)}`);

      // Only try next model if rate-limited; other errors won't be helped by model rotation
      if (groqResponse.status !== 429) break;
    } catch (err) {
      console.warn(`[LLM-Fallback] Groq ${groqModel} error:`, err.message);
    }
  }

  // ── Try all Gemini models ──
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    throw new Error('All Groq models failed and GEMINI_API_KEY is not configured');
  }

  const geminiBody = convertToGeminiFormat(messages);

  for (const geminiModel of GEMINI_FALLBACK_MODELS) {
    try {
      console.log(`[LLM-Fallback] Trying Gemini ${geminiModel} (${source})`);
      const geminiResponse = await fetch(
        `${GEMINI_API_BASE}/${geminiModel}:generateContent?key=${geminiApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(geminiBody),
          signal
        }
      );

      if (geminiResponse.ok) {
        console.log(`[LLM-Fallback] Gemini ${geminiModel} succeeded (${source})`);
        return geminiResponse;
      }

      const errText = await geminiResponse.text().catch(() => '');
      console.warn(`[LLM-Fallback] Gemini ${geminiModel} → ${geminiResponse.status}: ${errText.slice(0, 80)}`);

      // Only try next model if rate-limited
      if (geminiResponse.status !== 429) break;
    } catch (err) {
      console.warn(`[LLM-Fallback] Gemini ${geminiModel} error:`, err.message);
    }
  }

  throw new Error(`All LLM providers exhausted (${source}). Both Groq and Gemini rate-limited.`);
}

/**
 * Calls Groq API and handles streaming response via SSE
 * Falls back to Gemini if Groq fails
 * @param {Object} res - Express response object
 * @param {string} groqApiKey - Groq API key
 * @param {Array} messages - Messages in OpenAI format
 * @param {Object} options - Additional options {model, temperature, max_tokens, top_p}
 * @param {AbortController} controller - Abort controller
 * @param {NodeJS.Timeout} timer - Timeout timer
 * @returns {Promise<void>}
 */
export async function streamLLMWithFallback(res, groqApiKey, messages, options = {}, controller, timer) {
  const {
    model = 'llama-3.3-70b-versatile',
    temperature = 0.7,
    max_tokens = 1000,
    top_p = 0.9
  } = options;

  let apiResponse = null;
  let usedGemini = false;

  // Try Groq first (streaming)
  const groqModels = [model, ...GROQ_FALLBACK_MODELS.filter(m => m !== model)];
  
  for (const groqModel of groqModels) {
    try {
      console.log(`[LLM-Fallback-Stream] Trying Groq ${groqModel}`);
      apiResponse = await fetch(GROQ_API_BASE, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${groqApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: groqModel,
          temperature,
          max_tokens,
          top_p,
          messages,
          stream: true
        }),
        signal: controller.signal
      });

      if (apiResponse.ok) {
        console.log(`[LLM-Fallback-Stream] Groq ${groqModel} succeeded`);
        return handleGroqStream(res, apiResponse, timer, controller);
      }

      const groqError = await apiResponse.text().catch(() => '');
      console.warn(`[LLM-Fallback-Stream] Groq ${groqModel} → ${apiResponse.status}: ${groqError.slice(0, 80)}`);
      if (apiResponse.status !== 429) break;
    } catch (err) {
      console.warn(`[LLM-Fallback-Stream] Groq ${groqModel} error:`, err.message);
    }
  }

  // Fallback to Gemini models
  console.log('[LLM-Fallback-Stream] All Groq models failed, trying Gemini');
  usedGemini = true;
  
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'AI service unavailable (no fallback configured)' });
    } else {
      res.write(`data: ${JSON.stringify({ error: 'AI service unavailable' })}\n\n`);
      res.end();
    }
    return;
  }

  const geminiBody = convertToGeminiFormat(messages);
  
  for (const geminiModel of GEMINI_FALLBACK_MODELS) {
    try {
      console.log(`[LLM-Fallback-Stream] Trying Gemini ${geminiModel}`);
      apiResponse = await fetch(
        `${GEMINI_API_BASE}/${geminiModel}:generateContent?key=${geminiApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(geminiBody),
          signal: controller.signal
        }
      );

      if (apiResponse.ok) {
        console.log(`[LLM-Fallback-Stream] Gemini ${geminiModel} succeeded`);
        return handleGeminiStream(res, apiResponse, timer, controller);
      }

      const errText = await apiResponse.text().catch(() => '');
      console.warn(`[LLM-Fallback-Stream] Gemini ${geminiModel} → ${apiResponse.status}: ${errText.slice(0, 80)}`);
      if (apiResponse.status !== 429) break;
    } catch (err) {
      console.warn(`[LLM-Fallback-Stream] Gemini ${geminiModel} error:`, err.message);
    }
  }

  // All providers failed
  clearTimeout(timer);
  if (!res.headersSent) {
    res.status(500).json({ error: 'All AI providers exhausted' });
  } else {
    res.write(`data: ${JSON.stringify({ error: 'All AI providers exhausted' })}\n\n`);
    res.end();
  }
}

/**
 * Handles Groq streaming response
 * @param {Object} res - Express response object
 * @param {Response} groqRes - Groq API response
 * @param {NodeJS.Timeout} timer - Timeout timer
 * @param {AbortController} controller - Abort controller
 * @returns {Promise<void>}
 */
async function handleGroqStream(res, groqRes, timer, controller) {
  try {
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
          if (content) res.write(`data: ${JSON.stringify({ content, source: 'groq' })}\n\n`);
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
 * Handles Gemini streaming response (converts to SSE format)
 * @param {Object} res - Express response object
 * @param {Response} geminiRes - Gemini API response
 * @param {NodeJS.Timeout} timer - Timeout timer
 * @param {AbortController} controller - Abort controller
 * @returns {Promise<void>}
 */
async function handleGeminiStream(res, geminiRes, timer, controller) {
  try {
    const data = await geminiRes.json();
    clearTimeout(timer);

    // Extract content from Gemini response
    const candidates = data.candidates || [];
    if (candidates.length === 0) {
      res.write(`data: ${JSON.stringify({ error: 'No candidates from Gemini' })}\n\n`);
      res.end();
      return;
    }

    const content = candidates[0]?.content?.parts?.[0]?.text || '';
    if (!content) {
      res.write(`data: ${JSON.stringify({ error: 'Empty response from Gemini' })}\n\n`);
      res.end();
      return;
    }

    // Send as chunked SSE (simulate streaming by splitting by words)
    const words = content.split(' ');
    for (const word of words) {
      res.write(`data: ${JSON.stringify({ content: word + ' ', source: 'gemini' })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
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
 * Converts Gemini response to OpenAI format for backward compatibility
 * @param {Object} geminiResponse - Gemini API response data
 * @returns {Object} OpenAI format response
 */
export function convertGeminiToOpenAI(geminiResponse) {
  const candidates = geminiResponse.candidates || [];
  const content = candidates[0]?.content?.parts?.[0]?.text || '';

  return {
    choices: [
      {
        message: {
          content: content,
          role: 'assistant'
        },
        finish_reason: 'stop',
        index: 0
      }
    ],
    usage: {
      prompt_tokens: geminiResponse.usageMetadata?.promptTokenCount || 0,
      completion_tokens: geminiResponse.usageMetadata?.candidatesTokenCount || 0,
      total_tokens: (geminiResponse.usageMetadata?.promptTokenCount || 0) + (geminiResponse.usageMetadata?.candidatesTokenCount || 0)
    }
  };
}
