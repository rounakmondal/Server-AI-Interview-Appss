import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import { initializeDatabase } from './database/db.js';
import { connectMongo } from './database/mongo.js';
import { seedExamData } from './database/examDb.js';
import interviewRoutes from './routes/interview.js';
import govtRoutes from './routes/govt.js';
import studyRoutes from './routes/study.js';

import authRoutes from './routes/auth.js';

import { handleContact } from './routes/contact.js';
import { handleExtractPdf } from './routes/extractPdf.js';
import { apiLimiter } from './middleware/security.js';
import examSyllabusRoutes  from './routes/examSyllabus.js';
import examProgressRoutes  from './routes/examProgress.js';
import examTestRoutes      from './routes/examTest.js';
import examStudyPlanRoutes from './routes/examStudyPlan.js';
import examAiRoutes        from './routes/examAi.js';
import syllabusApiRoutes   from './routes/syllabusApi.js';
import questionsRoutes    from './routes/questions.js';
import amarPlanRoutes     from './routes/amarPlan.js';
import companyInterviewRoutes from './routes/companyInterview.js';
import skillMatrixRoutes from './routes/skillMatrix.js';
import storyRoutes from './routes/story.js';
import examSyllabusSearchRoutes from './routes/examSyllabusSearch.js';
import examCalendarRoutes from './routes/examCalendar.js';
import virtualExamRoutes, { initVirtualExamDB } from './routes/virtualExam.js';
import { sendTestResultEmail } from './routes/testResultEmail.js';
import { handleTriggerDailyPost } from './routes/handleTriggerDailyPost.js';

// Load environment variables
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT =8000;

// Trust proxy (nginx/load balancer in production)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS configuration
const ALLOWED_ORIGINS = [
    'http://localhost:5000',
    'http://localhost:5001',
    'http://localhost:5002',
    'http://127.0.0.1:5000',
    'http://127.0.0.1:5001',
    'http://127.0.0.1:5002',
    'http://localhost:8080',
    'https://medhahub.in',
    'https://medhahub.in'
];
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (curl, server-to-server, mobile apps)
        if (!origin || ALLOWED_ORIGINS.includes(origin)) {
            callback(null, true);
        } else {
            callback(null, true); // still permissive fallback — change to callback(new Error('CORS')) to hard-block
        }
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization']
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Apply rate limiting to all routes
app.use(apiLimiter);

// Serve public/ as static files (for direct access to manifest.json, PDFs, etc.)
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// Interview routes
app.use('/api/interview', interviewRoutes);

// Govt exam routes
app.use('/api/govt', govtRoutes);

// Study bot routes
app.use('/api/study', studyRoutes);


// Auth routes
app.use('/api/auth', authRoutes);
 app.get("/api/trigger-daily-post", handleTriggerDailyPost);


// Contact route
    app.post('/api/contact', handleContact);
  app.post("/api/extract-pdf", handleExtractPdf);

// Test Result Email route
app.post('/api/test-result-email', sendTestResultEmail);

// ── Exam Prep routes ──────────────────────────────────────────────────────────
app.use('/api', examSyllabusRoutes);   // GET /api/exams, /api/exams/:id/subjects, etc.
app.use('/api', examProgressRoutes);   // GET /api/progress/:userId/:examId
app.use('/api', examTestRoutes);       // GET /api/test/:chapterId/questions, POST /api/test/submit
app.use('/api', examStudyPlanRoutes);  // GET|POST /api/studyplan/...
app.use('/api', examAiRoutes);         // POST /api/ai/chapter-guide
app.use('/api', syllabusApiRoutes);    // NEW: GET /api/syllabus/:examId, POST /api/studyplan/ai, etc.

// Question Hub routes (file listing + file serving)
app.use('/api/questions', questionsRoutes);

// Amar Plan routes
app.use('/api', amarPlanRoutes);              // POST /api/plan/create, GET /api/plan/:user_id, etc.

// Company Interview Questions (AI-generated)
app.use('/api/company-interviews', companyInterviewRoutes);  // GET /api/company-interviews/:slug

// Skill Matrix routes
app.use('/api/skill-matrix', skillMatrixRoutes);  // GET|POST /api/skill-matrix, GET /api/skill-matrix/practice/:skillId

// Story telling (Bengali narratives)
app.use('/api/story', storyRoutes);  // POST /api/story

// Exam Syllabus Search (AI-powered)
app.use('/api', examSyllabusSearchRoutes);  // GET /api/exam-syllabus?q=...

// Exam Calendar (static 2026 dates)
app.use('/api', examCalendarRoutes);  // GET /api/exam-calendar

// Virtual Exam Room (Online Testing Platform)
app.use('/api/virtual-exam', virtualExamRoutes);  // POST /api/virtual-exam/questions, /submit, etc.

// Error handling middleware
app.use((err, req, res, next) => {
    // Client disconnected before body was fully received — nothing to respond to
    if (err.code === 'ECONNABORTED' || err.type === 'request.aborted') {
        return;
    }
    console.error('Server error:', err);
    if (res.headersSent) return;
    res.status(err.status || 500).json({
        success: false,
        error: process.env.NODE_ENV === 'production'
            ? 'Internal server error'
            : err.message
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found'
    });
});

// Initialize database and start server
async function startServer() {
    try {
        // Initialize databases
        await initializeDatabase();
        
        let mongoDb = null;
        try {
            mongoDb = await connectMongo();
            // Initialize Virtual Exam Database collections and indexes
            if (mongoDb) {
                await initVirtualExamDB(mongoDb);
            }
        } catch (mongoErr) {
            const msg = mongoErr.message.split('\n')[0];
            if (msg.includes('MONGO_URI not set') || msg.includes('MONGO_URI is invalid')) {
                console.warn('⚠️  MongoDB configuration error (auth features disabled):', msg);
                console.warn('   → Set MONGO_URI in environment variables before starting the server.');
            } else {
                console.warn('⚠️  MongoDB unavailable (auth features disabled):', msg);
                console.warn('   → Whitelist your IP at cloud.mongodb.com → Network Access to restore auth.');
            }
        }

        // Seed exam prep data (no-op if already seeded)-->>>  9220446597
        seedExamData();

        app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔══════════════════════════════════════════════════════════╗
║         🎤 AI Mock Interview Server Started 🎤           ║
╠══════════════════════════════════════════════════════════╣
║  Server running at: http://localhost:${PORT}             ║
║  Environment: ${process.env.NODE_ENV || 'development'}   ║
║  API Health: http://localhost:${PORT}/api/health         ║
╚══════════════════════════════════════════════════════════╝
    `);
})
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
