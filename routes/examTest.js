import { Router } from 'express';
import {
    chapterQueries,
    questionQueries,
    testAttemptQueries,
    testAnswerQueries,
    progressQueries,
} from '../database/examDb.js';

const router = Router();

const VALID_OPTIONS  = new Set(['A', 'B', 'C', 'D']);
const MIN_QUESTIONS  = 10;
const MAX_QUESTIONS  = 15;

// GET /api/test/:chapterId/questions
// Returns 10–15 random MCQs for the chapter (correct answers NOT included)
router.get('/test/:chapterId/questions', (req, res) => {
    try {
        const chapterId = parseInt(req.params.chapterId, 10);
        if (isNaN(chapterId) || chapterId < 1) {
            return res.status(400).json({ success: false, error: 'Invalid chapterId' });
        }
        const chapter = chapterQueries.getById(chapterId);
        if (!chapter) return res.status(404).json({ success: false, error: 'Chapter not found' });

        const count     = questionQueries.countByChapter(chapterId);
        const available = Number(count?.cnt) || 0;
        if (available === 0) {
            return res.status(404).json({
                success: false,
                error: 'No questions available for this chapter yet',
            });
        }

        const limit     = Math.min(MAX_QUESTIONS, Math.max(MIN_QUESTIONS, available));
        const questions = questionQueries.randomByChapter(chapterId, limit);

        // Strip answer key and explanation before sending to client
        const sanitized = questions.map(q => ({
            id:         q.id,
            text:       q.text,
            textBn:     q.text_bn,
            optionA:    q.option_a,
            optionB:    q.option_b,
            optionC:    q.option_c,
            optionD:    q.option_d,
            difficulty: q.difficulty,
        }));

        res.json({
            success: true,
            chapter: { id: chapter.id, name: chapter.name, nameBn: chapter.name_bn, passMark: chapter.pass_mark },
            total:   sanitized.length,
            data:    sanitized,
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/test/submit
// Evaluates answers server-side, stores attempt, updates progress
router.post('/test/submit', (req, res) => {
    try {
        const { userId, chapterId, answers, timeTakenSecs } = req.body;

        if (!userId || !chapterId || !Array.isArray(answers) || answers.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'userId, chapterId, and a non-empty answers[] are required',
            });
        }
        const cid = parseInt(chapterId, 10);
        if (isNaN(cid) || cid < 1) {
            return res.status(400).json({ success: false, error: 'Invalid chapterId' });
        }
        const chapter = chapterQueries.getById(cid);
        if (!chapter) return res.status(404).json({ success: false, error: 'Chapter not found' });

        // Server-side evaluation — never trust client-supplied correctness
        const results = [];
        let correct = 0;

        for (const answer of answers) {
            const qid      = parseInt(answer.questionId, 10);
            const selected = String(answer.selected || '').toUpperCase();

            if (isNaN(qid) || qid < 1 || !VALID_OPTIONS.has(selected)) continue;

            const question = questionQueries.getById(qid);
            // Reject questions that do not belong to the submitted chapter
            if (!question || question.chapter_id !== cid) continue;

            const isCorrect = question.correct_option === selected;
            if (isCorrect) correct++;

            results.push({
                questionId:    qid,
                selected,
                correctOption: question.correct_option,
                isCorrect,
                explanation:   question.explanation,
            });
        }

        const total    = results.length;
        const score    = total > 0 ? Math.round((correct / total) * 100) : 0;
        const passMark = chapter.pass_mark ?? 60;
        const passed   = score >= passMark;

        // Persist attempt
        const timeSecs  = Number.isFinite(Number(timeTakenSecs)) ? Number(timeTakenSecs) : null;
        const attemptId = testAttemptQueries.create(String(userId), cid, score, total, correct, timeSecs);

        // Persist individual answers
        testAnswerQueries.bulkInsert(
            attemptId,
            results.map(r => ({
                questionId:     r.questionId,
                selectedOption: r.selected,
                isCorrect:      r.isCorrect,
            }))
        );

        // Update chapter progress
        const newStatus = passed ? 'done' : 'in_progress';
        progressQueries.upsert(String(userId), cid, newStatus, score);

        res.json({
            success: true,
            data: { attemptId, score, total, correct, passed, passMark, results },
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/test/:userId/:chapterId/history
// List of past test attempts with scores
router.get('/test/:userId/:chapterId/history', (req, res) => {
    try {
        const { userId } = req.params;
        const chapterId  = parseInt(req.params.chapterId, 10);

        if (isNaN(chapterId) || chapterId < 1) {
            return res.status(400).json({ success: false, error: 'Invalid chapterId' });
        }
        const chapter = chapterQueries.getById(chapterId);
        if (!chapter) return res.status(404).json({ success: false, error: 'Chapter not found' });

        const attempts = testAttemptQueries.byUserChapter(String(userId), chapterId);
        res.json({ success: true, chapter, data: attempts });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

export default router;
