import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { authMiddleware } from '../middleware/auth.js';
import { callLLMWithFallback } from '../utils/llmFallback.js';
import {
    examQueries,
    chapterQueries,
    questionQueries,
    examRoomQueries,
    seedExamRoomTests,
} from '../database/examDb.js';
import { getDb } from '../database/db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = path.join(__dirname, '../data/interview.db');

function saveDb() {
    const db = getDb();
    if (db) fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

// ─── AI question generator (generates + caches to DB) ─────────────────────────

async function generateAndCacheQuestions(chapter, subject, exam, difficulty, count) {
    const SUBJECT_BN = {
        'General Studies': 'সাধারণ জ্ঞান', 'Bengali': 'বাংলা', 'English': 'ইংরেজি',
        'Arithmetic': 'পাটিগণিত', 'General Science': 'সাধারণ বিজ্ঞান',
        'Mathematics': 'গণিত', 'Elementary Mathematics': 'প্রাথমিক গণিত',
        'Basic Mathematics': 'প্রাথমিক গণিত', 'Reasoning': 'যুক্তিবিদ্যা',
        'Reasoning Ability': 'যুক্তি দক্ষতা', 'General Intelligence & Reasoning': 'সাধারণ বুদ্ধিমত্তা',
        'Quantitative Aptitude': 'পরিমাণগত যোগ্যতা', 'General Awareness': 'সাধারণ সচেতনতা',
        'General Knowledge & Current Affairs': 'সাধারণ জ্ঞান', 'English Language': 'ইংরেজি ভাষা',
        'General Knowledge': 'সাধারণ জ্ঞান', 'Insurance & Financial Market Awareness': 'বীমা সচেতনতা',
    };

    const chapterBn = chapter.name_bn || chapter.name;
    const subjectBn = SUBJECT_BN[subject.name] || subject.name_bn || subject.name;

    const systemPrompt = `You are an expert Indian competitive exam question setter for ${exam.name}.
Generate exactly ${count} original MCQ questions on the topic "${chapter.name}" (${chapterBn}) under ${subject.name} (${subjectBn}).

Rules:
- Each question must be at ${difficulty} difficulty
- Each question has exactly 4 options (A/B/C/D)
- correctOption must be exactly one of: "A", "B", "C" or "D"
- Provide short explanations in English
- Also provide Bengali translation of question text (textBn)
- Questions must be factually correct and exam-relevant
- Return ONLY a valid JSON array, no markdown fences, no extra text

Format:
[{
  "text": "Question in English",
  "textBn": "প্রশ্ন বাংলায়",
  "optionA": "Option A",
  "optionB": "Option B",
  "optionC": "Option C",
  "optionD": "Option D",
  "correctOption": "A",
  "explanation": "Brief explanation"
}]`;

    const resp = await callLLMWithFallback(
        process.env.GROQ_API_KEY,
        [{ role: 'system', content: systemPrompt }, { role: 'user', content: `Generate ${count} ${difficulty} MCQ questions on ${chapter.name} for ${exam.name}.` }],
        { model: 'llama-3.3-70b-versatile', temperature: 0.7, max_tokens: 6000, stream: false },
        null,
        'exam-room-questions',
    );

    const data = await resp.json();
    const raw  = data?.choices?.[0]?.message?.content
              ?? data?.candidates?.[0]?.content?.parts?.[0]?.text
              ?? '[]';
    const jsonStr = raw.replace(/```json?/gi, '').replace(/```/g, '').trim();
    const parsed  = JSON.parse(jsonStr);
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('LLM returned no questions');

    // Insert into questions table and return
    const db = getDb();
    const inserted = [];
    for (const q of parsed) {
        const correctOpt = String(q.correctOption ?? 'A').toUpperCase().trim().charAt(0);
        if (!['A','B','C','D'].includes(correctOpt)) continue;
        db.run(
            `INSERT INTO questions
               (chapter_id, text, text_bn, option_a, option_b, option_c, option_d,
                correct_option, explanation, difficulty)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                chapter.id,
                String(q.text   ?? ''),
                String(q.textBn ?? ''),
                String(q.optionA ?? ''),
                String(q.optionB ?? ''),
                String(q.optionC ?? ''),
                String(q.optionD ?? ''),
                correctOpt,
                String(q.explanation ?? ''),
                difficulty,
            ]
        );
        const row = db.prepare('SELECT last_insert_rowid() as id');
        row.step();
        const { id } = row.getAsObject();
        row.free();
        inserted.push({
            id:         Number(id),
            text:       String(q.text   ?? ''),
            textBn:     String(q.textBn ?? ''),
            optionA:    String(q.optionA ?? ''),
            optionB:    String(q.optionB ?? ''),
            optionC:    String(q.optionC ?? ''),
            optionD:    String(q.optionD ?? ''),
            difficulty,
        });
    }
    saveDb();
    return inserted;
}

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'interviewsathi_jwt_secret_key_2025';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract userId from optional Bearer token. Returns null if absent/invalid. */
function optionalUserId(req) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    try {
        const payload = jwt.verify(header.slice(7), JWT_SECRET);
        return payload.id || payload.userId || null;
    } catch {
        return null;
    }
}

function buildTree(rows, withUserStats) {
    const subjectMap = new Map();

    for (const r of rows) {
        // Subject
        if (!subjectMap.has(r.subject_id)) {
            subjectMap.set(r.subject_id, {
                subjectId:     r.subject_id,
                subjectName:   r.subject_name,
                subjectNameBn: r.subject_name_bn,
                sortOrder:     r.subj_order,
                chapters:      new Map(),
            });
        }
        const subj = subjectMap.get(r.subject_id);

        // Chapter
        if (!subj.chapters.has(r.chapter_id)) {
            subj.chapters.set(r.chapter_id, {
                chapterId:     r.chapter_id,
                chapterName:   r.chapter_name,
                chapterNameBn: r.chapter_name_bn,
                sortOrder:     r.chap_order,
                tests:         [],
            });
        }
        const chap = subj.chapters.get(r.chapter_id);

        // Test
        const test = {
            testId:         r.test_id,
            chapterName:    r.chapter_name,
            difficulty:     r.difficulty,
            totalQuestions: r.total_questions,
            timeLimit:      r.time_limit,
            marksPerQuestion: r.marks_per_q,
            negativeMarking: r.negative_marks,
            status:         r.status,
        };

        // User stats (null when not attempted)
        test.userStats = withUserStats
            ? {
                attempted:  r.completed_at ? 1 : 0,
                score:      r.score ?? null,
                accuracy:   r.accuracy ?? null,
                timeTaken:  r.time_taken ?? null,
              }
            : null;

        chap.tests.push(test);
    }

    // Collapse Maps to arrays
    const subjects = [...subjectMap.values()].map(s => ({
        ...s,
        chapters: [...s.chapters.values()],
    }));

    return subjects;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/exam-room/exams
 * Returns list of all exams
 */
router.get('/exams', (req, res) => {
    try {
        const exams = examQueries.listAll();
        res.json({ success: true, data: exams });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/exam-room/:examSlug
 * Returns full chapter+test tree for an exam (with user stats if authenticated)
 * Auth is optional — if provided, attaches user stats to each test.
 */
router.get('/:examSlug', (req, res) => {
    try {
        const { examSlug } = req.params;
        if (!examSlug || !/^[a-z0-9-]+$/.test(examSlug)) {
            return res.status(400).json({ success: false, error: 'Invalid exam slug' });
        }

        const exam = examQueries.getBySlug(examSlug);
        if (!exam) return res.status(404).json({ success: false, error: 'Exam not found' });

        const userId = optionalUserId(req);
        let rows     = examRoomQueries.fullTree(exam.id, userId ?? '');

        // Auto-seed tests if DB has chapters but no exam-room tests yet
        if (rows.length === 0) {
            seedExamRoomTests();
            rows = examRoomQueries.fullTree(exam.id, userId ?? '');
        }

        const subjects = buildTree(rows, !!userId);
        res.json({ success: true, exam, subjects });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/exam-room/test/:testId/questions
 * Returns questions for a test. If none exist in the DB, generates them
 * via LLM and caches them permanently for future requests.
 * Auth required.
 */
router.get('/test/:testId/questions', authMiddleware, async (req, res) => {
    try {
        const testId = req.params.testId;
        if (!testId) return res.status(400).json({ success: false, error: 'testId required' });

        const test = examRoomQueries.getTest(testId);
        if (!test) return res.status(404).json({ success: false, error: 'Test not found' });

        if (test.status === 'locked') {
            return res.status(403).json({ success: false, error: 'This test is locked. Complete the previous difficulty first.' });
        }

        const chapter = chapterQueries.getById(test.chapter_id);
        if (!chapter) return res.status(404).json({ success: false, error: 'Chapter not found' });

        // Try DB first — prefer matching difficulty, fall back to any difficulty
        let pool     = questionQueries.randomByChapter(test.chapter_id, test.total_questions * 5);
        let filtered = pool.filter(q => q.difficulty === test.difficulty);
        let source   = filtered.length >= test.total_questions ? filtered : pool;
        let picked   = source.slice(0, test.total_questions);

        // No questions in DB — generate via LLM then cache
        if (picked.length === 0) {
            // Get subject + exam for context
            const subjectRow = (function getSubject() {
                const db = getDb();
                const stmt = db.prepare('SELECT s.*, e.name AS exam_name, e.name_bn AS exam_name_bn, e.slug AS exam_slug, e.id AS exam_id FROM subjects s JOIN exams e ON e.id = s.exam_id WHERE s.id = ?');
                stmt.bind([chapter.subject_id]);
                let r = null;
                if (stmt.step()) r = stmt.getAsObject();
                stmt.free();
                return r;
            })();

            if (!subjectRow) return res.status(404).json({ success: false, error: 'Subject not found' });

            const exam    = { id: subjectRow.exam_id, name: subjectRow.exam_name, name_bn: subjectRow.exam_name_bn, slug: subjectRow.exam_slug };
            const subject = { id: subjectRow.id, name: subjectRow.name, name_bn: subjectRow.name_bn };

            // Generate more than needed so we have a pool for retakes
            const generateCount = test.total_questions * 3;
            console.log(`[exam-room] Generating ${generateCount} AI questions for chapter "${chapter.name}" (${test.difficulty})`);

            picked = await generateAndCacheQuestions(chapter, subject, exam, test.difficulty, generateCount);
            picked = picked.slice(0, test.total_questions);
        }

        if (picked.length === 0) {
            return res.status(500).json({ success: false, error: 'Could not generate questions. Please try again.' });
        }

        const sanitized = picked.map(q => ({
            id:         q.id,
            text:       q.text,
            textBn:     q.textBn ?? q.text_bn ?? '',
            optionA:    q.optionA ?? q.option_a ?? '',
            optionB:    q.optionB ?? q.option_b ?? '',
            optionC:    q.optionC ?? q.option_c ?? '',
            optionD:    q.optionD ?? q.option_d ?? '',
            difficulty: q.difficulty,
        }));

        res.json({
            success: true,
            test: {
                testId:           test.id,
                chapterName:      chapter.name,
                chapterNameBn:    chapter.name_bn ?? '',
                difficulty:       test.difficulty,
                totalQuestions:   test.total_questions,
                timeLimit:        test.time_limit,
                marksPerQuestion: test.marks_per_q,
                negativeMarking:  test.negative_marks,
            },
            questions: sanitized,
        });
    } catch (err) {
        console.error('[exam-room] questions error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/exam-room/test/:testId/submit
 * Evaluates answers, persists user stats, returns detailed result.
 * Body: { answers: [{ questionId, selectedOption }], timeTakenSecs }
 * Auth required.
 */
router.post('/test/:testId/submit', authMiddleware, (req, res) => {
    try {
        const testId  = req.params.testId;
        const userId  = req.userId;
        const { answers, timeTakenSecs } = req.body;

        if (!Array.isArray(answers) || answers.length === 0) {
            return res.status(400).json({ success: false, error: 'answers[] is required' });
        }

        const test = examRoomQueries.getTest(testId);
        if (!test) return res.status(404).json({ success: false, error: 'Test not found' });

        const VALID_OPTIONS = new Set(['A', 'B', 'C', 'D']);
        let correct = 0;
        let wrong   = 0;
        let skipped = 0;
        const reviewed = [];

        for (const ans of answers) {
            const qId = Number(ans.questionId);
            if (!Number.isInteger(qId) || qId < 1) continue;
            const sel = typeof ans.selectedOption === 'string'
                ? ans.selectedOption.toUpperCase()
                : null;
            const row = questionQueries.getById(qId);
            if (!row) continue;

            const isCorrect = !!sel && VALID_OPTIONS.has(sel) && row.correct_option === sel;
            if (!sel || !VALID_OPTIONS.has(sel)) {
                skipped++;
            } else if (isCorrect) {
                correct++;
            } else {
                wrong++;
            }

            reviewed.push({
                questionId:     qId,
                text:           row.text,
                selectedOption: sel,
                correctOption:  row.correct_option,
                isCorrect:      !!isCorrect,
                explanation:    row.explanation,
            });
        }

        const rawScore = correct * test.marks_per_q - wrong * test.negative_marks;
        const score    = parseFloat(Math.max(0, rawScore).toFixed(2));
        const maxScore = test.total_questions * test.marks_per_q;
        const accuracy = parseFloat(((correct / test.total_questions) * 100).toFixed(1));

        // Persist stats
        examRoomQueries.upsertUserStat(userId, testId, score, accuracy, timeTakenSecs ?? null);

        // Unlock next difficulty when accuracy >= 60%
        let unlockedTest = null;
        if (accuracy >= 60) {
            const cid = test.chapter_id;
            let nextId = null;
            if (test.difficulty === 'Easy')   nextId = `ch${cid}_medium`;
            if (test.difficulty === 'Medium') nextId = `ch${cid}_hard`;

            if (nextId) {
                const next = examRoomQueries.getTest(nextId);
                if (next && next.status === 'locked') {
                    examRoomQueries.unlockTest(nextId);
                    unlockedTest = nextId;
                }
            }
        }

        res.json({
            success: true,
            result: {
                testId,
                correct,
                wrong,
                skipped,
                score,
                maxScore,
                accuracy,
                timeTakenSecs: timeTakenSecs ?? null,
                passed:        accuracy >= 60,
                unlockedTest,
                reviewed,
            },
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/exam-room/user-stats/:examSlug
 * Returns summary stats (difficulty breakdown) for the authenticated user in an exam.
 * Auth required.
 */
router.get('/user-stats/:examSlug', authMiddleware, (req, res) => {
    try {
        const { examSlug } = req.params;
        if (!examSlug || !/^[a-z0-9-]+$/.test(examSlug)) {
            return res.status(400).json({ success: false, error: 'Invalid exam slug' });
        }

        const exam = examQueries.getBySlug(examSlug);
        if (!exam) return res.status(404).json({ success: false, error: 'Exam not found' });

        const userId = req.userId;
        const stats  = examRoomQueries.summaryByExam(userId, exam.id);
        res.json({ success: true, exam: { id: exam.id, name: exam.name, slug: exam.slug }, stats });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

export default router;
