import { Router } from 'express';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../database/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = path.join(__dirname, '../data/interview.db');
const router    = Router();

// ─── SQLite helpers (local, no per-call persist) ──────────────────────────────

function saveDb() {
    const db = getDb();
    if (db) fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

function qAll(sql, params = []) {
    const db   = getDb();
    const stmt = db.prepare(sql);
    if (params.length) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
}

function qOne(sql, params = []) {
    const db   = getDb();
    const stmt = db.prepare(sql);
    if (params.length) stmt.bind(params);
    let row = null;
    if (stmt.step()) row = stmt.getAsObject();
    stmt.free();
    return row;
}

function run(sql, params = []) {
    const db = getDb();
    if (params.length) db.run(sql, params);
    else db.run(sql);
    saveDb();
}

function runMany(stmts) {
    const db = getDb();
    for (const { sql, params = [] } of stmts) {
        if (params.length) db.run(sql, params);
        else db.run(sql);
    }
    saveDb();
}

// ─── Syllabus data for plan generation ───────────────────────────────────────

const SYLLABI = {
    wbcs: [
        { subject: 'Bengali Language', topic: 'ব্যাকরণ - সন্ধি ও সমাস' },
        { subject: 'Bengali Language', topic: 'ব্যাকরণ - কারক ও বিভক্তি' },
        { subject: 'Bengali Language', topic: 'বাগধারা ও প্রবাদ' },
        { subject: 'Bengali Language', topic: 'সাহিত্য - রবীন্দ্রনাথ ও নজরুল' },
        { subject: 'Bengali Language', topic: 'সাহিত্য - আধুনিক কবি-সাহিত্যিক' },
        { subject: 'Bengali Language', topic: 'রচনা ও পত্রলিখন কৌশল' },
        { subject: 'English Language', topic: 'Grammar - Tense & Voice' },
        { subject: 'English Language', topic: 'Grammar - Narration & Transformation' },
        { subject: 'English Language', topic: 'Vocabulary - Synonyms & Antonyms' },
        { subject: 'English Language', topic: 'Comprehension Passages' },
        { subject: 'English Language', topic: 'Error Spotting & Fill in the Blanks' },
        { subject: 'Indian History', topic: 'প্রাচীন ভারত - সিন্ধু সভ্যতা থেকে মৌর্য' },
        { subject: 'Indian History', topic: 'মধ্যযুগ - দিল্লি সুলতানি ও মোঘল সাম্রাজ্য' },
        { subject: 'Indian History', topic: 'আধুনিক ভারত - ব্রিটিশ শাসন ও স্বাধীনতা আন্দোলন' },
        { subject: 'Indian History', topic: 'ভারতীয় জাতীয় আন্দোলন - গান্ধীজির নেতৃত্ব' },
        { subject: 'Indian History', topic: 'বাংলার ইতিহাস - নবাব থেকে স্বাধীনতা' },
        { subject: 'Geography', topic: 'ভারতের ভূগোল - নদী, পর্বত, সমভূমি' },
        { subject: 'Geography', topic: 'ভারতের জলবায়ু ও বৃষ্টিপাত' },
        { subject: 'Geography', topic: 'পশ্চিমবঙ্গের ভূগোল' },
        { subject: 'Geography', topic: 'বিশ্বের মহাদেশ ও মহাসাগর' },
        { subject: 'Geography', topic: 'কৃষি, শিল্প ও প্রাকৃতিক সম্পদ' },
        { subject: 'Indian Polity', topic: 'সংবিধানের মূল বৈশিষ্ট্য ও প্রস্তাবনা' },
        { subject: 'Indian Polity', topic: 'মৌলিক অধিকার ও কর্তব্য' },
        { subject: 'Indian Polity', topic: 'সংসদ ও রাষ্ট্রপতির ক্ষমতা' },
        { subject: 'Indian Polity', topic: 'রাজ্য সরকার ও পঞ্চায়েত ব্যবস্থা' },
        { subject: 'Indian Polity', topic: 'নির্বাচন কমিশন ও বিচার বিভাগ' },
        { subject: 'Indian Economy', topic: 'ভারতীয় অর্থনীতির মূল ধারণা - GDP, বাজেট' },
        { subject: 'Indian Economy', topic: 'পরিকল্পনা কমিশন থেকে নীতি আয়োগ' },
        { subject: 'Indian Economy', topic: 'কৃষি অর্থনীতি ও ব্যাংকিং ব্যবস্থা' },
        { subject: 'Indian Economy', topic: 'দারিদ্র্য, বেকারত্ব ও সরকারি প্রকল্প' },
        { subject: 'General Science', topic: 'পদার্থবিদ্যা - গতি, শক্তি, তরঙ্গ' },
        { subject: 'General Science', topic: 'রসায়ন - মৌল, যৌগ, অ্যাসিড-ক্ষার' },
        { subject: 'General Science', topic: 'জীববিজ্ঞান - কোষ, পোষণ, শ্বসন' },
        { subject: 'General Science', topic: 'পরিবেশ ও বাস্তুসংস্থান' },
        { subject: 'General Science', topic: 'প্রযুক্তি ও কম্পিউটার জ্ঞান' },
        { subject: 'Mathematics', topic: 'সংখ্যা পদ্ধতি ও সরলীকরণ' },
        { subject: 'Mathematics', topic: 'শতাংশ, অনুপাত ও সমানুপাত' },
        { subject: 'Mathematics', topic: 'লাভ-ক্ষতি, সুদ ও ছাড়' },
        { subject: 'Mathematics', topic: 'বীজগণিত ও সমীকরণ' },
        { subject: 'Mathematics', topic: 'জ্যামিতি ও ক্ষেত্রফল' },
        { subject: 'Reasoning', topic: 'লজিক্যাল রিজনিং - সিরিজ ও অ্যানালজি' },
        { subject: 'Reasoning', topic: 'ডেটা ইন্টারপ্রিটেশন' },
        { subject: 'Reasoning', topic: 'বসার বিন্যাস ও ধাঁধা' },
        { subject: 'Reasoning', topic: 'কোডিং-ডিকোডিং ও দিকনির্ণয়' },
    ],

    police_si: [
        { subject: 'General Knowledge', topic: 'ভারতের জাতীয় প্রতীক ও গুরুত্বপূর্ণ দিবস' },
        { subject: 'General Knowledge', topic: 'চলতি ঘটনা - জাতীয় ও আন্তর্জাতিক' },
        { subject: 'General Knowledge', topic: 'পুরস্কার ও সম্মান - ভারত এবং বিশ্ব' },
        { subject: 'General Knowledge', topic: 'খেলাধুলা ও বিজ্ঞান আবিষ্কার' },
        { subject: 'General Knowledge', topic: 'গুরুত্বপূর্ণ সংগঠন ও তাদের সদর দপ্তর' },
        { subject: 'Indian History', topic: 'প্রাচীন ও মধ্যযুগীয় ভারত' },
        { subject: 'Indian History', topic: 'ভারতের স্বাধীনতা আন্দোলন' },
        { subject: 'Indian History', topic: 'পশ্চিমবঙ্গের ইতিহাস' },
        { subject: 'Indian History', topic: 'বিশ্ব ইতিহাসের গুরুত্বপূর্ণ ঘটনা' },
        { subject: 'Geography', topic: 'ভারতের ভৌত ও রাজনৈতিক ভূগোল' },
        { subject: 'Geography', topic: 'নদী, পর্বত ও মালভূমি' },
        { subject: 'Geography', topic: 'পশ্চিমবঙ্গের ভৌগোলিক পরিচিতি' },
        { subject: 'Geography', topic: 'প্রাকৃতিক দুর্যোগ ও পরিবেশ' },
        { subject: 'Indian Polity', topic: 'ভারতীয় সংবিধান - মূল ধারা ও সংশোধন' },
        { subject: 'Indian Polity', topic: 'মৌলিক অধিকার ও নির্দেশমূলক নীতি' },
        { subject: 'Indian Polity', topic: 'পুলিশ আইন ও আইনি জ্ঞান (IPC, CrPC)' },
        { subject: 'Indian Polity', topic: 'গণতন্ত্র ও নির্বাচন প্রক্রিয়া' },
        { subject: 'General Science', topic: 'পদার্থবিদ্যা - মৌলিক সূত্র' },
        { subject: 'General Science', topic: 'রসায়ন ও জীববিজ্ঞান - মূল ধারণা' },
        { subject: 'General Science', topic: 'স্বাস্থ্য, রোগ ও পুষ্টি' },
        { subject: 'General Science', topic: 'পরিবেশ বিজ্ঞান' },
        { subject: 'Mathematics', topic: 'সংখ্যা পদ্ধতি ও LCM/HCF' },
        { subject: 'Mathematics', topic: 'শতাংশ, লাভ-ক্ষতি ও সুদ' },
        { subject: 'Mathematics', topic: 'সময়-দূরত্ব-কাজ' },
        { subject: 'Mathematics', topic: 'জ্যামিতি ও পরিমিতি' },
        { subject: 'Mathematics', topic: 'পরিসংখ্যান - গড়, মধ্যমা, ভরক' },
        { subject: 'Reasoning', topic: 'বিশ্লেষণমূলক যুক্তি ও সিলোজিজম' },
        { subject: 'Reasoning', topic: 'ডেটা বিশ্লেষণ ও সমস্যা সমাধান' },
        { subject: 'Reasoning', topic: 'বসার বিন্যাস ও রক্তের সম্পর্ক' },
        { subject: 'Reasoning', topic: 'কোডিং-ডিকোডিং ও দিকনির্ণয়' },
        { subject: 'Reasoning', topic: 'ভেন ডায়াগ্রাম ও ধাঁধা' },
        { subject: 'English', topic: 'Grammar - Tense, Voice & Narration' },
        { subject: 'English', topic: 'Vocabulary & Comprehension' },
        { subject: 'English', topic: 'Error Detection & Sentence Correction' },
        { subject: 'Bengali', topic: 'বাংলা ব্যাকরণ ও রচনা' },
        { subject: 'Bengali', topic: 'সাহিত্য পরিচিতি' },
    ],

    tet: [
        { subject: 'Child Development & Pedagogy', topic: 'শিশু বিকাশের তত্ত্ব - পিয়াজে, ভাইগটস্কি' },
        { subject: 'Child Development & Pedagogy', topic: 'শিক্ষাগত মনোবিজ্ঞান - শিক্ষার পদ্ধতি' },
        { subject: 'Child Development & Pedagogy', topic: 'শিক্ষার্থীর বৈচিত্র্য ও অন্তর্ভুক্তিমূলক শিক্ষা' },
        { subject: 'Child Development & Pedagogy', topic: 'মূল্যায়ন পদ্ধতি ও ধারাবাহিক মূল্যায়ন' },
        { subject: 'Child Development & Pedagogy', topic: 'আচরণবাদ, জ্ঞানতত্ত্ব ও শিক্ষার তত্ত্ব' },
        { subject: 'Child Development & Pedagogy', topic: 'বিশেষ শিশুদের শিক্ষা - গিফটেড ও লার্নিং ডিসেবিলিটি' },
        { subject: 'Child Development & Pedagogy', topic: 'শিক্ষার অধিকার আইন (RTE 2009)' },
        { subject: 'Child Development & Pedagogy', topic: 'সমালোচনামূলক চিন্তন ও সমস্যা সমাধান' },
        { subject: 'Bengali Language', topic: 'বাংলা ব্যাকরণ - বর্ণ, শব্দ ও বাক্য' },
        { subject: 'Bengali Language', topic: 'সন্ধি, সমাস, কারক ও বিভক্তি' },
        { subject: 'Bengali Language', topic: 'বিপরীত শব্দ, প্রতিশব্দ ও বাগধারা' },
        { subject: 'Bengali Language', topic: 'বাংলা ভাষা শিক্ষণ পদ্ধতি' },
        { subject: 'Bengali Language', topic: 'সাহিত্য পরিচিতি ও পাঠ বিশ্লেষণ' },
        { subject: 'Bengali Language', topic: 'শিশুসাহিত্য ও ছড়া' },
        { subject: 'English Language', topic: 'Grammar - Parts of Speech & Tense' },
        { subject: 'English Language', topic: 'Vocabulary, Synonyms & Antonyms' },
        { subject: 'English Language', topic: 'Reading Comprehension' },
        { subject: 'English Language', topic: 'Teaching Methods for English' },
        { subject: 'English Language', topic: 'Language Skills - Listening, Speaking, Reading, Writing' },
        { subject: 'Mathematics', topic: 'সংখ্যা পদ্ধতি ও স্থানীয় মান' },
        { subject: 'Mathematics', topic: 'চার প্রক্রিয়া ও ভগ্নাংশ' },
        { subject: 'Mathematics', topic: 'পরিমাপ - দৈর্ঘ্য, ভর, সময় ও অর্থ' },
        { subject: 'Mathematics', topic: 'জ্যামিতি - আকার ও প্যাটার্ন' },
        { subject: 'Mathematics', topic: 'তথ্য ব্যবস্থাপনা ও গণিত শিক্ষণ পদ্ধতি' },
        { subject: 'Mathematics', topic: 'গণিতের ভয় কাটানো ও শিক্ষার কৌশল' },
        { subject: 'Environmental Studies', topic: 'পরিবার, বাড়ি ও খাদ্য' },
        { subject: 'Environmental Studies', topic: 'উদ্ভিদ, প্রাণী ও পরিবেশ' },
        { subject: 'Environmental Studies', topic: 'আমাদের পশ্চিমবঙ্গ ও ভারত' },
        { subject: 'Environmental Studies', topic: 'পরিবেশ সংরক্ষণ ও দূষণ' },
        { subject: 'Environmental Studies', topic: 'EVS শিক্ষণ পদ্ধতি ও শ্রেণীকক্ষ কার্যাবলী' },
    ],

    group_d: [
        { subject: 'General Knowledge', topic: 'ভারতের ইতিহাস - মূল ঘটনাবলী' },
        { subject: 'General Knowledge', topic: 'ভারতের ভূগোল - নদী, পর্বত, রাজ্য' },
        { subject: 'General Knowledge', topic: 'ভারতীয় সংবিধান ও রাজনীতি' },
        { subject: 'General Knowledge', topic: 'চলতি ঘটনা ও সাধারণ জ্ঞান' },
        { subject: 'General Knowledge', topic: 'বিজ্ঞান ও প্রযুক্তি - দৈনন্দিন জীবন' },
        { subject: 'Mathematics', topic: 'সংখ্যা পদ্ধতি, LCM ও HCF' },
        { subject: 'Mathematics', topic: 'শতাংশ, অনুপাত ও মিশ্রণ' },
        { subject: 'Mathematics', topic: 'সময়, দূরত্ব ও কাজ' },
        { subject: 'Mathematics', topic: 'লাভ-ক্ষতি ও সরল সুদ' },
        { subject: 'Mathematics', topic: 'ক্ষেত্রফল ও আয়তন' },
        { subject: 'Reasoning', topic: 'সংখ্যা ও অক্ষর সিরিজ' },
        { subject: 'Reasoning', topic: 'অ্যানালজি ও শ্রেণীবিভাগ' },
        { subject: 'Reasoning', topic: 'কোডিং-ডিকোডিং ও দিকনির্ণয়' },
        { subject: 'Reasoning', topic: 'রক্তের সম্পর্ক ও ক্যালেন্ডার' },
        { subject: 'Reasoning', topic: 'মিরর ইমেজ ও ভেঞ্চ ডায়াগ্রাম' },
        { subject: 'General Science', topic: 'পদার্থবিদ্যা - মূল সূত্র ও প্রয়োগ' },
        { subject: 'General Science', topic: 'রসায়ন - মৌল, যৌগ ও বিক্রিয়া' },
        { subject: 'General Science', topic: 'জীববিজ্ঞান - মানবদেহ ও রোগ' },
        { subject: 'General Science', topic: 'পরিবেশ বিজ্ঞান ও বাস্তুতন্ত্র' },
        { subject: 'Bengali & English', topic: 'বাংলা ব্যাকরণ - বর্ণ, শব্দ, বাক্য' },
        { subject: 'Bengali & English', topic: 'English Grammar - Basic Rules' },
        { subject: 'Bengali & English', topic: 'পত্রলিখন ও রচনা সংক্ষেপ' },
    ],
};

// ─── Plan generation ──────────────────────────────────────────────────────────

function generateTasks(planId, examType, examDate, dailyHours, weakSubjects) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const exam = new Date(examDate);
    exam.setHours(0, 0, 0, 0);

    const totalDays = Math.ceil((exam - today) / (1000 * 60 * 60 * 24));
    if (totalDays <= 0) return [];

    const syllabus = SYLLABI[examType] || SYLLABI['wbcs'];

    // Weak subjects: duplicate topics 2x
    const weakSet = new Set((weakSubjects || []).map(s => s.toLowerCase().trim()));
    const topicPool = [];
    for (const item of syllabus) {
        topicPool.push(item);
        if (weakSet.has(item.subject.toLowerCase())) {
            topicPool.push({ subject: item.subject, topic: item.topic + ' (অতিরিক্ত অনুশীলন)' });
        }
    }

    const sessionsPerDay = Math.max(1, Math.floor((dailyHours * 60) / 45));
    const tasks = [];
    let topicIndex = 0;

    for (let d = 1; d <= totalDays; d++) {
        const date = new Date(today);
        date.setDate(today.getDate() + d);
        const dateStr = date.toISOString().slice(0, 10);

        if (d % 10 === 0) {
            // Revision day (higher priority than mock)
            tasks.push({
                id: randomUUID(),
                plan_id: planId,
                task_date: dateStr,
                task_type: 'revision',
                subject: 'All Subjects',
                topic: 'সম্পূর্ণ সিলেবাস পুনরালোচনা',
                duration_minutes: Math.min(dailyHours * 60, 180),
            });
        } else if (d % 6 === 0) {
            // Mock test day
            tasks.push({
                id: randomUUID(),
                plan_id: planId,
                task_date: dateStr,
                task_type: 'mock',
                subject: null,
                topic: 'মক টেস্ট',
                duration_minutes: 120,
            });
        } else {
            // Regular study day
            for (let s = 0; s < sessionsPerDay; s++) {
                const item = topicPool[topicIndex % topicPool.length];
                topicIndex++;
                tasks.push({
                    id: randomUUID(),
                    plan_id: planId,
                    task_date: dateStr,
                    task_type: 'topic',
                    subject: item.subject,
                    topic: item.topic,
                    duration_minutes: 45,
                });
            }
        }
    }

    return tasks;
}

