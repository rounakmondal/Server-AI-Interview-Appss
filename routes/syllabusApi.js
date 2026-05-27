/**
 * syllabusApi.js — Public Study Plan & Syllabus API
 * Implements all 7 endpoints from the API documentation spec.
 * 
 * NEW ENDPOINTS:
 * 1. GET /api/syllabus/:examId                    — Get exam syllabus with all chapters
 * 2. GET /api/studyplan/template/:examId         — Get study plan template
 * 3. POST /api/studyplan/ai                       — Generate AI study plan
 * 4. GET /api/syllabus/:examId/progress          — Get syllabus progress (requires userId)
 * 5. GET /api/test/:chapterId/questions          — Get chapter test questions
 * 6. POST /api/test/submit                        — Submit chapter test
 * 7. POST /api/ai/chapter-guide                   — Get AI chapter study guide
 */

import { Router } from 'express';
import {
    examQueries,
    subjectQueries,
    chapterQueries,
    questionQueries,
    testAttemptQueries,
    testAnswerQueries,
    progressQueries,
    studyPlanQueries,
} from '../database/examDb.js';
import { getExamIdBySlug, normalizeChapterId } from '../utils/examIdMapper.js';
import { getExamDisplayName, getFilenameDisplayName, getSubjectDisplayName } from '../utils/friendlyNames.js';
import { callLLMWithFallback, convertGeminiToOpenAI } from '../utils/llmFallback.js';

const router = Router();

// ─── Helper: Get all exams with friendly names ───────────────────────────────

router.get('/exams-list', (req, res) => {
    try {
        const exams = examQueries.listAll();
        const examsWithDisplay = exams.map(exam => ({
            id: exam.slug,
            technicalName: exam.name,
            displayName: getExamDisplayName(exam.slug),
            nameBn: exam.name_bn,
            slug: exam.slug,
        }));
        
        res.json({
            success: true,
            data: examsWithDisplay,
        });
    } catch (err) {
        console.error('[exams-list] Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── Helper: AI API with Groq → SambaNova fallback ──────────────────────────

const GROQ_MODELS = [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
];

const SAMBANOVA_MODELS = [
    'Meta-Llama-3.3-70B-Instruct',
    'Meta-Llama-3.1-70B-Instruct',
    'Meta-Llama-3.1-8B-Instruct',
];

async function callGroq(systemPrompt, userPrompt, maxTokens = 4000) {
    const groqKey = process.env.GROQ_API_KEY;
    const sambaKey = process.env.SAMBANOVA_API_KEY;

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
    ];

    // ── Try Groq models ──
    if (groqKey) {
        for (const model of GROQ_MODELS) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 60_000);
            try {
                const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${groqKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model,
                        temperature: 0.7,
                        max_tokens: maxTokens,
                        messages,
                    }),
                    signal: controller.signal,
                });
                clearTimeout(timer);

                if (!res.ok) {
                    console.warn(`[syllabusApi] Groq ${model} HTTP ${res.status}`);
                    continue;
                }
                const data = await res.json();
                const content = data.choices?.[0]?.message?.content?.trim();
                if (!content) {
                    console.warn(`[syllabusApi] Groq ${model} empty content`);
                    continue;
                }
                console.log(`[syllabusApi] success with Groq ${model}`);
                return content;
            } catch (err) {
                clearTimeout(timer);
                console.warn(`[syllabusApi] Groq ${model} error:`, err.message);
            }
        }
    }

    // ── Try SambaNova models ──
    if (sambaKey) {
        for (const model of SAMBANOVA_MODELS) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 60_000);
            try {
                const res = await fetch('https://api.sambanova.ai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${sambaKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model,
                        temperature: 0.7,
                        max_tokens: maxTokens,
                        messages,
                    }),
                    signal: controller.signal,
                });
                clearTimeout(timer);

                if (!res.ok) {
                    console.warn(`[syllabusApi] SambaNova ${model} HTTP ${res.status}`);
                    continue;
                }
                const data = await res.json();
                const content = data.choices?.[0]?.message?.content?.trim();
                if (!content) {
                    console.warn(`[syllabusApi] SambaNova ${model} empty content`);
                    continue;
                }
                console.log(`[syllabusApi] success with SambaNova ${model}`);
                return content;
            } catch (err) {
                clearTimeout(timer);
                console.warn(`[syllabusApi] SambaNova ${model} error:`, err.message);
            }
        }
    }

    throw new Error('All AI providers failed (Groq + SambaNova)');
}

