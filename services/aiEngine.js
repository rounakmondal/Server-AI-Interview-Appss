import { buildInterviewPrompt, buildCrossQuestionPrompt, EVALUATION_PROMPT } from '../prompts/interviewer.js';

// Initialize Groq API client
async function getGroqChatCompletion(messages, maxTokens = 500) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        throw new Error('GROQ_API_KEY not found in .env');
    }
    
    // Try multiple models in order of preference (only currently active production models)
    const models = [
        process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        'openai/gpt-oss-120b',
        'openai/gpt-oss-20b',
        'llama-3.1-8b-instant'
    ];
    
    let lastError = null;
    
    for (const model of models) {
        console.log(`Trying Groq model: ${model}`);

        // Add timeout using AbortController
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

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
                continue; // Try next model
            }

            const data = await response.json();
            
            // Log token usage (compact)
            console.log(`Model ${model} - tokens: ${data.usage?.total_tokens || '?'}, finish: ${data.choices?.[0]?.finish_reason || '?'}`);
            
            if (!data.choices || !data.choices[0] || !data.choices[0].message) {
                console.warn(`Model ${model} invalid response structure`);
                lastError = new Error('Invalid API response structure: ' + JSON.stringify(data));
                continue; // Try next model
            }
            
            const content = data.choices[0].message.content;
            const finishReason = data.choices[0].finish_reason;
            
            // Check if content is null or empty
            if (content === null || content === undefined || content.trim() === '') {
                console.warn(`Model ${model} returned empty content. Finish reason: ${finishReason}`);
                lastError = new Error(`API returned empty content. Finish reason: ${finishReason || 'unknown'}`);
                continue; // Try next model
            }
            
            console.log(`Success with model: ${model}`);
            return content.trim();
            
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                lastError = new Error('API request timed out after 30 seconds');
            } else {
                lastError = error;
            }
            console.warn(`Model ${model} failed:`, lastError.message);
            continue; // Try next model
        }
    }
    
    // All models failed
    throw lastError || new Error('All models failed');
}

// Analyze if answer needs follow-up
function analyzeAnswerQuality(answer) {
    const wordCount = answer.split(/\s+/).length;
    const hasUncertainty = /i think|maybe|not sure|i guess|probably/i.test(answer);
    const isTooShort = wordCount < 15;
    const isVague = /something like|kind of|sort of|somehow/i.test(answer);

    return {
        needsFollowUp: isTooShort || hasUncertainty || isVague,
        reason: isTooShort ? 'short' : hasUncertainty ? 'uncertain' : isVague ? 'vague' : 'ok'
    };
}

// Determine interview phase based on question number
// Phase 1 (Q1-Q5): Introduction & Background - 33%
// Phase 2 (Q6-Q10): CV/Skills based technical questions - 33%
// Phase 3 (Q11-Q15): Behavioral & Situational questions - 33%
function getInterviewPhase(questionNumber, maxQuestions = 15) {
    const phaseSize = Math.ceil(maxQuestions / 3);
    if (questionNumber <= phaseSize) return 'introduction';
    if (questionNumber <= phaseSize * 2) return 'cv_technical';
    return 'behavioral';
}

