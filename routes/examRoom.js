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

    // Exam-specific patterns for prompt context
    const EXAM_PATTERNS = {
        'WBCS': 'WBCS Prelims — 200 MCQs, 2.5 hours, negative marking 1/3. Deep knowledge required. Bengal-specific topics important.',
        'SSC CGL': 'SSC CGL — 100 MCQs, 60 min, negative marking 0.50. Speed-based. Math & Reasoning are 50% of paper.',
        'SSC CHSL': 'SSC CHSL — 100 MCQs, 60 min, negative marking 0.50. Moderate difficulty, speed matters.',
        'SSC MTS': 'SSC MTS — 100 MCQs, 90 min. Easier difficulty. Basic concepts + General Awareness.',
        'WBP SI': 'WB Police SI — 100 MCQs, 90 min. GK + Math + Reasoning. Bengal-focus. Law enforcement basics.',
        'WBP Constable': 'WB Police Constable — 100 MCQs, 90 min. Basic GK + Math. No negative marking.',
        'RRB NTPC': 'RRB NTPC — 100 MCQs, 90 min. Moderate difficulty. Train problems signature. Math 30%.',
        'RRB Group D': 'RRB Group D — 100 MCQs, 90 min. Basic difficulty. Math + Reasoning + GK.',
        'IBPS PO': 'IBPS PO — 100 MCQs, 60 min sectional timing. Negative marking 0.25. Heavy Quant + Reasoning. Banking awareness required.',
        'IBPS Clerk': 'IBPS Clerk — 100 MCQs, 60 min. Moderate difficulty. Quant + Reasoning + Banking.',
        'JTET': 'Jharkhand TET — 150 MCQs, 2.5 hours. Child pedagogy + subject knowledge.',
    };

    const chapterBn = chapter.name_bn || chapter.name;
    const subjectBn = SUBJECT_BN[subject.name] || subject.name_bn || subject.name;
    const examPattern = EXAM_PATTERNS[exam.name] || `${exam.name} competitive exam`;

    const systemPrompt = `You are an expert Indian competitive exam question setter specifically for ${exam.name}.
EXAM PATTERN: ${examPattern}

Generate exactly ${count} original MCQ questions on the topic "${chapter.name}" (${chapterBn}) under ${subject.name} (${subjectBn}).

Rules:
- Each question must be at ${difficulty} difficulty matching real ${exam.name} exam level
- Questions MUST follow the actual ${exam.name} syllabus pattern and question style
- Each question has exactly 4 options (A/B/C/D)
- correctOption must be exactly one of: "A", "B", "C" or "D"
- Provide short explanations in English
- Also provide Bengali translation of question text (textBn)
- Questions must be factually correct and exam-relevant
- Cover diverse aspects of "${chapter.name}" — don't repeat same subtopic
- All 4 options must be plausible — weak students should find at least 2 tempting
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

/**
 * POST /api/exam-room/predict-chance
 * Uses AI to predict the user's chance of cracking the exam based on test performance.
 * Body: { examName, accuracy, correct, wrong, skipped, score, maxScore, totalQuestions, difficulty }
 * Auth required.
 */
router.post('/predict-chance', authMiddleware, async (req, res) => {
    try {
        const { examName, accuracy, correct, wrong, skipped, score, maxScore, totalQuestions, difficulty } = req.body;

        if (typeof accuracy !== 'number' || !examName) {
            return res.status(400).json({ success: false, error: 'examName and accuracy are required' });
        }

        const prompt = `You are an expert Indian competitive exam coach. A student just completed a mock test for the "${examName}" exam.

Here are their results:
- Difficulty level: ${difficulty || 'Standard'}
- Score: ${score}/${maxScore}
- Accuracy: ${accuracy}%
- Correct answers: ${correct}/${totalQuestions}
- Wrong answers: ${wrong}
- Skipped questions: ${skipped}
- Negative marking impact: ${wrong > 0 ? 'Yes' : 'No'}

