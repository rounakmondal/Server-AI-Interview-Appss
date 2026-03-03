import rateLimit from 'express-rate-limit';

// Rate limiter for API endpoints
export const apiLimiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    message: {
        success: false,
        error: 'Too many requests. Please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Stricter rate limiter for AI endpoints (more expensive)
export const aiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 20, // 20 requests per minute
    message: {
        success: false,
        error: 'AI request limit reached. Please wait a moment.'
    }
});

// Input sanitization middleware
export function sanitizeInput(req, res, next) {
    if (req.body) {
        for (const key in req.body) {
            if (typeof req.body[key] === 'string') {
                // Remove potential script injections
                req.body[key] = req.body[key]
                    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                    .replace(/<[^>]*>/g, '')
                    .trim();
            }
        }
    }
    next();
}

// Prompt injection protection
export function protectPromptInjection(req, res, next) {
    const dangerousPatterns = [
        /ignore\s+(all\s+)?previous\s+instructions/i,
        /forget\s+(all\s+)?your\s+instructions/i,
        /you\s+are\s+now\s+a/i,
        /new\s+persona/i,
        /act\s+as\s+(if\s+you\s+(are|were)\s+)?a/i,
        /pretend\s+(to\s+be|you('re|\s+are))/i,
        /system\s*:\s*/i,
        /\[INST\]/i,
        /<<SYS>>/i
    ];

    const checkValue = (value) => {
        if (typeof value === 'string') {
            for (const pattern of dangerousPatterns) {
                if (pattern.test(value)) {
                    return true;
                }
            }
        }
        return false;
    };

    // Check all string values in request body
    if (req.body) {
        for (const key in req.body) {
            if (checkValue(req.body[key])) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid input detected'
                });
            }
        }
    }

    next();
}

// Session timeout middleware
export function checkSessionTimeout(sessionQueries) {
    return (req, res, next) => {
        const sessionId = req.params.sessionId || req.body.sessionId;

        if (sessionId) {
            const session = sessionQueries.getById(sessionId);

            if (session) {
                const createdAt = new Date(session.created_at);
                const now = new Date();
                const timeoutMinutes = parseInt(process.env.SESSION_TIMEOUT_MINUTES) || 60;
                const diffMinutes = (now - createdAt) / (1000 * 60);

                if (diffMinutes > timeoutMinutes) {
                    return res.status(400).json({
                        success: false,
                        error: 'Interview session has expired'
                    });
                }
            }
        }

        next();
    };
}

// Validate interview type - disabled, accepting any type
export function validateInterviewType(req, res, next) {
    next();
}

// Validate language
export function validateLanguage(req, res, next) {
    const validLanguages = ['english', 'hindi', 'bengali'];
    const language = req.body.language;

    if (language && !validLanguages.includes(language.toLowerCase())) {
        return res.status(400).json({
            success: false,
            error: 'Invalid language. Must be one of: English, Hindi, Bengali'
        });
    }

    next();
}
