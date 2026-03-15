import express from 'express';
import multer from 'multer';
import { generateStudyResponse } from '../services/studyBot.js';
import { aiLimiter, sanitizeInput } from '../middleware/security.js';

const router = express.Router();

// Configure multer for image uploads
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit for images
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only image files (JPEG, PNG, GIF, WebP) are allowed'));
        }
    }
});

// POST /api/study/chat - Handle study bot chat with optional image
router.post('/chat',
    aiLimiter,
    sanitizeInput,
    upload.single('image'),
    async (req, res) => {
        try {
            const { message, conversationHistory } = req.body;

            if (!message && !req.file) {
                return res.status(400).json({
                    success: false,
                    error: 'Either message text or image is required'
                });
            }

            // Parse conversation history if provided
            let history = [];
            if (conversationHistory) {
                try {
                    history = JSON.parse(conversationHistory);
                } catch (e) {
                    history = [];
                }
            }

            // Add current message to history
            if (message) {
                history.push({
                    role: 'user',
                    content: message
                });
            }

            // Handle image if uploaded
            let imageBase64 = null;
            if (req.file) {
                imageBase64 = req.file.buffer.toString('base64');
            }

            // Generate response
            const result = await generateStudyResponse(history, imageBase64);

            if (!result.success) {
                return res.status(500).json({
                    success: false,
                    error: 'Failed to generate response'
                });
            }

            // Add AI response to history
            history.push({
                role: 'assistant',
                content: result.response
            });

            res.json({
                success: true,
                response: result.response,
                conversationHistory: history
            });

        } catch (error) {
            console.error('Study chat error:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error'
            });
        }
    }
);

export default router;