function extractJSON(text) {
    const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const start = cleaned.indexOf('{');
    if (start === -1) throw new Error('No JSON found in AI response');

    let partial = cleaned.slice(start);
    try {
        return JSON.parse(partial);
    } catch {
        // Repair truncated JSON
        const opens = (partial.match(/{/g) || []).length;
        const closes = (partial.match(/}/g) || []).length;
        partial += '}'.repeat(Math.max(0, opens - closes));
        return JSON.parse(partial);
    }
}

// ─── 1. GET /api/syllabus/:examId ──────────────────────────────────────────

router.get('/syllabus/:examId', (req, res) => {
    try {
        const examId = getExamIdBySlug(req.params.examId);
        if (!examId) {
            return res.status(400).json({
                success: false,
                error: `Invalid examId. Supported: WBCS, WBPSC, Police_SI, SSC_CGL, Banking`,
            });
        }

        const exam = examQueries.getById(examId);
        if (!exam) {
            return res.status(404).json({ success: false, error: 'Exam not found' });
        }

        // Get all subjects for the exam
        const subjects = subjectQueries.byExam(examId);

        // Get all chapters grouped by subject
        const subjectsData = subjects.map(subject => ({
            id: `${exam.slug}_${subject.id}`,
            name: subject.name,
            nameBn: subject.name_bn,
            displayName: getSubjectDisplayName(subject.name),
            icon: getSubjectIcon(subject.name),
            chapters: chapterQueries.bySubject(subject.id).map(chapter => ({
                id: `ch_${chapter.id}`,
                name: chapter.name,
                nameBn: chapter.name_bn,
                status: 'not_started',
                progress: 0,
                questionCount: questionQueries.countByChapter(chapter.id)?.cnt || 0,
            })),
        }));

        // Calculate total chapters
        const totalChapters = subjectsData.reduce(
            (sum, subject) => sum + subject.chapters.length,
            0
        );

        res.json({
            success: true,
            data: {
                examId: exam.slug,
                examName: exam.name,
                examDisplayName: getExamDisplayName(exam.slug),
                totalChapters,
                estimatedHoursPerChapter: 2,
                subjects: subjectsData,
            },
        });
    } catch (err) {
        console.error('[syllabus] Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── 2. GET /api/studyplan/template/:examId ───────────────────────────────

router.get('/studyplan/template/:examId', (req, res) => {
    try {
        const examId = getExamIdBySlug(req.params.examId);
        if (!examId) {
            return res.status(400).json({
                success: false,
                error: `Invalid examId. Supported: WBCS, WBPSC, Police_SI, SSC_CGL, Banking`,
            });
        }

        const exam = examQueries.getById(examId);
        if (!exam) {
            return res.status(404).json({ success: false, error: 'Exam not found' });
        }

        const rows = studyPlanQueries.template(examId);

        // Group by phase
        const phaseMap = {};
        for (const r of rows) {
            const phase = r.phase || 'General';
            if (!phaseMap[phase]) phaseMap[phase] = [];
            phaseMap[phase].push(r);
        }

        // Build template response
        const phases = Object.entries(phaseMap).map(([phaseNum, items]) => ({
            phase: parseInt(phaseNum) || 1,
            title: `${getTitleForPhase(parseInt(phaseNum))}`,
            duration: getDurationForPhase(parseInt(phaseNum)),
            description: getDescriptionForPhase(parseInt(phaseNum)),
            topics: items.map(item => ({
                subject: item.subject_name || 'General',
                chapters: [item.chapter_name || 'Overview'],
            })),
        }));

        res.json({
            success: true,
            data: {
                examId: exam.slug,
                examName: exam.name,
                examDisplayName: getExamDisplayName(exam.slug),
                totalHours: 12,
                phases,
            },
        });
    } catch (err) {
        console.error('[studyplan-template] Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── 3. POST /api/studyplan/ai ─────────────────────────────────────────────

router.post('/studyplan/ai', async (req, res) => {
    try {
        const { examId, examDate, hoursPerDay } = req.body;

        if (!examId || !examDate || !hoursPerDay) {
            return res.status(400).json({
                success: false,
                error: 'examId, examDate (YYYY-MM-DD), and hoursPerDay are required',
            });
        }

        const dbExamId = getExamIdBySlug(examId);
        if (!dbExamId) {
            return res.status(400).json({
                success: false,
                error: `Invalid examId. Supported: WBCS, WBPSC, Police_SI, SSC_CGL, Banking`,
            });
        }

        const exam = examQueries.getById(dbExamId);
        if (!exam) {
            return res.status(404).json({ success: false, error: 'Exam not found' });
        }

        // Validate date
        if (!/^\d{4}-\d{2}-\d{2}$/.test(examDate)) {
            return res.status(400).json({ success: false, error: 'Date must be YYYY-MM-DD' });
        }

        const hours = Number.isFinite(Number(hoursPerDay)) ? Number(hoursPerDay) : 3;
        if (hours < 1 || hours > 12) {
            return res.status(400).json({ success: false, error: 'hoursPerDay must be 1-12' });
        }

        // Calculate weeks until exam
        const examDateObj = new Date(examDate);
        const today = new Date();
        const daysRemaining = Math.max(1, Math.ceil((examDateObj - today) / (1000 * 60 * 60 * 24)));
        const totalWeeks = Math.ceil(daysRemaining / 7);

        // Generate AI plan using Groq
        const subjects = subjectQueries.byExam(dbExamId);
        const subjectList = subjects.map(s => `${s.name} (${s.name_bn})`).join(', ');

        const systemPrompt = `You are an expert exam preparation coordinator. Create a structured study plan in JSON format.`;
        const userPrompt = `Generate a ${totalWeeks}-week study plan for ${exam.name} exam starting today until ${examDate}.
Student can study ${hours} hours per day. Available subjects: ${subjectList}.

Return ONLY valid JSON with this structure:
{
  "weeks": [
    {
      "week": 1,
      "title": "Week 1 — Foundation",
      "subjects": ["Subject1", "Subject2"],
      "chapters": ["Chapter details"],
      "hoursPerDay": ${hours},
      "tips": "Study tip here"
    }
  ]
}`;

        const aiResponse = await callGroq(systemPrompt, userPrompt, 3000);
        const plan = extractJSON(aiResponse);

        // Ensure plan has weeks array
        if (!Array.isArray(plan.weeks)) {
            plan.weeks = [];
        }

        // Fill in weeks if AI didn't return enough
        while (plan.weeks.length < Math.min(totalWeeks, 12)) {
            const week = plan.weeks.length + 1;
            plan.weeks.push({
                week,
                title: `Week ${week} — ${week <= 4 ? 'Foundation' : week <= 8 ? 'Practice' : 'Revision'}`,
                subjects: ['All Subjects'],
                chapters: ['Continue revision'],
                hoursPerDay: hours,
                tips: 'Continue your preparation.',
            });
        }

        res.json({
            success: true,
            data: {
                examId: exam.slug,
                examName: exam.name,
                examDisplayName: getExamDisplayName(exam.slug),
                examDate,
                hoursPerDay: hours,
                totalWeeks: Math.min(totalWeeks, plan.weeks.length),
                createdAt: new Date().toISOString(),
                weeks: plan.weeks.slice(0, 12),
            },
        });
    } catch (err) {
        console.error('[studyplan-ai] Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── 4. GET /api/syllabus/:examId/progress ─────────────────────────────────

router.get('/syllabus/:examId/progress', (req, res) => {
    try {
        const examId = getExamIdBySlug(req.params.examId);
        if (!examId) {
            return res.status(400).json({
                success: false,
                error: `Invalid examId. Supported: WBCS, WBPSC, Police_SI, SSC_CGL, Banking`,
            });
        }

        // Get userId from query or header (optional - show anonymous progress if not provided)
        const userId = req.query.userId || req.headers['x-user-id'] || 'anonymous';

        const exam = examQueries.getById(examId);
        if (!exam) {
            return res.status(404).json({ success: false, error: 'Exam not found' });
        }

        const rows = progressQueries.summary(String(userId), examId);

        let totalChapters = 0;
        let totalCompleted = 0;

        const subjectProgress = rows.map(r => {
            const total = Number(r.total) || 0;
            const done = Number(r.done) || 0;
            totalChapters += total;
            totalCompleted += done;

            return {
                subjectId: `${exam.slug}_${r.id}`,
                subjectName: r.name,
                displayName: getSubjectDisplayName(r.name),
                completionPercentage: total > 0 ? Math.round((done / total) * 100) : 0,
                chaptersCompleted: done,
                totalChapters: total,
            };
        });

        const completionPercentage = totalChapters > 0
            ? Math.round((totalCompleted / totalChapters) * 100)
            : 0;

        res.json({
            success: true,
            data: {
                examId: exam.slug,
                examName: exam.name,
                examDisplayName: getExamDisplayName(exam.slug),
                completionPercentage,
                chaptersCompleted: totalCompleted,
                totalChapters,
                lastUpdated: new Date().toISOString(),
                subjectProgress,
            },
        });
    } catch (err) {
        console.error('[syllabus-progress] Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── 5. GET /api/test/:chapterId/questions ─────────────────────────────────

router.get('/test/:chapterId/questions', (req, res) => {
    try {
        const chapterId = normalizeChapterId(req.params.chapterId);
        if (!chapterId) {
            return res.status(400).json({ success: false, error: 'Invalid chapterId' });
        }

        const chapter = chapterQueries.getById(chapterId);
        if (!chapter) {
            return res.status(404).json({ success: false, error: 'Chapter not found' });
        }

        const available = questionQueries.countByChapter(chapterId)?.cnt || 0;
        if (available === 0) {
            return res.status(404).json({
                success: false,
                error: 'No questions available for this chapter',
            });
        }

        const limit = Math.min(10, Math.max(10, available)); // Return 10 questions
        const questions = questionQueries.randomByChapter(chapterId, limit);

        // Format response according to API spec
        const formattedQuestions = questions.map((q, idx) => ({
            id: q.id,
            question: q.text,
            questionBn: q.text_bn || '',
            options: [
                q.option_a,
                q.option_b,
                q.option_c,
                q.option_d,
            ],
            optionsBn: [
                '', // optionA_bn not in schema
                '', // optionB_bn not in schema
                '', // optionC_bn not in schema
                '', // optionD_bn not in schema
            ],
            correctIndex: getCorrectIndex(q.correct_option),
            explanation: q.explanation || '',
            explanationBn: '', // explanation_bn not in schema
        }));

        res.json({
            success: true,
            data: formattedQuestions,
        });
    } catch (err) {
        console.error('[test-questions] Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── 5.1 POST /api/test/:chapterId/questions-ai ────────────────────────────
// Generate AI-powered questions for a chapter (with fallback to database)

router.post('/test/:chapterId/questions-ai', async (req, res) => {
    try {
        const chapterId = normalizeChapterId(req.params.chapterId);
        if (!chapterId) {
            return res.status(400).json({ success: false, error: 'Invalid chapterId' });
        }

        const chapter = chapterQueries.getById(chapterId);
        if (!chapter) {
            return res.status(404).json({ success: false, error: 'Chapter not found' });
        }

        const { count = 10, difficulty = 'moderate' } = req.body || {};
        const numQuestions = Math.min(parseInt(count, 10) || 10, 20);

        // Get subject info
        const subject = subjectQueries.getById(chapter.subject_id);
        const exam = examQueries.getById(subject.exam_id);

        // Build AI prompt
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

        const examPattern = EXAM_PATTERNS[exam.name] || `${exam.name} competitive exam`;

        const systemPrompt = `You are an expert Indian competitive exam question setter specifically for ${exam.name}.
EXAM PATTERN: ${examPattern}

Generate exactly ${numQuestions} original MCQ questions on the topic "${chapter.name}" under ${subject.name} for the ${exam.name} exam.

Rules:
- Each question must be at ${difficulty} difficulty matching real ${exam.name} exam level
- Questions MUST follow the actual ${exam.name} syllabus pattern and question style
- Each question has exactly 4 options (A/B/C/D)
- correctOption must be exactly one of: "A", "B", "C" or "D"
- Provide short explanations
- Questions must be factually correct and exam-relevant
- Cover diverse aspects of "${chapter.name}" — don't repeat same subtopic
- All 4 options must be plausible
- Return ONLY a valid JSON array, no markdown fences, no extra text

Format:
[{
  "text": "Question text",
  "optionA": "Option A",
  "optionB": "Option B",
  "optionC": "Option C",
  "optionD": "Option D",
  "correctOption": "A",
  "explanation": "Brief explanation"
}]`;

        const userPrompt = `Generate ${numQuestions} ${difficulty} MCQ questions on "${chapter.name}" for ${exam.name}.`;

        let parsed;
        try {
            // Call LLM with fallback
            const resp = await callLLMWithFallback(
                process.env.GROQ_API_KEY,
                [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                { model: 'llama-3.3-70b-versatile', temperature: 0.7, max_tokens: 6000, stream: false },
                null,
                'chapter-ai-questions'
            );

            const data = await resp.json();
            const raw = data?.choices?.[0]?.message?.content
                     ?? data?.candidates?.[0]?.content?.parts?.[0]?.text
                     ?? '[]';

            // Parse JSON response
            const jsonStr = raw.replace(/```json?/gi, '').replace(/```/g, '').trim();
            parsed = JSON.parse(jsonStr);

            if (!Array.isArray(parsed) || parsed.length === 0) {
                throw new Error('Empty response');
            }
        } catch (aiErr) {
            console.warn('[test-questions-ai] AI generation failed, falling back to database:', aiErr.message);
            
            // Fallback to database questions
            const available = questionQueries.countByChapter(chapterId)?.cnt || 0;
            if (available > 0) {
                const limit = Math.min(numQuestions, available);
                const dbQuestions = questionQueries.randomByChapter(chapterId, limit);
                
                const formattedQuestions = dbQuestions.map((q) => ({
                    id: q.id,
                    question: q.text,
                    questionBn: q.text_bn || '',
                    options: [q.option_a, q.option_b, q.option_c, q.option_d],
                    optionsBn: ['', '', '', ''],
                    correctIndex: getCorrectIndex(q.correct_option),
                    explanation: q.explanation || '',
                    explanationBn: '',
                }));

                return res.json({
                    success: true,
                    data: formattedQuestions,
                    generated: false,
                    source: 'database',
                });
            }

            // If no database questions either, return error
            return res.status(503).json({
                success: false,
                error: 'AI generation failed and no database questions available',
            });
        }

        // Format response to match ChapterQuestion type
        const formattedQuestions = parsed.slice(0, numQuestions).map((q, idx) => {
            const correctOpt = String(q.correctOption || 'A').toUpperCase().trim().charAt(0);
            const correctIndex = { 'A': 0, 'B': 1, 'C': 2, 'D': 3 }[correctOpt] || 0;

            return {
                id: -(idx + 1), // Use negative IDs to indicate AI-generated
                question: String(q.text || ''),
                questionBn: '',
                options: [
                    String(q.optionA || ''),
                    String(q.optionB || ''),
                    String(q.optionC || ''),
                    String(q.optionD || ''),
                ],
                optionsBn: ['', '', '', ''],
                correctIndex,
                explanation: String(q.explanation || ''),
                explanationBn: '',
            };
        });

        res.json({
            success: true,
            data: formattedQuestions,
            generated: true,
            source: 'ai',
        });
    } catch (err) {
        console.error('[test-questions-ai] Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── 6. POST /api/test/submit ──────────────────────────────────────────────

router.post('/test/submit', (req, res) => {
    try {
        const { chapterId, answers } = req.body;
        const userId = req.body.userId || req.query.userId || req.headers['x-user-id'] || 'anonymous';

        if (!chapterId || !Array.isArray(answers) || answers.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'chapterId and non-empty answers[] are required',
            });
        }

        const cid = normalizeChapterId(chapterId);
        if (!cid) {
            return res.status(400).json({ success: false, error: 'Invalid chapterId' });
        }

        const chapter = chapterQueries.getById(cid);
        if (!chapter) {
            return res.status(404).json({ success: false, error: 'Chapter not found' });
        }

        // Server-side evaluation
        const results = [];
        let correct = 0;

        for (const answer of answers) {
            const qid = Number(answer.questionId);
            const selected = answer.selected;

            if (!Number.isFinite(qid)) continue;

            const question = questionQueries.getById(qid);
            if (!question || question.chapter_id !== cid) continue;

            const correctIndex = getCorrectIndex(question.correct_option);
            const isCorrect = selected === correctIndex;
            if (isCorrect) correct++;

            results.push({
                questionId: qid,
                selected,
                correct: correctIndex,
            });
        }

        const total = results.length;
        const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
        const passMark = chapter.pass_mark ?? 60;
        const passed = accuracy >= passMark;

        // Store attempt in database
        const attemptId = testAttemptQueries.create(
            String(userId),
            cid,
            accuracy,
            total,
            correct,
            null
        );

        // Store individual answers
        testAnswerQueries.bulkInsert(
            attemptId,
            results.map(r => ({
                questionId: r.questionId,
                selectedOption: String.fromCharCode(65 + r.selected), // Convert 0-3 to A-D
                isCorrect: r.selected === r.correct,
            }))
        );

        // Update progress
        const newStatus = passed ? 'done' : 'in_progress';
        progressQueries.upsert(String(userId), cid, newStatus, accuracy);

        res.json({
            success: true,
            data: {
                chapterId: `ch_${cid}`,
                score: correct,
                total,
                accuracy,
                passed,
                answers: results,
            },
        });
    } catch (err) {
        console.error('[test-submit] Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── 7. POST /api/ai/chapter-guide ────────────────────────────────────────

router.post('/ai/chapter-guide', async (req, res) => {
    try {
        const { chapterId, chapterName, userQuery } = req.body;

        if (!chapterId || !chapterName) {
            return res.status(400).json({
                success: false,
                error: 'chapterId, chapterName, and userQuery are required',
            });
        }

        const cid = normalizeChapterId(chapterId);
        if (!cid) {
            return res.status(400).json({ success: false, error: 'Invalid chapterId' });
        }

        const chapter = chapterQueries.getById(cid);
        if (!chapter) {
            return res.status(404).json({ success: false, error: 'Chapter not found' });
        }

        // Generate AI guide using Groq
        const systemPrompt = `You are an expert study guide generator for competitive exams. Provide comprehensive study guides with learning strategies.`;
        const userPrompt = `Generate a detailed study guide for "${chapterName}" chapter.
Question from student: "${userQuery || 'What should I focus on in this chapter?'}"

Provide:
1. Key concepts and definitions
2. Important topics to study
3. Learning strategies and tips
4. Recommended resources
5. Exam tips and tricks

Format the response in Markdown with clear sections using ## headers.`;

        const answer = await callGroq(systemPrompt, userPrompt, 4000);

        res.json({
            success: true,
            data: {
                chapterId: cid,
                answer: `## Study Guide: ${chapterName}\n\n**Your question:** ${userQuery || 'What are the key topics?'}\n\n${answer}`,
            },
        });
    } catch (err) {
        console.error('[chapter-guide] Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── Helper Functions ──────────────────────────────────────────────────────

function getSubjectIcon(subjectName) {
    const iconMap = {
        'History': '📜',
        'Geography': '🗺️',
        'Polity': '⚖️',
        'Economy': '💰',
        'Science': '🔬',
        'English': '📚',
        'Mathematics': '🔢',
        'Reasoning': '🧠',
        'General Studies': '📖',
        'General Knowledge': '🧠',
        'Current Affairs': '📰',
    };

    for (const [key, icon] of Object.entries(iconMap)) {
        if (subjectName.includes(key)) return icon;
    }
    return '📚';
}

function getTitleForPhase(phase) {
    const titles = {
        1: 'Foundation — Core Concepts (4-6 weeks)',
        2: 'Practice — Problem Solving (6-8 weeks)',
        3: 'Revision — Full-Length Mocks (2-3 weeks)',
    };
    return titles[phase] || 'Study Phase';
}

function getDurationForPhase(phase) {
    const durations = {
        1: '4-6 weeks',
        2: '6-8 weeks',
        3: '2-3 weeks',
    };
    return durations[phase] || '2-3 weeks';
}

function getDescriptionForPhase(phase) {
    const descriptions = {
        1: 'Build strong foundational knowledge. Study NCERT and basic concepts.',
        2: 'Solve previous year papers and take chapter-wise tests. Focus on speed and accuracy.',
        3: 'Take full-length mock tests daily. Review weak areas. Build confidence.',
    };
    return descriptions[phase] || 'Continue your preparation';
}

function getCorrectIndex(correctOption) {
    if (!correctOption) return 0;
    const map = { 'A': 0, 'B': 1, 'C': 2, 'D': 3 };
    return map[String(correctOption).toUpperCase()] || 0;
}

export default router;