// ─── Streak update helper ─────────────────────────────────────────────────────

function recalcStreak(planId) {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    let streakRow = qOne('SELECT * FROM plan_streaks WHERE plan_id = ?', [planId]);
    if (!streakRow) {
        const newId = randomUUID();
        run('INSERT INTO plan_streaks (id, plan_id, current_streak, longest_streak) VALUES (?, ?, 0, 0)', [newId, planId]);
        streakRow = qOne('SELECT * FROM plan_streaks WHERE plan_id = ?', [planId]);
    }

    // Check if any task was completed yesterday
    const completedYesterday = qOne(
        `SELECT id FROM plan_tasks WHERE plan_id = ? AND completed_at LIKE ? AND is_completed = 1 LIMIT 1`,
        [planId, `${yesterday}%`]
    );

    let current = completedYesterday ? (streakRow.current_streak + 1) : 1;
    const longest = Math.max(current, streakRow.longest_streak);

    run(
        'UPDATE plan_streaks SET current_streak = ?, longest_streak = ?, last_active_date = ? WHERE plan_id = ?',
        [current, longest, today, planId]
    );
    return { current_streak: current, longest_streak: longest };
}

// ─── Helper: parse plan row ───────────────────────────────────────────────────

function parsePlan(row) {
    if (!row) return null;
    return { ...row, weak_subjects: JSON.parse(row.weak_subjects || '[]') };
}

