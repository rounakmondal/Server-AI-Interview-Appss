# AI Agent Service - Usage Examples

The `aiAgent.js` service provides reusable AI-powered features using the Groq API. All methods use the same AI agent (llama-3.3-70b-versatile).

## Available Methods

### 1. **streamChapterGuide(res, req, chapterId, userQuery)**
Streams chapter guidance via Server-Sent Events (SSE).

**Usage in Routes:**
```javascript
import { streamChapterGuide } from '../services/aiAgent.js';

router.post('/api/ai/chapter-guide', async (req, res) => {
    const { chapterId, userQuery } = req.body;
    
    if (!chapterId || !userQuery) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    await streamChapterGuide(res, req, chapterId, userQuery);
});
```

**Client Usage (JavaScript):**
```javascript
const eventSource = new EventSource('/api/ai/chapter-guide', {
    method: 'POST',
    body: JSON.stringify({
        chapterId: 3,
        userQuery: 'Explain Modern India concepts'
    })
});

let fullResponse = '';
eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.content) {
        fullResponse += data.content;
        console.log(fullResponse);
    }
    if (event.data === '[DONE]') {
        eventSource.close();
    }
};
```

---

### 2. **getChapterGuideFull(chapterId, userQuery)**
Returns complete chapter guidance as a single JSON response (non-streaming).

**Usage in Routes:**
```javascript
import { getChapterGuideFull } from '../services/aiAgent.js';

router.post('/api/ai/chapter-guide-full', async (req, res) => {
    const { chapterId, userQuery } = req.body;
    
    try {
        const answer = await getChapterGuideFull(chapterId, userQuery);
        res.json({
            success: true,
            answer,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        res.status(500).json({ 
            success: false, 
            error: err.message 
        });
    }
});
```

**Client Usage (Fetch API):**
```javascript
const response = await fetch('/api/ai/chapter-guide-full', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        chapterId: 3,
        userQuery: 'Complete overview of this chapter'
    })
});

const { answer } = await response.json();
console.log(answer);
```

---

### 3. **queryAI(systemPrompt, userQuery, options)**
Custom AI query with flexible system prompt.

**Parameters:**
- `systemPrompt`: Custom system instruction for the AI
- `userQuery`: User's question (auto-sanitized)
- `options`: `{ stream: boolean, maxTokens: number }`

**Usage in Routes:**
```javascript
import { queryAI } from '../services/aiAgent.js';

// Non-streaming example
router.post('/api/ask-tutor', async (req, res) => {
    const { topic, question } = req.body;
    
    try {
        const systemPrompt = `You are a tutor expert on ${topic}. 
Explain concepts clearly with examples.
Keep response under 300 words.`;
        
        const answer = await queryAI(systemPrompt, question, {
            stream: false,
            maxTokens: 1000
        });
        
        res.json({ success: true, answer });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Streaming example
router.post('/api/streaming-tutor', async (req, res) => {
    const { topic, question } = req.body;
    
    try {
        const systemPrompt = `You are a tutor expert on ${topic}.`;
        
        const groqRes = await queryAI(systemPrompt, question, {
            stream: true,
            maxTokens: 1500
        });
        
        // Now stream the response to client
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        // Forward Groq's stream to client
        const reader = groqRes.body.getReader();
        const decoder = new TextDecoder();
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value, { stream: true });
            res.write(chunk);
        }
        res.end();
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
```

---

### 4. **Utility Functions**

#### `sanitizeQuery(query)`
Sanitizes user input to prevent prompt injection.

```javascript
import { sanitizeQuery } from '../services/aiAgent.js';

const userInput = "Some query <script>alert('xss')</script>";
const safe = sanitizeQuery(userInput);
// Result: "Some query scriptalertxssscript" (max 500 chars, no <>)
```

#### `buildChapterSystemPrompt(chapter, subject, exam)`
Builds system prompt for chapter context.

```javascript
import { buildChapterSystemPrompt } from '../services/aiAgent.js';

const prompt = buildChapterSystemPrompt(
    { name: 'Modern India' },
    { name: 'History' },
    { name: 'WBCS' }
);
```

#### `getApiKey()`
Validates and returns the Groq API key.

```javascript
import { getApiKey } from '../services/aiAgent.js';

try {
    const apiKey = getApiKey();
    console.log('API key is configured');
} catch (err) {
    console.error('API key missing:', err.message);
}
```

---

## API Endpoints Created

### 1. **POST /api/ai/chapter-guide** (Streaming)
Returns real-time streaming responses via Server-Sent Events.

**Request:**
```json
{
  "chapterId": 3,
  "userQuery": "Explain the key concepts"
}
```

**Response Stream:**
```
data: {"content": "The"}
data: {"content": " Mughal"}
data: {"content": " Empire"}
data: [DONE]
```

---

### 2. **POST /api/ai/chapter-guide-full** (Non-streaming)
Returns complete response as JSON.

**Request:**
```json
{
  "chapterId": 3,
  "userQuery": "Full chapter overview"
}
```

**Response:**
```json
{
  "success": true,
  "answer": "## Modern India\n\n**Key Concepts**\n• Independence\n• Constitution..."
}
```

---

## Error Handling

All methods throw descriptive errors:

```javascript
try {
    const answer = await getChapterGuideFull(999, 'question');
} catch (err) {
    // Error: "Chapter Guide Error: Chapter not found"
    console.error(err.message);
}
```

---

## Environment Variables

Ensure `GROQ_API_KEY` is set in `.env`:

```env
GROQ_API_KEY=your_groq_api_key_here
```

---

## Performance Notes

- **Streaming**: Best for real-time user experience
- **Non-streaming**: Best for programmatic processing
- **Max tokens**: Default 1000, adjustable via options
- **Timeout**: 60 seconds per request
- **Rate limit**: Depends on Groq account tier

---

## Security

- ✅ Query sanitization (removes `<>` characters, caps at 500 chars)
- ✅ Timeout protection (60s max)
- ✅ Client disconnect handling
- ✅ API key validation
- ✅ Input validation
