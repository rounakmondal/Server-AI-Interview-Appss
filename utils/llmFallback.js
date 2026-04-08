/**
 * LLM Fallback Utility
 * Provides fallback mechanism from Groq to Gemini API
 * If Groq fails, automatically retries with Gemini using the same request body
 */

import fetch from 'node-fetch';

const GROQ_API_BASE = 'https://api.groq.com/openai/v1/chat/completions';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent';

/**
 * Converts OpenAI format messages to Gemini format
 * @param {Array} messages - OpenAI format messages: [{role, content}, ...]
 * @returns {Object} Gemini format: {contents: [{parts: [{text}]}]}
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
 * Calls Groq API with fallback to Gemini
 * @param {string} apiKey - Groq API key
 * @param {Array} messages - Messages in OpenAI format
 * @param {Object} options - Additional options {model, temperature, max_tokens, top_p}
 * @param {AbortSignal} signal - Abort signal for timeout
 * @param {string} source - Source identifier for logging ('streaming' or 'standard')
 * @returns {Promise<Object>} API response
 */
export async function callLLMWithFallback(apiKey, messages, options = {}, signal = null, source = 'standard') {
  const {
    model = 'llama-3.3-70b-versatile',
    temperature = 0.7,
    max_tokens = 1000,
    top_p = 0.9,
    stream = false
  } = options;

  // Try Groq first
  try {
    console.log(`[LLM-Fallback] Attempting Groq (${source})`);
    const groqResponse = await fetch(GROQ_API_BASE, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens,
        top_p,
        messages,
        stream
      }),
      signal
    });

    if (groqResponse.ok) {
      console.log(`[LLM-Fallback] Groq succeeded (${source})`);
      return groqResponse;
    }

    const groqError = await groqResponse.text().catch(() => '');
    console.warn(`[LLM-Fallback] Groq failed with ${groqResponse.status}: ${groqError.slice(0, 100)}`);
  } catch (err) {
    console.warn(`[LLM-Fallback] Groq error (${source}):`, err.message);
  }

  // Fallback to Gemini
  console.log(`[LLM-Fallback] Fallback to Gemini (${source})`);
  
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    throw new Error('Groq failed and GEMINI_API_KEY is not configured');
  }

  const geminiBody = convertToGeminiFormat(messages);
  
  const geminiResponse = await fetch(`${GEMINI_API_BASE}?key=${geminiApiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(geminiBody),
    signal
  });

  if (!geminiResponse.ok) {
    const geminiError = await geminiResponse.text().catch(() => '');
    throw new Error(`Both Groq and Gemini failed. Gemini: ${geminiResponse.status} ${geminiError.slice(0, 100)}`);
  }

  console.log(`[LLM-Fallback] Gemini succeeded (${source})`);
  return geminiResponse;
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

  // Try Groq first
  try {
    console.log('[LLM-Fallback-Stream] Attempting Groq');
    apiResponse = await fetch(GROQ_API_BASE, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens,
        top_p,
        messages,
        stream: true
      }),
      signal: controller.signal
    });

    if (apiResponse.ok) {
      console.log('[LLM-Fallback-Stream] Groq succeeded');
      return handleGroqStream(res, apiResponse, timer, controller);
    }

    const groqError = await apiResponse.text().catch(() => '');
    console.warn('[LLM-Fallback-Stream] Groq failed:', apiResponse.status, groqError.slice(0, 100));
  } catch (err) {
    console.warn('[LLM-Fallback-Stream] Groq error:', err.message);
  }

  // Fallback to Gemini
  console.log('[LLM-Fallback-Stream] Fallback to Gemini');
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
  
  try {
    apiResponse = await fetch(`${GEMINI_API_BASE}?key=${geminiApiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(geminiBody),
      signal: controller.signal
    });

    if (!apiResponse.ok) {
      const geminiError = await apiResponse.text().catch(() => '');
      throw new Error(`Gemini failed: ${apiResponse.status} ${geminiError.slice(0, 100)}`);
    }

    console.log('[LLM-Fallback-Stream] Gemini succeeded');
    return handleGeminiStream(res, apiResponse, timer, controller);
  } catch (err) {
    clearTimeout(timer);
    console.error('[LLM-Fallback-Stream] Gemini error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
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
