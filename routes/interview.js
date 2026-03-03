import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import { sessionQueries, conversationQueries, evaluationQueries } from '../database/db.js';
import { generateInterviewResponse, generateEvaluation } from '../services/aiEngine.js';
import { parseCV } from '../services/cvParser.js';
import {
    aiLimiter,
    sanitizeInput,
    protectPromptInjection,
    validateInterviewType,
    validateLanguage
} from '../middleware/security.js';

const router = express.Router();

// Configure multer for CV uploads
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['application/pdf', 'text/plain'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only PDF and TXT files are allowed'));
        }
    }
});

// POST /api/interview/start - Initialize new interview session
router.post('/start',
    sanitizeInput,
    validateInterviewType,
    validateLanguage,
    // upload.single('cv'), // Removed if you are sending cvText as a string
    async (req, res) => {
        try {
            // Destructure the new fields from your frontend request
            const { 
                interviewType, 
                language, 
                cvText, 
                jobDescription 
            } = req.body;

            const sessionId = uuidv4();

            // 1. Logic for CV data: Use cvText from body or parse file if still using both
            let cvData = cvText || null;
            let cvFilename = "Uploaded_Text_CV";

            if (req.file) {
                const parsedCV = await parseCV(req.file);
                if (parsedCV.success) {
                    cvData = parsedCV.rawText;
                    cvFilename = parsedCV.filename;
                }
            }

            // 2. Create session with the Job Description included
            // Note: Ensure your sessionQueries.create supports a jobDescription column
            sessionQueries.create(
                sessionId,
                interviewType || 'General',
                language || 'English',
                cvData,
                cvFilename,
                jobDescription || '' // Added job description context
            );

            // 3. Get session for AI context
            const session = sessionQueries.getById(sessionId);

            // 4. Generate response
            // The AI will now see the CV (Ranjan Mondal, .NET dev) and the JD (.net, c#, azure)
            const greeting = await generateInterviewResponse(session, [], null);

            if (!greeting.success) {
                return res.status(500).json({
                    success: false,
                    error: 'Failed to initialize interview'
                });
            }

            // 5. Save and Return
            conversationQueries.add(sessionId, 'interviewer', greeting.response, 1);
            sessionQueries.incrementQuestionCount(sessionId);

            res.json({
                success: true,
                sessionId,
                message: greeting.response,
                interviewType,
                language,
                cvUploaded: !!cvData
            });

        } catch (error) {
            console.error('Start interview error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);
// POST /api/interview/submit-answer - Submit answer and get next question
router.post('/submit-answer',
    aiLimiter,
    sanitizeInput,
    protectPromptInjection,
    async (req, res) => {
        try {
            const { sessionId, answer } = req.body;

            if (!sessionId || !answer) {
                return res.status(400).json({
                    success: false,
                    error: 'Session ID and answer are required'
                });
            }

            const session = sessionQueries.getById(sessionId);
            if (!session) {
                return res.status(404).json({
                    success: false,
                    error: 'Interview session not found'
                });
            }

            if (session.status !== 'in_progress') {
                return res.status(400).json({
                    success: false,
                    error: 'Interview has already ended'
                });
            }

            // Save candidate's answer
            const questionNum = session.question_count;
            conversationQueries.add(sessionId, 'candidate', answer, questionNum);

            // Get conversation history
            const history = conversationQueries.getBySession(sessionId);

            // Check if we should end interview
            const maxQuestions = parseInt(process.env.MAX_QUESTIONS_PER_INTERVIEW) || 15;
            if (session.question_count >= maxQuestions) {
                return res.json({
                    success: true,
                    message: null,
                    shouldEnd: true
                });
            }

            // Generate next question
            const response = await generateInterviewResponse(session, history, answer);

            if (!response.success) {
                return res.status(500).json({
                    success: false,
                    error: 'Failed to generate response'
                });
            }

            // Save interviewer's response
            conversationQueries.add(sessionId, 'interviewer', response.response, session.question_count + 1);
            sessionQueries.incrementQuestionCount(sessionId);

            res.json({
                success: true,
                message: response.response,
                shouldEnd: false
            });

        } catch (error) {
            console.error('Submit answer error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);

// POST /api/interview/next-question - Get next question (manual request)
router.post('/next-question',
    aiLimiter,
    sanitizeInput,
    async (req, res) => {
        try {
            const { sessionId, answer } = req.body;

            if (!sessionId) {
                return res.status(400).json({
                    success: false,
                    error: 'Session ID is required'
                });
            }

            const session = sessionQueries.getById(sessionId);
            if (!session) {
                return res.status(404).json({
                    success: false,
                    error: 'Interview session not found'
                });
            }

            if (session.status !== 'in_progress') {
                return res.status(400).json({
                    success: false,
                    error: 'Interview has already ended'
                });
            }

            // If user sent an answer, save it first
            if (answer && answer.trim()) {
                const questionNum = session.question_count;
                conversationQueries.add(sessionId, 'candidate', answer.trim(), questionNum);
            }

            // Check if we should end interview
            const maxQuestions = parseInt(process.env.MAX_QUESTIONS_PER_INTERVIEW) || 15;
            if (session.question_count >= maxQuestions) {
                return res.json({
                    success: true,
                    message: null,
                    shouldEnd: true,
                    questionNumber: session.question_count
                });
            }

            // Get conversation history (includes the just-saved answer)
            const history = conversationQueries.getBySession(sessionId);

            // Generate next question with answer context for follow-up
            const response = await generateInterviewResponse(
                session,
                history,
                answer && answer.trim() ? answer.trim() : null
            );

            if (!response.success) {
                return res.status(500).json({
                    success: false,
                    error: 'Failed to generate question'
                });
            }

            conversationQueries.add(sessionId, 'interviewer', response.response, session.question_count + 1);
            sessionQueries.incrementQuestionCount(sessionId);

            res.json({
                success: true,
                message: response.response,
                shouldEnd: false,
                questionNumber: session.question_count + 1
            });

        } catch (error) {
            console.error('Next question error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);

// POST /api/interview/finish - End interview and generate evaluation
router.post('/finish',
    aiLimiter,
    async (req, res) => {
        try {
            const { sessionId } = req.body;

            const session = sessionQueries.getById(sessionId);
            if (!session) {
                return res.status(404).json({
                    success: false,
                    error: 'Interview session not found'
                });
            }

            // Update session status
            sessionQueries.updateStatus('completed', sessionId);

            // Get full conversation history
            const history = conversationQueries.getBySession(sessionId);

            // Generate evaluation
            const evalResult = await generateEvaluation(session, history);

            if (!evalResult.success) {
                return res.status(500).json({
                    success: false,
                    error: 'Failed to generate evaluation'
                });
            }

            const { evaluation } = evalResult;

            // Save evaluation to database
            evaluationQueries.create(
                sessionId,
                evaluation.overall_score,
                evaluation.communication_score,
                evaluation.technical_score,
                evaluation.confidence_score,
                JSON.stringify(evaluation.weak_areas),
                JSON.stringify(evaluation.improvement_plan),
                evaluation.detailed_feedback
            );

            res.json({
                success: true,
                sessionId,
                evaluation
            });

        } catch (error) {
            console.error('Finish interview error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);

// GET /api/interview/result/:sessionId - Get interview result
router.get('/result/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;

        const session = sessionQueries.getById(sessionId);
        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Interview session not found'
            });
        }

        const evaluation = evaluationQueries.getBySession(sessionId);
        const conversation = conversationQueries.getBySession(sessionId);

        if (!evaluation) {
            return res.status(404).json({
                success: false,
                error: 'Evaluation not found. Interview may still be in progress.'
            });
        }

        res.json({
            success: true,
            result: {
                sessionId,
                interviewType: session.interview_type,
                language: session.language,
                status: session.status,
                questionCount: session.question_count,
                startedAt: session.created_at,
                endedAt: session.ended_at,
                evaluation: {
                    overallScore: evaluation.overall_score,
                    communicationScore: evaluation.communication_score,
                    technicalScore: evaluation.technical_score,
                    confidenceScore: evaluation.confidence_score,
                    weakAreas: JSON.parse(evaluation.weak_areas || '[]'),
                    improvementPlan: JSON.parse(evaluation.improvement_plan || '{}'),
                    detailedFeedback: evaluation.detailed_feedback
                },
                conversation: conversation.map(c => ({
                    role: c.role,
                    content: c.content,
                    timestamp: c.timestamp
                }))
            }
        });

    } catch (error) {
        console.error('Get result error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

export default router;
