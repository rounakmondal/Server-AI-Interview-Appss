import { Router } from 'express';
import { examQueries, progressQueries } from '../database/examDb.js';

const router = Router();

// GET /api/progress/:userId/:examId
// Full tree: subjects → chapters, each annotated with user progress status
router.get('/progress/:userId/:examId', (req, res) => {
    try {
        const { userId } = req.params;
        const examId = parseInt(req.params.examId, 10);

        if (isNaN(examId) || examId < 1) {
            return res.status(400).json({ success: false, error: 'Invalid examId' });
        }
        const exam = examQueries.getById(examId);
        if (!exam) return res.status(404).json({ success: false, error: 'Exam not found' });

        const rows = progressQueries.fullTree(String(userId), examId);

        // Group flat rows into a subject → chapter tree
        const subjectMap = new Map();
        for (const r of rows) {
            if (!subjectMap.has(r.subject_id)) {
                subjectMap.set(r.subject_id, {
                    id:      r.subject_id,
                    name:    r.subject_name,
                    nameBn:  r.subject_name_bn,
                    chapters: [],
                });
            }
            subjectMap.get(r.subject_id).chapters.push({
                id:           r.chapter_id,
                name:         r.chapter_name,
                nameBn:       r.chapter_name_bn,
                passMark:     r.pass_mark,
                status:       r.status,
                lastScore:    r.last_score,
                attemptCount: Number(r.attempt_count) || 0,
                updatedAt:    r.updated_at,
            });
        }

        res.json({ success: true, exam, data: Array.from(subjectMap.values()) });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/progress/:userId/:examId/summary
// → { overallPercent, totalChapters, totalDone, subjects: [{ name, percent, total, done, inProgress }] }
router.get('/progress/:userId/:examId/summary', (req, res) => {
    try {
        const { userId } = req.params;
        const examId = parseInt(req.params.examId, 10);

        if (isNaN(examId) || examId < 1) {
            return res.status(400).json({ success: false, error: 'Invalid examId' });
        }
        const exam = examQueries.getById(examId);
        if (!exam) return res.status(404).json({ success: false, error: 'Exam not found' });

        const rows = progressQueries.summary(String(userId), examId);

        let totalChapters = 0;
        let totalDone     = 0;

        const subjects = rows.map(r => {
            const total    = Number(r.total)       || 0;
            const done     = Number(r.done)        || 0;
            const inProg   = Number(r.in_progress) || 0;
            totalChapters += total;
            totalDone     += done;
            return {
                id:         r.id,
                name:       r.name,
                nameBn:     r.name_bn,
                total,
                done,
                inProgress: inProg,
                percent:    total > 0 ? Math.round((done / total) * 100) : 0,
            };
        });

        const overallPercent = totalChapters > 0
            ? Math.round((totalDone / totalChapters) * 100)
            : 0;

        res.json({
            success: true,
            data: { overallPercent, totalChapters, totalDone, subjects },
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

export default router;
