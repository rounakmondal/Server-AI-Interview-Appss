import { Router } from 'express';

const router = Router();

// ─── AI models: Groq → SambaNova fallback ────────────────────────────────────
const GROQ_MODELS = [
  process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'llama-3.1-8b-instant',
];

const SAMBANOVA_MODELS = [
  'Meta-Llama-3.3-70B-Instruct',
  'Meta-Llama-3.1-70B-Instruct',
  'Meta-Llama-3.1-8B-Instruct',
];

const SYSTEM_PROMPT = `তুমি একজন অসাধারণ বাংলা গল্পকার এবং ইতিহাসবিদ। তোমার কণ্ঠে ইতিহাস জীবন্ত হয়ে ওঠে।

তোমার ভূমিকা:
- তুমি শুধু বাংলায় উত্তর দাও
- প্রতিটি গল্প সত্য তথ্যের উপর ভিত্তি করে তৈরি
- ভাষা সাহিত্যিক, সুন্দর কিন্তু সহজবোধ্য
- গল্পের ভঙ্গি — যেন একজন রাজদরবারের গল্পকার সন্ধ্যার আলোয় গল্প শোনাচ্ছেন
- প্রতিটি গল্পে: জাদুকরী ভূমিকা → জীবন্ত ঘটনার বর্ণনা → চরিত্রের আবেগ → গভীর উপসংহার
- ৩০০ থেকে ৫০০ শব্দের মধ্যে
- কোনো markdown, asterisk, বা বিশেষ চিহ্ন ছাড়া — শুধু সাধারণ গদ্য
- শোনার জন্য উপযুক্ত — প্রতিটি বাক্য যেন কানে সুর হয়ে বাজে`;

// POST /api/story
router.post('/', async (req, res) => {
  const { topic } = req.body;

  if (!topic || typeof topic !== 'string' || !topic.trim()) {
    return res.status(400).json({ error: 'Topic is required' });
  }

  const trimmedTopic = topic.trim();

  // Fallback when no API key
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.json({
      story: `আপনি "${trimmedTopic}" সম্পর্কে জানতে চেয়েছেন। গল্পটি শুনতে, অনুগ্রহ করে সার্ভারে AI_API_KEY পরিবেশ চলক সেট করুন। পলাশীর যুদ্ধ, মোগল সাম্রাজ্য, রবীন্দ্রনাথ — যেকোনো বিষয়ে আমাকে জিজ্ঞেস করুন, আমি বাংলায় গল্প শুনিয়ে দেব।`,
    });
  }

  // Try each Groq model
  for (const model of GROQ_MODELS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);

    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0.92,
          top_p: 0.95,
          max_tokens: 1200,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user',   content: `এই বিষয়ে বাংলায় একটি গল্প বলো: ${trimmedTopic}` },
          ],
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        console.warn(`[story] model ${model} HTTP ${response.status}: ${errText.slice(0, 120)}`);
        continue;
      }

      const data = await response.json();
      const story = data.choices?.[0]?.message?.content?.trim();

      if (!story) {
        console.warn(`[story] model ${model} returned empty content`);
        continue;
      }

      console.log(`[story] success with Groq ${model}`);
      return res.json({ story });
    } catch (err) {
      clearTimeout(timer);
      console.warn(`[story] Groq ${model} error:`, err.message);
    }
  }

  // ── Try SambaNova models ──
  const sambaKey = process.env.SAMBANOVA_API_KEY;
  if (sambaKey) {
    for (const model of SAMBANOVA_MODELS) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 45000);

      try {
        const response = await fetch('https://api.sambanova.ai/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${sambaKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            temperature: 0.92,
            top_p: 0.95,
            max_tokens: 1200,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user',   content: `এই বিষয়ে বাংলায় একটি গল্প বলো: ${trimmedTopic}` },
            ],
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          console.warn(`[story] SambaNova ${model} HTTP ${response.status}: ${errText.slice(0, 120)}`);
          continue;
        }

        const data = await response.json();
        const story = data.choices?.[0]?.message?.content?.trim();

        if (!story) {
          console.warn(`[story] SambaNova ${model} returned empty content`);
          continue;
        }

        console.log(`[story] success with SambaNova ${model}`);
        return res.json({ story });
      } catch (err) {
        clearTimeout(timer);
        console.warn(`[story] SambaNova ${model} error:`, err.message);
      }
    }
  }

  // All providers failed
  return res.status(500).json({
    error: 'গল্প তৈরিতে সমস্যা হয়েছে',
    story: 'দুঃখিত, এই মুহূর্তে গল্পটি তৈরি করা সম্ভব হচ্ছে না। একটু পরে আবার চেষ্টা করুন।',
  });
});

export default router;
