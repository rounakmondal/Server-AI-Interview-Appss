
// Fallback to Groq for text-only if OpenAI not available
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
        console.log(`Trying Groq model: ${model}`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        try {
            const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    messages: messages,
                    model: model,
                    temperature: 0.7,
                    max_tokens: maxTokens,
                    top_p: 0.9
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const error = await response.json();
                console.warn(`Model ${model} API error:`, error.error?.message || response.statusText);
                lastError = new Error(`Groq API error: ${error.error?.message || response.statusText}`);
                continue;
            }

            const data = await response.json();

            if (!data.choices || !data.choices[0] || !data.choices[0].message) {
                console.warn(`Model ${model} invalid response structure`);
                lastError = new Error('Invalid API response structure');
                continue;
            }

            const content = data.choices[0].message.content;

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
            console.warn(`Model ${model} failed:`, lastError.message);
            continue;
        }
    }

    throw lastError || new Error('All models failed');
}

// Generate study bot response
export async function generateStudyResponse(messages, imageBase64 = null) {
    try {
        // If there's an image, use OpenAI Vision
        if (imageBase64) {
            if (!process.env.OPENAI_API_KEY) {
                throw new Error('OPENAI_API_KEY required for image processing');
            }

            const visionMessages = [
                {
                    role: 'system',
                    content: 'You are a helpful study assistant. Help students with their questions, explain concepts clearly, and provide educational support. When shown images, analyze them and provide relevant educational insights.'
                },
                ...messages.map(msg => ({
                    role: msg.role,
                    content: msg.content
                })),
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: messages[messages.length - 1]?.content || 'Please analyze this image for study purposes.'
                        },
                        {
                            type: 'image_url',
                            image_url: {
                                url: `data:image/jpeg;base64,${imageBase64}`
                            }
                        }
                    ]
                }
            ];

            const response = await openai.chat.completions.create({
                model: 'gpt-4o',
                messages: visionMessages,
                max_tokens: 1000,
                temperature: 0.7
            });

            return {
                success: true,
                response: response.choices[0].message.content.trim()
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