// ─── PLAN MANAGEMENT ─────────────────────────────────────────────────────────

/**
 * POST /api/plan/create
 */
router.post('/plan/create', (req, res) => {
    const { user_id, exam_type, exam_date, daily_hours, weak_subjects } = req.body;

    if (!user_id || !exam_type || !exam_date || !daily_hours) {
        return res.status(400).json({ success: false, error: 'user_id, exam_type, exam_date, daily_hours required' });
    }

    if (!SYLLABI[exam_type]) {
        return res.status(400).json({
            success: false,
            error: `Invalid exam_type. Allowed: ${Object.keys(SYLLABI).join(', ')}`,
        });
    }

    const examDateObj = new Date(exam_date);
    if (isNaN(examDateObj.getTime()) || examDateObj <= new Date()) {
        return res.status(400).json({ success: false, error: 'exam_date must be a valid future date' });
    }

    const planId  = randomUUID();
    const now     = new Date().toISOString();
    const weakArr = Array.isArray(weak_subjects) ? weak_subjects : [];

    run(
        `INSERT INTO amar_plan (id, user_id, exam_type, exam_date, daily_hours, weak_subjects, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [planId, user_id, exam_type, exam_date, Number(daily_hours), JSON.stringify(weakArr), now, now]
    );

    // Create streak entry
    run('INSERT INTO plan_streaks (id, plan_id, current_streak, longest_streak) VALUES (?, ?, 0, 0)',
        [randomUUID(), planId]);

    // Generate and insert tasks
    const tasks = generateTasks(planId, exam_type, exam_date, Number(daily_hours), weakArr);
    if (tasks.length > 0) {
        runMany(tasks.map(t => ({
            sql: `INSERT INTO plan_tasks (id, plan_id, task_date, task_type, subject, topic, duration_minutes, is_completed, is_rescheduled)
                  VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)`,
            params: [t.id, t.plan_id, t.task_date, t.task_type, t.subject ?? null, t.topic ?? null, t.duration_minutes ?? null],
        })));
    }

    const plan = parsePlan(qOne('SELECT * FROM amar_plan WHERE id = ?', [planId]));
    const today = new Date().toISOString().slice(0, 10);
    const todayTasks = qAll('SELECT * FROM plan_tasks WHERE plan_id = ? AND task_date = ? ORDER BY id', [planId, today]);

    res.status(201).json({ success: true, plan, today_tasks: todayTasks, total_tasks: tasks.length });
});

/**
 * GET /api/plan/:user_id
 */
router.get('/plan/:user_id', (req, res) => {
    const plan = parsePlan(
        qOne('SELECT * FROM amar_plan WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', [req.params.user_id])
    );
    if (!plan) return res.status(404).json({ success: false, error: 'No plan found for this user' });

    const today = new Date().toISOString().slice(0, 10);
    const todayTasks = qAll('SELECT * FROM plan_tasks WHERE plan_id = ? AND task_date = ? ORDER BY id', [plan.id, today]);
    const streak = qOne('SELECT * FROM plan_streaks WHERE plan_id = ?', [plan.id]);

    res.json({ success: true, plan, today_tasks: todayTasks, streak });
});

/**
 * PUT /api/plan/:plan_id/reschedule
 */
router.put('/plan/:plan_id/reschedule', (req, res) => {
    const { plan_id } = req.params;
    const plan = parsePlan(qOne('SELECT * FROM amar_plan WHERE id = ?', [plan_id]));
    if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });

    const today = new Date().toISOString().slice(0, 10);

    // Find incomplete non-mock tasks before today
    const overdueTasks = qAll(
        `SELECT * FROM plan_tasks WHERE plan_id = ? AND task_date < ? AND is_completed = 0 AND task_type != 'mock'
         ORDER BY task_date`,
        [plan_id, today]
    );

    if (overdueTasks.length === 0) {
        return res.json({ success: true, rescheduled: 0, message: 'No overdue tasks found' });
    }

    // Find the exam date to cap redistribution
    const examDate = plan.exam_date;
    const sessionsPerDay = Math.max(1, Math.floor((plan.daily_hours * 60) / 45));

    // Get current load per future date
    const futureTasks = qAll(
        `SELECT task_date, COUNT(*) as cnt FROM plan_tasks
         WHERE plan_id = ? AND task_date >= ? AND is_completed = 0 AND task_type = 'topic'
         GROUP BY task_date`,
        [plan_id, today]
    );
    const loadMap = {};
    for (const row of futureTasks) loadMap[row.task_date] = Number(row.cnt);

    // Walk days from tomorrow forward and fill available slots
    let dayOffset = 1;
    const updates = [];

    for (const task of overdueTasks) {
        // Find next available date with a free slot
        while (true) {
            const candidate = new Date(Date.now() + dayOffset * 86400000).toISOString().slice(0, 10);
            if (candidate >= examDate) break; // Don't schedule past exam
            const currentLoad = loadMap[candidate] || 0;
            if (currentLoad < sessionsPerDay) {
                loadMap[candidate] = currentLoad + 1;
                updates.push({ id: task.id, date: candidate });
                break;
            }
            dayOffset++;
        }
    }

    if (updates.length > 0) {
        runMany(updates.map(u => ({
            sql: 'UPDATE plan_tasks SET task_date = ?, is_rescheduled = 1 WHERE id = ?',
            params: [u.date, u.id],
        })));
    }

    // Update plan updated_at
    run('UPDATE amar_plan SET updated_at = ? WHERE id = ?', [new Date().toISOString(), plan_id]);

    res.json({ success: true, rescheduled: updates.length });
});

/**
 * DELETE /api/plan/:plan_id
 */
router.delete('/plan/:plan_id', (req, res) => {
    const plan = qOne('SELECT id FROM amar_plan WHERE id = ?', [req.params.plan_id]);
    if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });

    // Delete in dependency order
    run('DELETE FROM plan_mock_scores WHERE plan_id = ?', [req.params.plan_id]);
    run('DELETE FROM plan_streaks WHERE plan_id = ?', [req.params.plan_id]);
    run('DELETE FROM plan_tasks WHERE plan_id = ?', [req.params.plan_id]);
    run('DELETE FROM amar_plan WHERE id = ?', [req.params.plan_id]);

    res.json({ success: true });
});

// ─── TASK MANAGEMENT ─────────────────────────────────────────────────────────

/**
 * GET /api/plan/:plan_id/tasks
 * Returns all tasks grouped by week number
 */
router.get('/plan/:plan_id/tasks', (req, res) => {
    const plan = qOne('SELECT * FROM amar_plan WHERE id = ?', [req.params.plan_id]);
    if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });

    const tasks = qAll('SELECT * FROM plan_tasks WHERE plan_id = ? ORDER BY task_date, id', [req.params.plan_id]);

    if (tasks.length === 0) return res.json({ success: true, weeks: [] });

    const firstDate = new Date(tasks[0].task_date);
    firstDate.setHours(0, 0, 0, 0);

    const weekMap = {};
    for (const task of tasks) {
        const taskDate = new Date(task.task_date);
        taskDate.setHours(0, 0, 0, 0);
        const weekNum = Math.floor((taskDate - firstDate) / (7 * 86400000)) + 1;
        if (!weekMap[weekNum]) weekMap[weekNum] = [];
        weekMap[weekNum].push({ ...task, is_completed: Boolean(task.is_completed), is_rescheduled: Boolean(task.is_rescheduled) });
    }

    const weeks = Object.entries(weekMap).map(([week, items]) => ({
        week: Number(week),
        tasks: items,
    }));

    res.json({ success: true, weeks });
});

/**
 * GET /api/plan/:plan_id/tasks/today
 */
router.get('/plan/:plan_id/tasks/today', (req, res) => {
    const plan = qOne('SELECT id FROM amar_plan WHERE id = ?', [req.params.plan_id]);
    if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });

    const today = new Date().toISOString().slice(0, 10);
    const tasks = qAll('SELECT * FROM plan_tasks WHERE plan_id = ? AND task_date = ? ORDER BY id', [req.params.plan_id, today]);

    res.json({ success: true, date: today, tasks: tasks.map(t => ({ ...t, is_completed: Boolean(t.is_completed), is_rescheduled: Boolean(t.is_rescheduled) })) });
});

/**
 * GET /api/plan/:plan_id/tasks/:date
 */
router.get('/plan/:plan_id/tasks/:date', (req, res) => {
    const plan = qOne('SELECT id FROM amar_plan WHERE id = ?', [req.params.plan_id]);
    if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });

    const tasks = qAll('SELECT * FROM plan_tasks WHERE plan_id = ? AND task_date = ? ORDER BY id',
        [req.params.plan_id, req.params.date]);

    res.json({ success: true, date: req.params.date, tasks: tasks.map(t => ({ ...t, is_completed: Boolean(t.is_completed), is_rescheduled: Boolean(t.is_rescheduled) })) });
});

/**
 * PATCH /api/plan/:plan_id/tasks/:task_id/complete
 */
router.patch('/plan/:plan_id/tasks/:task_id/complete', (req, res) => {
    const task = qOne('SELECT * FROM plan_tasks WHERE id = ? AND plan_id = ?', [req.params.task_id, req.params.plan_id]);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

    if (task.is_completed) {
        return res.json({ success: true, message: 'Already completed', task: { ...task, is_completed: true } });
    }

    const now = new Date().toISOString();
    run('UPDATE plan_tasks SET is_completed = 1, completed_at = ? WHERE id = ?', [now, task.id]);

    const streak = recalcStreak(req.params.plan_id);
    const updated = qOne('SELECT * FROM plan_tasks WHERE id = ?', [task.id]);

    res.json({ success: true, task: { ...updated, is_completed: Boolean(updated.is_completed) }, streak });
});

/**
 * PATCH /api/plan/:plan_id/tasks/:task_id/uncomplete
 */
router.patch('/plan/:plan_id/tasks/:task_id/uncomplete', (req, res) => {
    const task = qOne('SELECT * FROM plan_tasks WHERE id = ? AND plan_id = ?', [req.params.task_id, req.params.plan_id]);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

    run('UPDATE plan_tasks SET is_completed = 0, completed_at = NULL WHERE id = ?', [task.id]);

    const updated = qOne('SELECT * FROM plan_tasks WHERE id = ?', [task.id]);
    res.json({ success: true, task: { ...updated, is_completed: false } });
});

// ─── PROGRESS & STATS ─────────────────────────────────────────────────────────

/**
 * GET /api/plan/:plan_id/progress
 * Subject-wise completion ring data
 */
router.get('/plan/:plan_id/progress', (req, res) => {
    const plan = parsePlan(qOne('SELECT * FROM amar_plan WHERE id = ?', [req.params.plan_id]));
    if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });

    const tasks = qAll(
        `SELECT subject, is_completed FROM plan_tasks WHERE plan_id = ? AND task_type = 'topic'`,
        [req.params.plan_id]
    );

    const weakSet = new Set(plan.weak_subjects.map(s => s.toLowerCase().trim()));
    const subjectMap = {};

    for (const task of tasks) {
        const subj = task.subject || 'Other';
        if (!subjectMap[subj]) subjectMap[subj] = { total: 0, completed: 0 };
        subjectMap[subj].total++;
        if (task.is_completed) subjectMap[subj].completed++;
    }

    const rings = Object.entries(subjectMap).map(([subject, data]) => ({
        subject,
        total_tasks: data.total,
        completed_tasks: data.completed,
        percent: data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0,
        is_weak: weakSet.has(subject.toLowerCase()),
    }));

    res.json({ success: true, rings });
});

/**
 * GET /api/plan/:plan_id/streak
 */
router.get('/plan/:plan_id/streak', (req, res) => {
    const plan = qOne('SELECT id FROM amar_plan WHERE id = ?', [req.params.plan_id]);
    if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });

    const streak = qOne('SELECT * FROM plan_streaks WHERE plan_id = ?', [req.params.plan_id])
        || { current_streak: 0, longest_streak: 0, last_active_date: null };

    res.json({ success: true, ...streak });
});

/**
 * GET /api/plan/:plan_id/countdown
 */
router.get('/plan/:plan_id/countdown', (req, res) => {
    const plan = qOne('SELECT exam_date FROM amar_plan WHERE id = ?', [req.params.plan_id]);
    if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const exam = new Date(plan.exam_date);
    exam.setHours(0, 0, 0, 0);
    const days_remaining = Math.max(0, Math.ceil((exam - today) / 86400000));

    res.json({ success: true, exam_date: plan.exam_date, days_remaining });
});

/**
 * GET /api/plan/:plan_id/mock-scores
 */
router.get('/plan/:plan_id/mock-scores', (req, res) => {
    const plan = qOne('SELECT id FROM amar_plan WHERE id = ?', [req.params.plan_id]);
    if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });

    const scores = qAll('SELECT * FROM plan_mock_scores WHERE plan_id = ? ORDER BY taken_at DESC', [req.params.plan_id]);
    res.json({ success: true, scores });
});

/**
 * POST /api/plan/:plan_id/mock-scores
 */
router.post('/plan/:plan_id/mock-scores', (req, res) => {
    const plan = qOne('SELECT id FROM amar_plan WHERE id = ?', [req.params.plan_id]);
    if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });

    const { task_id, score, total_marks } = req.body;
    if (score === undefined || total_marks === undefined) {
        return res.status(400).json({ success: false, error: 'score and total_marks required' });
    }

    const id = randomUUID();
    const takenAt = new Date().toISOString();
    run(
        'INSERT INTO plan_mock_scores (id, plan_id, task_id, score, total_marks, taken_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, req.params.plan_id, task_id || null, Number(score), Number(total_marks), takenAt]
    );

    res.status(201).json({ success: true, score: qOne('SELECT * FROM plan_mock_scores WHERE id = ?', [id]) });
});

/**
 * GET /api/plan/:plan_id/share-data
 */
router.get('/plan/:plan_id/share-data', (req, res) => {
    const plan = parsePlan(qOne('SELECT * FROM amar_plan WHERE id = ?', [req.params.plan_id]));
    if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const exam = new Date(plan.exam_date);
    exam.setHours(0, 0, 0, 0);
    const days_remaining = Math.max(0, Math.ceil((exam - today) / 86400000));

    const all = qOne(
        `SELECT COUNT(*) as total, SUM(is_completed) as done FROM plan_tasks WHERE plan_id = ? AND task_type = 'topic'`,
        [plan.id]
    );
    const percent_done = all && all.total > 0 ? Math.round((all.done / all.total) * 100) : 0;

    const streak = qOne('SELECT current_streak FROM plan_streaks WHERE plan_id = ?', [plan.id]);

    const EXAM_LABELS = {
        wbcs: 'WBCS',
        police_si: 'WBP SI',
        tet: 'WB Primary TET',
        group_d: 'Group D',
    };

    res.json({
        success: true,
        exam_name: EXAM_LABELS[plan.exam_type] || plan.exam_type,
        exam_date: plan.exam_date,
        days_remaining,
        percent_done,
        current_streak: streak?.current_streak || 0,
    });
});

export default router;
