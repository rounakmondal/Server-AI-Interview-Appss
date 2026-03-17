import { Router } from 'express';
import {
    examQueries,
    subjectQueries,
    chapterQueries,
    topicQueries,
    preferenceQueries,
} from '../database/examDb.js';

const router = Router();

// ─── Exam & Syllabus ──────────────────────────────────────────────────────────

// GET /api/exams
router.get('/exams', (_req, res) => {
    try {
        const exams = examQueries.listAll();
        res.json({ success: true, data: exams });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/exams/:examId/subjects
router.get('/exams/:examId/subjects', (req, res) => {
    try {
        const examId = parseInt(req.params.examId, 10);
        if (isNaN(examId) || examId < 1) {
            return res.status(400).json({ success: false, error: 'Invalid examId' });
        }
        const exam = examQueries.getById(examId);
        if (!exam) return res.status(404).json({ success: false, error: 'Exam not found' });

        const subjects = subjectQueries.byExam(examId);
        res.json({ success: true, exam, data: subjects });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/subjects/:subjectId/chapters
router.get('/subjects/:subjectId/chapters', (req, res) => {
    try {
        const subjectId = parseInt(req.params.subjectId, 10);
        if (isNaN(subjectId) || subjectId < 1) {
            return res.status(400).json({ success: false, error: 'Invalid subjectId' });
        }
        const subject = subjectQueries.getById(subjectId);
        if (!subject) return res.status(404).json({ success: false, error: 'Subject not found' });

        const chapters = chapterQueries.bySubject(subjectId);
        res.json({ success: true, subject, data: chapters });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/chapters/:chapterId/topics
router.get('/chapters/:chapterId/topics', (req, res) => {
    try {
        const chapterId = parseInt(req.params.chapterId, 10);
        if (isNaN(chapterId) || chapterId < 1) {
            return res.status(400).json({ success: false, error: 'Invalid chapterId' });
        }
        const chapter = chapterQueries.getById(chapterId);
        if (!chapter) return res.status(404).json({ success: false, error: 'Chapter not found' });

        const topics = topicQueries.byChapter(chapterId);
        res.json({ success: true, chapter, data: topics });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── User Exam Preference ─────────────────────────────────────────────────────

// POST /api/user/exam-preference
router.post('/user/exam-preference', (req, res) => {
    try {
        const { userId, examId, examDate } = req.body;

        if (!userId || !examId) {
            return res.status(400).json({ success: false, error: 'userId and examId are required' });
        }
        const eid = parseInt(examId, 10);
        if (isNaN(eid) || eid < 1) {
            return res.status(400).json({ success: false, error: 'Invalid examId' });
        }
        if (examDate && !/^\d{4}-\d{2}-\d{2}$/.test(examDate)) {
            return res.status(400).json({ success: false, error: 'examDate must be YYYY-MM-DD' });
        }
        const exam = examQueries.getById(eid);
        if (!exam) return res.status(404).json({ success: false, error: 'Exam not found' });

        preferenceQueries.upsert(String(userId), eid, examDate || null);
        res.json({ success: true, message: 'Exam preference saved' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/user/:userId/preference
router.get('/user/:userId/preference', (req, res) => {
    try {
        const { userId } = req.params;
        if (!userId || !userId.trim()) {
            return res.status(400).json({ success: false, error: 'Invalid userId' });
        }
        const prefs = preferenceQueries.byUser(String(userId));
        res.json({ success: true, data: prefs });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

export default router;