// Generate interview question or response
export async function generateInterviewResponse(session, conversationHistory, userAnswer = null) {
    const isGreeting = conversationHistory.length === 0;
    
    // Calculate question number
    const interviewerMessages = conversationHistory.filter(m => m.role === 'interviewer').length;
    const questionNumber = interviewerMessages + 1;
    
    // Determine current phase
    const maxQuestions = parseInt(process.env.MAX_QUESTIONS_PER_INTERVIEW) || 15;
    const phase = getInterviewPhase(questionNumber, maxQuestions);
    
    console.log(`Question #${questionNumber}, Phase: ${phase}`);

    // Build a SIMPLE system prompt to avoid empty responses
    let systemPrompt = `You are Priya, a professional interviewer. Conduct the interview in ${session.language || 'English'}.`;
    
    // Add CV context if available (shortened)
    if (session.cv_data) {
        const cvSummary = session.cv_data.substring(0, 1500); // Limit CV size
        systemPrompt += `\n\nCandidate CV (summary):\n${cvSummary}`;
    }
    
    // Add JD context if available (shortened)
    if (session.job_description) {
        const jdSummary = session.job_description.substring(0, 1000);
        systemPrompt += `\n\nJob Description:\n${jdSummary}`;
    }
    
    // Phase-specific instructions
    if (questionNumber === 1) {
        systemPrompt += `\n\nThis is the START of the interview. Greet the candidate warmly. Introduce yourself as Priya. Do NOT ask any question yet.`;
    } else if (questionNumber === 2) {
        systemPrompt += `\n\nAsk the candidate: "Tell me about yourself - your background, experience, and what brings you here today?"`;
    } else if (phase === 'introduction') {
        systemPrompt += `\n\nAsk a question about the candidate's background, education, or career goals. Keep it conversational.`;
    } else if (phase === 'cv_technical') {
        systemPrompt += `\n\nAsk a TECHNICAL question based on skills in their CV or job description. Be specific.`;
    } else {
        systemPrompt += `\n\nAsk a BEHAVIORAL question (teamwork, challenges, leadership). Use "Tell me about a time when..." format.`;
    }

    // Follow-up logic: analyze the candidate's answer and decide behavior
    if (userAnswer) {
        const answerAnalysis = analyzeAnswerQuality(userAnswer);
        
        if (answerAnalysis.needsFollowUp) {
            // Follow up on weak/vague/short answers like a real interviewer
            if (answerAnalysis.reason === 'short') {
                systemPrompt += `\n\nThe candidate gave a very SHORT answer. Like a real interviewer, probe deeper. Ask them to elaborate or give a specific example. Do NOT move to a new topic yet.`;
            } else if (answerAnalysis.reason === 'uncertain') {
                systemPrompt += `\n\nThe candidate sounded UNCERTAIN (used words like "I think", "maybe"). Gently ask them to clarify or confirm their answer with a concrete example. Stay on the same topic.`;
            } else if (answerAnalysis.reason === 'vague') {
                systemPrompt += `\n\nThe candidate gave a VAGUE answer. Ask a focused follow-up to get specifics - a real scenario, numbers, or a concrete example. Stay on the same topic.`;
            }
        } else {
            // Good answer - acknowledge and naturally transition
            systemPrompt += `\n\nThe candidate gave a solid answer. Briefly acknowledge what was good about it (be specific, reference something they said), then smoothly transition to your next question.`;
        }
    }
    
    systemPrompt += `\n\nRules:
- Ask ONE question only.
- Be professional but warm, like a real human interviewer.
- React naturally to what the candidate says (agree, show interest, comment).
- Do NOT repeat questions already asked in the conversation.
- Keep response under 120 words.`;

    const messages = [
        { role: 'system', content: systemPrompt }
    ];

    // Build a rolling conversation window (last 6 messages) for natural context
    // This lets the AI see recent exchanges and avoid repeating questions
    if (conversationHistory.length > 0) {
        const recentHistory = conversationHistory.slice(-6); // last 3 exchanges (Q&A pairs)
        
        for (const msg of recentHistory) {
            messages.push({
                role: msg.role === 'interviewer' ? 'assistant' : 'user',
                content: msg.content
            });
        }
    }
    
    // Add current answer if provided (and not already in history)
    if (userAnswer && conversationHistory.length > 0) {
        const lastMsg = conversationHistory[conversationHistory.length - 1];
        // Only add if the answer isn't already the last message in history
        if (lastMsg.role !== 'candidate' || lastMsg.content !== userAnswer) {
            messages.push({ role: 'user', content: userAnswer });
        }
    } else if (userAnswer) {
        messages.push({ role: 'user', content: userAnswer });
    }

    // Log prompt size for debugging
    console.log(`System prompt size: ${systemPrompt.length} chars, Messages: ${messages.length}`);

    try {
        console.log('Sending request to API, question number:', questionNumber);
        
        // Retry up to 5 times with increasing delay - TRY HARD to get API response
        let response = null;
        let lastError = null;
        
        for (let attempt = 1; attempt <= 5; attempt++) {
            try {
                console.log(`API attempt ${attempt}/5...`);
                response = await getGroqChatCompletion(messages, 300);
                if (response && response.trim() !== '') {
                    console.log(`API success on attempt ${attempt}`);
                    break; // Success, exit retry loop
                }
                console.warn(`Attempt ${attempt}: Empty response from API`);
                lastError = new Error('Empty response from API');
            } catch (err) {
                lastError = err;
                console.warn(`Attempt ${attempt} failed: ${err.message}`);
                
                // Check for rate limiting
                if (err.message.includes('rate') || err.message.includes('429')) {
                    console.log('Rate limited, waiting longer...');
                    await new Promise(resolve => setTimeout(resolve, 3000 * attempt));
                }
            }
            
            // Wait before retrying (1s, 2s, 3s, 4s)
            if (attempt < 5) {
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }

        // If all retries failed, return error - NO STATIC FALLBACKS
        if (!response || response.trim() === '') {
            console.error('All 5 API attempts failed');
            console.error('Last error:', lastError?.message);
            
            return {
                success: false,
                error: 'AI service temporarily unavailable. Please try again.',
                retryable: true
            };
        }

        return {
            success: true,
            response: response
        };
    } catch (error) {
        console.error('Groq API Error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Generate cross-question based on weak answer
export async function generateCrossQuestion(session, previousAnswer, topic) {
    const prompt = buildCrossQuestionPrompt(previousAnswer, topic);

    try {
        const response = await getGroqChatCompletion([
            { role: 'system', content: prompt },
            { role: 'user', content: previousAnswer }
        ]);

        return {
            success: true,
            response: response
        };
    } catch (error) {
        console.error('Groq API Error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Generate final evaluation with practice questions
export async function generateEvaluation(session, conversationHistory) {
    const conversationText = conversationHistory.map(msg =>
        `${msg.role === 'interviewer' ? 'Interviewer' : 'Candidate'}: ${msg.content}`
    ).join('\n\n');

    // Enhanced evaluation prompt to include YouTube video suggestions
    const simpleEvalPrompt = `You are an interview evaluator. Analyze the interview transcript and respond ONLY with valid JSON (no markdown, no backticks).

JSON format:
{
    "overall_score": <number 0-10>,
    "communication_score": <number 0-10>,
    "technical_score": <number 0-10>,
    "confidence_score": <number 0-10>,
    "weak_areas": [
        {"area": "string", "issue": "string", "how_to_improve": "string"}
    ],
    "improvement_plan": {
        "immediate_actions": ["action1", "action2", "action3"],
        "resources_to_study": ["resource1", "resource2"],
        "practice_strategy": "string"
    },
    "detailed_feedback": "string with comprehensive feedback",
    "practice_questions": [
        {"category": "Technical/Behavioral", "question": "string", "difficulty": "Easy/Medium/Hard", "topic": "string"}
    ],
    "suggested_videos": [
        {"title": "string", "url": "https://youtube.com/...", "reason": "string (why this video is helpful)"}
    ]
}

For each weak area or as part of the improvement plan, suggest 2-3 relevant YouTube video URLs (with title and a short reason) that would help the candidate improve. Only include real YouTube links. Generate 10 practice questions targeting weak areas. Be honest but constructive.`;

    const evaluationContext = `Interview Type: ${session.interview_type}
Language: ${session.language}
${session.cv_data ? `CV Summary: ${session.cv_data.substring(0, 1000)}` : 'CV: Not provided'}
${session.job_description ? `Job Description: ${session.job_description.substring(0, 800)}` : 'JD: Not provided'}

INTERVIEW TRANSCRIPT:
${conversationText}`;

    try {
        console.log('Generating evaluation...');
        
        // Use the shared getGroqChatCompletion with model fallback
        const messages = [
            { role: 'system', content: simpleEvalPrompt },
            { role: 'user', content: evaluationContext }
        ];
        
        let responseText = null;
        
        // Try up to 3 times
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                console.log(`Evaluation attempt ${attempt}/3...`);
                responseText = await getGroqChatCompletion(messages, 3000);
                if (responseText && responseText.trim() !== '') {
                    console.log(`Evaluation success on attempt ${attempt}`);
                    break;
                }
                console.warn(`Evaluation attempt ${attempt}: Empty response`);
                responseText = null;
            } catch (err) {
                console.warn(`Evaluation attempt ${attempt} failed:`, err.message);
                if (attempt < 3) {
                    await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
                }
            }
        }
        
        // If all attempts failed, return a basic evaluation
        if (!responseText || responseText.trim() === '') {
            console.error('All evaluation attempts failed, returning basic evaluation');
            return {
                success: true,
                evaluation: {
                    overall_score: 5,
                    communication_score: 5,
                    technical_score: 5,
                    confidence_score: 5,
                    weak_areas: [{ area: "Evaluation unavailable", issue: "AI service was temporarily unavailable", how_to_improve: "Please try finishing the interview again" }],
                    improvement_plan: { immediate_actions: ["Review your answers", "Practice common questions"], resources_to_study: [], practice_strategy: "Practice regularly" },
                    detailed_feedback: "The AI evaluation service was temporarily unavailable. Your interview has been recorded. Please try generating the evaluation again.",
                    practice_questions: []
                }
            };
        }

        // Parse JSON from response
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        let evaluation = null;
        if (jsonMatch) {
            try {
                evaluation = JSON.parse(jsonMatch[0]);
            } catch (parseError) {
                console.error('JSON parse error:', parseError);
                evaluation = {
                    overall_score: 5,
                    communication_score: 5,
                    technical_score: 5,
                    confidence_score: 5,
                    weak_areas: [],
                    improvement_plan: {},
                    detailed_feedback: responseText,
                    practice_questions: []
                };
            }
        } else {
            evaluation = {
                overall_score: 5,
                communication_score: 5,
                technical_score: 5,
                confidence_score: 5,
                weak_areas: [],
                improvement_plan: {},
                detailed_feedback: responseText,
                practice_questions: []
            };
        }

        // YouTube search for each weak area
        evaluation.suggested_videos = [];
        try {
            const { searchYouTubeVideos } = await import('./youtubeSearch.js');
            if (evaluation.weak_areas && Array.isArray(evaluation.weak_areas)) {
                for (const weak of evaluation.weak_areas) {
                    const query = weak.area + ' ' + (weak.how_to_improve || 'interview tips');
                    const videos = await searchYouTubeVideos(query, 2);
                    evaluation.suggested_videos.push(...videos);
                }
            }
        } catch (ytError) {
            console.error('YouTube search error:', ytError);
        }

        return {
            success: true,
            evaluation: evaluation
        };
    } catch (error) {
        console.error('Groq Evaluation Error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}