Based on this single test performance, provide a realistic prediction and actionable advice. Consider that this is one test and the actual exam has many more variables.

Reply ONLY with a valid JSON object (no markdown, no code fences) in this exact format:
{
  "chance": <number 0-100 representing estimated chance to clear the exam>,
  "verdict": "<one of: Very Strong | Strong | Moderate | Needs Work | Critical>",
  "analysis": "<2-3 sentence overall analysis>",
  "strengths": ["<strength 1>", "<strength 2>"],
  "weakAreas": ["<weak area 1>", "<weak area 2>"],
  "tips": ["<actionable tip 1>", "<actionable tip 2>", "<actionable tip 3>"]
}`;

        const apiKey = process.env.GROQ_API_KEY;
        const messages = [
            { role: 'system', content: 'You are an expert exam preparation coach. Always respond with valid JSON only.' },
            { role: 'user', content: prompt },
        ];

        const llmResponse = await callLLMWithFallback(apiKey, messages, {
            temperature: 0.6,
            max_tokens: 600,
        }, null, 'exam-prediction');

        let prediction;
        const contentType = llmResponse.headers?.get?.('content-type') || '';

        if (contentType.includes('application/json')) {
            // Groq / OpenAI-compatible response
            const json = await llmResponse.json();
            const text = json.choices?.[0]?.message?.content || '';
            prediction = JSON.parse(text.replace(/```json\s*/g, '').replace(/```/g, '').trim());
        } else {
            // Gemini response
            const json = await llmResponse.json();
            const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
            prediction = JSON.parse(text.replace(/```json\s*/g, '').replace(/```/g, '').trim());
        }

        // Validate shape
        const result = {
            chance:    Math.max(0, Math.min(100, Number(prediction.chance) || 0)),
            verdict:   String(prediction.verdict || 'Moderate'),
            analysis:  String(prediction.analysis || 'Analysis unavailable.'),
            strengths: Array.isArray(prediction.strengths) ? prediction.strengths.map(String).slice(0, 5) : [],
            weakAreas: Array.isArray(prediction.weakAreas) ? prediction.weakAreas.map(String).slice(0, 5) : [],
            tips:      Array.isArray(prediction.tips) ? prediction.tips.map(String).slice(0, 5) : [],
        };

        res.json({ success: true, prediction: result });
    } catch (err) {
        console.error('[predict-chance] Error:', err.message);
        // Fallback: algorithmic prediction when AI is unavailable
        const { accuracy = 0, correct = 0, wrong = 0, skipped = 0, totalQuestions = 1 } = req.body || {};
        const chance = Math.min(95, Math.max(5, Math.round(accuracy * 0.85 + (correct / Math.max(1, totalQuestions)) * 15)));
        const verdict = chance >= 75 ? 'Strong' : chance >= 50 ? 'Moderate' : chance >= 30 ? 'Needs Work' : 'Critical';
        res.json({
            success: true,
            prediction: {
                chance,
                verdict,
                analysis: `Based on your accuracy of ${accuracy}%, your estimated chance is ${chance}%. ${wrong > 0 ? 'Reducing wrong answers will significantly improve your score due to negative marking.' : ''} ${skipped > 0 ? 'Try to attempt more questions to maximize your score.' : ''}`.trim(),
                strengths: accuracy >= 60 ? ['Good accuracy rate'] : [],
                weakAreas: [
                    ...(wrong > 0 ? ['Incorrect answers causing negative marks'] : []),
                    ...(skipped > 0 ? ['Too many questions left unanswered'] : []),
                ],
                tips: [
                    'Practice more mock tests to improve speed and accuracy',
                    wrong > 0 ? 'Focus on eliminating wrong answers to avoid negative marking' : 'Maintain your low error rate',
                    skipped > 0 ? 'Work on time management to attempt all questions' : 'Great job attempting all questions',
                ],
            },
        });
    }
});

export default router;
