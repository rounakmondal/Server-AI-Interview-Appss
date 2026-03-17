/**
 * examDb.js — Query helpers + seed data for the Exam Prep module.
 * Uses the same sql.js SQLite database as the rest of the app.
 */

import { getDb } from './db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = path.join(__dirname, '../data/interview.db');

// ─── Internal helpers ────────────────────────────────────────────────────────

function saveDatabase() {
    const db = getDb();
    if (db) {
        const data = db.export();
        fs.writeFileSync(DB_PATH, Buffer.from(data));
    }
}

function queryAll(sql, params = []) {
    const db   = getDb();
    const stmt = db.prepare(sql);
    if (params.length) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
}

function queryOne(sql, params = []) {
    const db   = getDb();
    const stmt = db.prepare(sql);
    if (params.length) stmt.bind(params);
    let row = null;
    if (stmt.step()) row = stmt.getAsObject();
    stmt.free();
    return row;
}

// Returns last inserted rowid after the write
function execute(sql, params = []) {
    const db = getDb();
    if (params.length) {
        db.run(sql, params);
    } else {
        db.run(sql);
    }
    const stmt = db.prepare('SELECT last_insert_rowid() as id');
    stmt.step();
    const { id } = stmt.getAsObject();
    stmt.free();
    saveDatabase();
    return Number(id);
}

// ─── Exam & Syllabus ──────────────────────────────────────────────────────────

export const examQueries = {
    listAll: ()   => queryAll('SELECT * FROM exams ORDER BY id'),
    getById: (id) => queryOne('SELECT * FROM exams WHERE id = ?', [id]),
};

export const subjectQueries = {
    byExam:  (examId)    => queryAll('SELECT * FROM subjects WHERE exam_id = ? ORDER BY sort_order, id', [examId]),
    getById: (subjectId) => queryOne('SELECT * FROM subjects WHERE id = ?', [subjectId]),
};

export const chapterQueries = {
    bySubject: (subjectId) =>
        queryAll('SELECT * FROM chapters WHERE subject_id = ? ORDER BY sort_order, id', [subjectId]),
    getById: (id) =>
        queryOne('SELECT * FROM chapters WHERE id = ?', [id]),
    countBySubject: (subjectId) =>
        queryOne('SELECT COUNT(*) AS cnt FROM chapters WHERE subject_id = ?', [subjectId]),
};

export const topicQueries = {
    byChapter: (chapterId) =>
        queryAll('SELECT * FROM topics WHERE chapter_id = ? ORDER BY id', [chapterId]),
};

// ─── User Exam Preference ─────────────────────────────────────────────────────

export const preferenceQueries = {
    upsert: (userId, examId, examDate) => {
        const db = getDb();
        db.run(
            `INSERT INTO user_exam_preferences (user_id, exam_id, exam_date)
             VALUES (?, ?, ?)
             ON CONFLICT(user_id, exam_id) DO UPDATE SET exam_date = excluded.exam_date`,
            [userId, examId, examDate || null]
        );
        saveDatabase();
    },
    byUser: (userId) => queryAll(
        `SELECT p.*, e.name AS exam_name, e.name_bn AS exam_name_bn, e.slug
         FROM user_exam_preferences p
         JOIN exams e ON p.exam_id = e.id
         WHERE p.user_id = ?
         ORDER BY p.created_at DESC`,
        [userId]
    ),
};

// ─── Progress ─────────────────────────────────────────────────────────────────

export const progressQueries = {
    fullTree: (userId, examId) => queryAll(
        `SELECT s.id   AS subject_id,   s.name    AS subject_name, s.name_bn AS subject_name_bn,
                c.id   AS chapter_id,   c.name    AS chapter_name,  c.name_bn AS chapter_name_bn,
                c.pass_mark,
                COALESCE(ucp.status, 'not_started') AS status,
                ucp.last_score, ucp.attempt_count,  ucp.updated_at
         FROM subjects s
         JOIN chapters c ON c.subject_id = s.id
         LEFT JOIN user_chapter_progress ucp
               ON ucp.chapter_id = c.id AND ucp.user_id = ?
         WHERE s.exam_id = ?
         ORDER BY s.sort_order, s.id, c.sort_order, c.id`,
        [userId, examId]
    ),

    summary: (userId, examId) => queryAll(
        `SELECT s.id, s.name, s.name_bn,
                COUNT(c.id)                                    AS total,
                SUM(CASE WHEN ucp.status = 'done'        THEN 1 ELSE 0 END) AS done,
                SUM(CASE WHEN ucp.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress
         FROM subjects s
         JOIN chapters c ON c.subject_id = s.id
         LEFT JOIN user_chapter_progress ucp
               ON ucp.chapter_id = c.id AND ucp.user_id = ?
         WHERE s.exam_id = ?
         GROUP BY s.id
         ORDER BY s.sort_order`,
        [userId, examId]
    ),

    byUserChapter: (userId, chapterId) =>
        queryOne('SELECT * FROM user_chapter_progress WHERE user_id = ? AND chapter_id = ?', [userId, chapterId]),

    upsert: (userId, chapterId, status, lastScore) => {
        const db = getDb();
        db.run(
            `INSERT INTO user_chapter_progress (user_id, chapter_id, status, last_score, attempt_count, updated_at)
             VALUES (?, ?, ?, ?, 1, datetime('now'))
             ON CONFLICT(user_id, chapter_id) DO UPDATE SET
                 status        = excluded.status,
                 last_score    = excluded.last_score,
                 attempt_count = attempt_count + 1,
                 updated_at    = datetime('now')`,
            [userId, chapterId, status, lastScore]
        );
        saveDatabase();
    },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

export const questionQueries = {
    randomByChapter: (chapterId, limit) =>
        queryAll('SELECT * FROM questions WHERE chapter_id = ? ORDER BY RANDOM() LIMIT ?', [chapterId, limit]),
    getById: (id) =>
        queryOne('SELECT * FROM questions WHERE id = ?', [id]),
    countByChapter: (chapterId) =>
        queryOne('SELECT COUNT(*) AS cnt FROM questions WHERE chapter_id = ?', [chapterId]),
};

export const testAttemptQueries = {
    create: (userId, chapterId, score, total, correct, timeSecs) =>
        execute(
            `INSERT INTO user_test_attempts (user_id, chapter_id, score, total_questions, correct, time_taken_secs)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [userId, chapterId, score, total, correct, timeSecs || null]
        ),
    byUserChapter: (userId, chapterId) =>
        queryAll(
            'SELECT * FROM user_test_attempts WHERE user_id = ? AND chapter_id = ? ORDER BY created_at DESC',
            [userId, chapterId]
        ),
};

export const testAnswerQueries = {
    bulkInsert: (attemptId, answers) => {
        const db = getDb();
        for (const a of answers) {
            db.run(
                `INSERT INTO user_test_answers (attempt_id, question_id, selected_option, is_correct)
                 VALUES (?, ?, ?, ?)`,
                [attemptId, a.questionId, a.selectedOption, a.isCorrect ? 1 : 0]
            );
        }
        saveDatabase();
    },
};

// ─── Study Plan ───────────────────────────────────────────────────────────────

export const studyPlanQueries = {
    saveAi: (userId, examId, examDate, hoursPerDay, planJson) =>
        execute(
            `INSERT INTO study_plans_ai (user_id, exam_id, exam_date, hours_per_day, plan_json)
             VALUES (?, ?, ?, ?, ?)`,
            [userId, examId, examDate || null, hoursPerDay, JSON.stringify(planJson)]
        ),

    latestAi: (userId, examId) =>
        queryOne(
            `SELECT * FROM study_plans_ai
             WHERE user_id = ? AND exam_id = ?
             ORDER BY created_at DESC LIMIT 1`,
            [userId, examId]
        ),

    template: (examId) =>
        queryAll(
            `SELECT spt.*,
                    s.name    AS subject_name, s.name_bn AS subject_name_bn,
                    c.name    AS chapter_name, c.name_bn AS chapter_name_bn
             FROM study_plan_templates spt
             LEFT JOIN subjects s ON spt.subject_id = s.id
             LEFT JOIN chapters c ON spt.chapter_id = c.id
             WHERE spt.exam_id = ?
             ORDER BY spt.phase, spt.week_number, spt.id`,
            [examId]
        ),
};

// ─── Seed exam data (runs once after DB init) ─────────────────────────────────

export function seedExamData() {
    const existing = queryOne('SELECT id FROM exams LIMIT 1');
    if (existing) return; // already seeded

    const db = getDb();

    // ── Exams ──────────────────────────────────────────────────────────────────
    const EXAMS = [
        ['WBCS',             'ডব্লিউবিসিএস',              'wbcs'],
        ['WBPSC Clerkship',  'ডব্লিউবিপিএসসি ক্লার্কশিপ',  'wbpsc'],
        ['WB Police SI',     'পশ্চিমবঙ্গ পুলিশ এসআই',     'wb-police-si'],
        ['SSC CGL',          'এসএসসি সিজিএল',              'ssc-cgl'],
        ['Banking IBPS/SBI', 'ব্যাংকিং আইবিপিএস/এসবিআই',  'banking-ibps-sbi'],
    ];
    for (const [name, nameBn, slug] of EXAMS) {
        db.run('INSERT INTO exams (name, name_bn, slug) VALUES (?, ?, ?)', [name, nameBn, slug]);
    }

    const examRows = queryAll('SELECT id, slug FROM exams');
    const eid = {};
    for (const r of examRows) eid[r.slug] = r.id;

    // ── Subjects ───────────────────────────────────────────────────────────────
    const SUBJECTS = [
        // WBCS
        ['wbcs', 'General Studies',              'সাধারণ জ্ঞান',               1],
        ['wbcs', 'Bengali',                      'বাংলা',                       2],
        ['wbcs', 'English',                      'ইংরেজি',                      3],
        ['wbcs', 'Arithmetic',                   'পাটিগণিত',                    4],
        ['wbcs', 'General Science',              'সাধারণ বিজ্ঞান',             5],
        // WBPSC
        ['wbpsc', 'General Intelligence',        'সাধারণ বুদ্ধিমত্তা',         1],
        ['wbpsc', 'Numerical Aptitude',          'সংখ্যাসংক্রান্ত দক্ষতা',     2],
        ['wbpsc', 'Language (English)',          'ইংরেজি ভাষা',                3],
        ['wbpsc', 'General Awareness',           'সাধারণ সচেতনতা',             4],
        // WB Police SI
        ['wb-police-si', 'General Knowledge & Current Affairs', 'সাধারণ জ্ঞান ও সমসাময়িক', 1],
        ['wb-police-si', 'Reasoning',            'যুক্তি',                      2],
        ['wb-police-si', 'Mathematics',          'গণিত',                        3],
        ['wb-police-si', 'English',              'ইংরেজি',                      4],
        // SSC CGL
        ['ssc-cgl', 'Quantitative Aptitude',              'পরিমাণগত যোগ্যতা',            1],
        ['ssc-cgl', 'General Intelligence & Reasoning',   'সাধারণ বুদ্ধিমত্তা ও যুক্তি', 2],
        ['ssc-cgl', 'General Awareness',                  'সাধারণ সচেতনতা',              3],
        ['ssc-cgl', 'English Language',                   'ইংরেজি ভাষা',                 4],
        // Banking IBPS/SBI
        ['banking-ibps-sbi', 'Quantitative Aptitude',         'পরিমাণগত যোগ্যতা',        1],
        ['banking-ibps-sbi', 'Reasoning Ability',             'যুক্তি দক্ষতা',            2],
        ['banking-ibps-sbi', 'English Language',              'ইংরেজি ভাষা',              3],
        ['banking-ibps-sbi', 'General & Financial Awareness', 'সাধারণ ও আর্থিক সচেতনতা', 4],
        ['banking-ibps-sbi', 'Computer Aptitude',             'কম্পিউটার দক্ষতা',         5],
    ];
    for (const [slug, name, nameBn, order] of SUBJECTS) {
        db.run('INSERT INTO subjects (exam_id, name, name_bn, sort_order) VALUES (?, ?, ?, ?)',
            [eid[slug], name, nameBn, order]);
    }

    const subjectRows = queryAll('SELECT id, exam_id, name FROM subjects');
    const sid = {};
    for (const r of subjectRows) sid[`${r.exam_id}:${r.name}`] = r.id;
    const S = (slug, name) => sid[`${eid[slug]}:${name}`];

    // ── Chapters ───────────────────────────────────────────────────────────────
    const CHAPTERS = [
        // WBCS > General Studies
        [S('wbcs','General Studies'), 'History of India',               'ভারতের ইতিহাস',               1, 60],
        [S('wbcs','General Studies'), 'Indian Polity & Constitution',   'ভারতীয় রাজনীতি ও সংবিধান',  2, 60],
        [S('wbcs','General Studies'), 'Indian Geography',               'ভারতীয় ভূগোল',               3, 60],
        [S('wbcs','General Studies'), 'Indian Economy',                 'ভারতীয় অর্থনীতি',            4, 60],
        [S('wbcs','General Studies'), 'Current Affairs',                'সমসাময়িক ঘটনা',              5, 60],
        // WBCS > Bengali
        [S('wbcs','Bengali'), 'Bengali Grammar',                        'বাংলা ব্যাকরণ',               1, 60],
        [S('wbcs','Bengali'), 'Comprehension (Bengali)',                'বাংলা বোধগম্যতা',             2, 60],
        [S('wbcs','Bengali'), 'Vocabulary (Bengali)',                   'বাংলা শব্দভাণ্ডার',           3, 60],
        // WBCS > English
        [S('wbcs','English'), 'Grammar & Usage',                        'ব্যাকরণ ও ব্যবহার',          1, 60],
        [S('wbcs','English'), 'Synonyms & Antonyms',                    'সমার্থক ও বিপরীত শব্দ',      2, 60],
        [S('wbcs','English'), 'Reading Comprehension',                  'পাঠ বোধগম্যতা',              3, 60],
        [S('wbcs','English'), 'Fill in the Blanks',                     'শূন্যস্থান পূরণ',             4, 60],
        // WBCS > Arithmetic
        [S('wbcs','Arithmetic'), 'Number System',                       'সংখ্যা পদ্ধতি',              1, 60],
        [S('wbcs','Arithmetic'), 'Percentage, Profit & Loss',           'শতাংশ, লাভ ও ক্ষতি',        2, 60],
        [S('wbcs','Arithmetic'), 'Simple & Compound Interest',         'সরল ও যৌগিক সুদ',            3, 60],
        [S('wbcs','Arithmetic'), 'Time, Speed & Distance',             'সময়, গতি ও দূরত্ব',         4, 60],
        [S('wbcs','Arithmetic'), 'Ratio & Proportion',                  'অনুপাত ও সমানুপাত',          5, 60],
        // WBCS > General Science
        [S('wbcs','General Science'), 'Physics',                        'পদার্থবিজ্ঞান',              1, 60],
        [S('wbcs','General Science'), 'Chemistry',                      'রসায়ন',                      2, 60],
        [S('wbcs','General Science'), 'Biology',                        'জীববিজ্ঞান',                 3, 60],
        [S('wbcs','General Science'), 'Environment & Ecology',          'পরিবেশ ও বাস্তুতন্ত্র',     4, 60],
        // WBPSC > General Intelligence
        [S('wbpsc','General Intelligence'), 'Analogies',                'সাদৃশ্য',                    1, 60],
        [S('wbpsc','General Intelligence'), 'Classification',           'শ্রেণীবিভাগ',                2, 60],
        [S('wbpsc','General Intelligence'), 'Series Completion',        'ধারাবাহিক সম্পূর্ণ করা',    3, 60],
        [S('wbpsc','General Intelligence'), 'Coding-Decoding',          'কোড-ডিকোড',                  4, 60],
        // WBPSC > Numerical
        [S('wbpsc','Numerical Aptitude'), 'Number System',              'সংখ্যা পদ্ধতি',              1, 60],
        [S('wbpsc','Numerical Aptitude'), 'Percentage & Ratio',         'শতাংশ ও অনুপাত',            2, 60],
        [S('wbpsc','Numerical Aptitude'), 'Time & Work',                'সময় ও কাজ',                  3, 60],
        // WBPSC > Language
        [S('wbpsc','Language (English)'), 'Grammar',                    'ব্যাকরণ',                    1, 60],
        [S('wbpsc','Language (English)'), 'Vocabulary',                 'শব্দভাণ্ডার',                2, 60],
        // WBPSC > General Awareness
        [S('wbpsc','General Awareness'), 'Current Affairs',             'সমসাময়িক ঘটনা',             1, 60],
        [S('wbpsc','General Awareness'), 'Static General Knowledge',    'স্থায়ী সাধারণ জ্ঞান',      2, 60],
        // Police SI > GK
        [S('wb-police-si','General Knowledge & Current Affairs'), 'History & Culture',      'ইতিহাস ও সংস্কৃতি', 1, 60],
        [S('wb-police-si','General Knowledge & Current Affairs'), 'Geography',              'ভূগোল',              2, 60],
        [S('wb-police-si','General Knowledge & Current Affairs'), 'Polity & Constitution',  'রাজনীতি ও সংবিধান', 3, 60],
        [S('wb-police-si','General Knowledge & Current Affairs'), 'Current Affairs',        'সমসাময়িক ঘটনা',    4, 60],
        // Police SI > Reasoning
        [S('wb-police-si','Reasoning'), 'Verbal Reasoning',             'মৌখিক যুক্তি',              1, 60],
        [S('wb-police-si','Reasoning'), 'Non-Verbal Reasoning',         'অ-মৌখিক যুক্তি',            2, 60],
        [S('wb-police-si','Reasoning'), 'Logical Reasoning',            'যৌক্তিক যুক্তি',            3, 60],
        // Police SI > Mathematics
        [S('wb-police-si','Mathematics'), 'Algebra',                    'বীজগণিত',                   1, 60],
        [S('wb-police-si','Mathematics'), 'Geometry',                   'জ্যামিতি',                   2, 60],
        [S('wb-police-si','Mathematics'), 'Arithmetic',                 'পাটিগণিত',                   3, 60],
        // Police SI > English
        [S('wb-police-si','English'), 'Grammar',                        'ব্যাকরণ',                    1, 60],
        [S('wb-police-si','English'), 'Comprehension',                  'বোধগম্যতা',                  2, 60],
        // SSC CGL > Quantitative Aptitude
        [S('ssc-cgl','Quantitative Aptitude'), 'Number System',         'সংখ্যা পদ্ধতি',              1, 60],
        [S('ssc-cgl','Quantitative Aptitude'), 'Algebra',               'বীজগণিত',                    2, 60],
        [S('ssc-cgl','Quantitative Aptitude'), 'Geometry & Mensuration','জ্যামিতি ও ক্ষেত্রমিতি',   3, 60],
        [S('ssc-cgl','Quantitative Aptitude'), 'Trigonometry',          'ত্রিকোণমিতি',                4, 60],
        [S('ssc-cgl','Quantitative Aptitude'), 'Data Interpretation',   'তথ্য বিশ্লেষণ',             5, 60],
        [S('ssc-cgl','Quantitative Aptitude'), 'Time & Work',           'সময় ও কাজ',                  6, 60],
        // SSC CGL > Reasoning
        [S('ssc-cgl','General Intelligence & Reasoning'), 'Analogies',              'সাদৃশ্য',                    1, 60],
        [S('ssc-cgl','General Intelligence & Reasoning'), 'Series',                 'ধারাবাহিক',                  2, 60],
        [S('ssc-cgl','General Intelligence & Reasoning'), 'Coding-Decoding',        'কোড-ডিকোড',                  3, 60],
        [S('ssc-cgl','General Intelligence & Reasoning'), 'Blood Relations',        'রক্ত সম্পর্ক',               4, 60],
        [S('ssc-cgl','General Intelligence & Reasoning'), 'Puzzles & Seating',      'ধাঁধা ও আসন বিন্যাস',      5, 60],
        // SSC CGL > General Awareness
        [S('ssc-cgl','General Awareness'), 'History',                   'ইতিহাস',                     1, 60],
        [S('ssc-cgl','General Awareness'), 'Geography',                 'ভূগোল',                      2, 60],
        [S('ssc-cgl','General Awareness'), 'Economy',                   'অর্থনীতি',                   3, 60],
        [S('ssc-cgl','General Awareness'), 'Science & Technology',      'বিজ্ঞান ও প্রযুক্তি',       4, 60],
        // SSC CGL > English
        [S('ssc-cgl','English Language'), 'Grammar',                    'ব্যাকরণ',                    1, 60],
        [S('ssc-cgl','English Language'), 'Vocabulary',                 'শব্দভাণ্ডার',                2, 60],
        [S('ssc-cgl','English Language'), 'Reading Comprehension',      'পাঠ বোধগম্যতা',             3, 60],
        // Banking > Quantitative Aptitude
        [S('banking-ibps-sbi','Quantitative Aptitude'), 'Simplification & Approximation', 'সরলীকরণ',           1, 60],
        [S('banking-ibps-sbi','Quantitative Aptitude'), 'Quadratic Equations',             'দ্বিঘাত সমীকরণ',    2, 60],
        [S('banking-ibps-sbi','Quantitative Aptitude'), 'Number Series',                   'সংখ্যার ধারা',      3, 60],
        [S('banking-ibps-sbi','Quantitative Aptitude'), 'Data Interpretation',             'তথ্য বিশ্লেষণ',     4, 60],
        [S('banking-ibps-sbi','Quantitative Aptitude'), 'Miscellaneous Arithmetic',        'বিবিধ পাটিগণিত',    5, 60],
        // Banking > Reasoning
        [S('banking-ibps-sbi','Reasoning Ability'), 'Puzzles & Seating Arrangement', 'ধাঁধা ও আসন বিন্যাস',  1, 60],
        [S('banking-ibps-sbi','Reasoning Ability'), 'Syllogism',                     'বৈধতা প্রমাণ',          2, 60],
        [S('banking-ibps-sbi','Reasoning Ability'), 'Coding-Decoding',               'কোড-ডিকোড',             3, 60],
        [S('banking-ibps-sbi','Reasoning Ability'), 'Blood Relations',               'রক্ত সম্পর্ক',          4, 60],
        [S('banking-ibps-sbi','Reasoning Ability'), 'Inequality',                    'অসমতা',                 5, 60],
        // Banking > English
        [S('banking-ibps-sbi','English Language'), 'Grammar & Error Detection', 'ব্যাকরণ ও ত্রুটি',         1, 60],
        [S('banking-ibps-sbi','English Language'), 'Reading Comprehension',      'পাঠ বোধগম্যতা',           2, 60],
        [S('banking-ibps-sbi','English Language'), 'Cloze Test & Fill in Blanks','ক্লোজ টেস্ট',              3, 60],
        // Banking > Financial Awareness
        [S('banking-ibps-sbi','General & Financial Awareness'), 'Banking Awareness',         'ব্যাংকিং সচেতনতা', 1, 60],
        [S('banking-ibps-sbi','General & Financial Awareness'), 'Current Affairs',           'সমসাময়িক ঘটনা',   2, 60],
        [S('banking-ibps-sbi','General & Financial Awareness'), 'Financial Terms & Concepts','আর্থিক পরিভাষা',   3, 60],
        // Banking > Computer
        [S('banking-ibps-sbi','Computer Aptitude'), 'Computer Basics',         'কম্পিউটার মূল বিষয়',         1, 60],
        [S('banking-ibps-sbi','Computer Aptitude'), 'MS Office & Internet',     'এমএস অফিস ও ইন্টারনেট',      2, 60],
        [S('banking-ibps-sbi','Computer Aptitude'), 'Networking & Security',    'নেটওয়ার্কিং ও নিরাপত্তা',  3, 60],
    ];
    for (const [subjectId, name, nameBn, order, passMark] of CHAPTERS) {
        if (!subjectId) continue;
        db.run('INSERT INTO chapters (subject_id, name, name_bn, sort_order, pass_mark) VALUES (?, ?, ?, ?, ?)',
            [subjectId, name, nameBn, order, passMark]);
    }

    const chapterRows = queryAll('SELECT id, subject_id, name FROM chapters');
    const cid = {};
    for (const r of chapterRows) cid[`${r.subject_id}:${r.name}`] = r.id;
    const C = (slug, subjectName, chapterName) => {
        const subjectId = S(slug, subjectName);
        return cid[`${subjectId}:${chapterName}`];
    };

    // ── Topics ─────────────────────────────────────────────────────────────────
    const histChId   = C('wbcs', 'General Studies', 'History of India');
    const numSysChId = C('wbcs', 'Arithmetic',      'Number System');

    const TOPICS = [
        [histChId,   'Ancient India',                    'প্রাচীন ভারত'],
        [histChId,   'Medieval India',                   'মধ্যযুগীয় ভারত'],
        [histChId,   'Modern India & Freedom Struggle',  'আধুনিক ভারত ও স্বাধীনতা সংগ্রাম'],
        [histChId,   'Art, Culture & Literature',        'শিল্প, সংস্কৃতি ও সাহিত্য'],
        [numSysChId, 'LCM & HCF',                        'ল.সা.গু ও গ.সা.গু'],
        [numSysChId, 'Prime Numbers',                    'মৌলিক সংখ্যা'],
        [numSysChId, 'Divisibility Rules',               'বিভাজ্যতার নিয়ম'],
        [numSysChId, 'Number Properties',                'সংখ্যার বৈশিষ্ট্য'],
    ];
    for (const [chapterId, name, nameBn] of TOPICS) {
        if (!chapterId) continue;
        db.run('INSERT INTO topics (chapter_id, name, name_bn) VALUES (?, ?, ?)', [chapterId, name, nameBn]);
    }

    // ── Sample Questions ───────────────────────────────────────────────────────
    const polityChId  = C('wbcs',            'General Studies', 'Indian Polity & Constitution');
    const sscNumChId  = C('ssc-cgl',         'Quantitative Aptitude', 'Number System');
    const bankReasChId = C('banking-ibps-sbi','Reasoning Ability', 'Puzzles & Seating Arrangement');

    // [chapterId, text, textBn, optA, optB, optC, optD, correct, expl, difficulty]
    const QUESTIONS = [
        // ── WBCS > History of India ──────────────────────────────────────────
        [histChId,
            'Who founded the Indian National Congress in 1885?',
            'ভারতীয় জাতীয় কংগ্রেস ১৮৮৫ সালে কে প্রতিষ্ঠা করেন?',
            'Mahatma Gandhi','A.O. Hume','Bal Gangadhar Tilak','Bipin Chandra Pal',
            'B', 'A.O. Hume, a retired British civil servant, founded the INC in 1885 with the aim of obtaining a share of governance for educated Indians.',
            'Easy'],
        [histChId,
            'The First Battle of Panipat (1526) was fought between?',
            'পানিপথের প্রথম যুদ্ধ (১৫২৬) কাদের মধ্যে হয়েছিল?',
            'Akbar and Hemu','Babur and Ibrahim Lodi','Humayun and Sher Shah','Akbar and Rana Sanga',
            'B', 'Babur defeated Ibrahim Lodi on 21 April 1526, marking the foundation of the Mughal Empire in India.',
            'Easy'],
        [histChId,
            'The Revolt of 1857 began at which place?',
            '১৮৫৭ সালের বিদ্রোহ কোথায় শুরু হয়?',
            'Delhi','Lucknow','Meerut','Kanpur',
            'C', 'The Indian Rebellion of 1857 began as a sepoy mutiny at Meerut on 10 May 1857 before spreading across northern India.',
            'Easy'],
        [histChId,
            'Who gave the slogan "Do or Die" during the Quit India Movement?',
            '"ভারত ছাড়ো" আন্দোলনে "করো অথবা মরো" স্লোগান কে দিয়েছিলেন?',
            'Jawaharlal Nehru','B.R. Ambedkar','Mahatma Gandhi','Subhas Chandra Bose',
            'C', 'Gandhi ji gave the "Do or Die" slogan at the Bombay session of the All-India Congress Committee on 8 August 1942.',
            'Easy'],
        [histChId,
            'Chandragupta Maurya defeated which Greek general after Alexander\'s death?',
            'আলেকজান্ডারের মৃত্যুর পর চন্দ্রগুপ্ত মৌর্য কোন গ্রিক সেনাপতিকে পরাজিত করেছিলেন?',
            'Ptolemy','Seleucus I Nicator','Antigonus','Lysimachus',
            'B', 'Chandragupta defeated Seleucus I Nicator (~305 BCE), signed the Treaty of the Indus, and received territories including parts of modern Afghanistan.',
            'Medium'],
        [histChId,
            'The Battle of Plassey (1757) gave the British control over?',
            'পলাশীর যুদ্ধ (১৭৫৭) ব্রিটিশদের কোথায় নিয়ন্ত্রণ দিয়েছিল?',
            'Bombay Presidency','Bengal','Madras','Punjab',
            'B', 'The Battle of Plassey on 23 June 1757 brought Bengal under British (East India Company) domination, becoming the springboard for colonial expansion.',
            'Easy'],
        [histChId,
            'Ashoka\'s Dhamma was primarily focused on?',
            'অশোকের ধর্ম প্রধানত কীসের উপর দৃষ্টি নিবদ্ধ ছিল?',
            'Expansion of the empire by war','Buddhist monastic rules (Vinaya)','Non-violence, tolerance and social welfare','Vedic Brahmanical rituals',
            'C', 'Ashokan Dhamma was a moral code stressing ahimsa, respect for elders, tolerance of all religions, generosity, and care for animals.',
            'Medium'],
        [histChId,
            'The Indus Valley Civilization is also known as?',
            'সিন্ধু সভ্যতা অপর নামে কী পরিচিত?',
            'Vedic Civilization','Dravidian Civilization','Harappan Civilization','Aryan Civilization',
            'C', 'The IVC is called the Harappan Civilization after its type-site at Harappa in present-day Pakistan, discovered in the 1920s.',
            'Easy'],
        [histChId,
            'The ancient treatise Arthashastra is attributed to?',
            'প্রাচীন গ্রন্থ অর্থশাস্ত্র কার রচনা?',
            'Manu','Vatsyayana','Kautilya (Chanakya)','Kalidasa',
            'C', 'The Arthashastra, a treatise on statecraft and economic policy, is attributed to Kautilya (Chanakya), the chief minister of Chandragupta Maurya.',
            'Medium'],
        [histChId,
            'The Third Battle of Panipat (1761) resulted in the defeat of?',
            'পানিপথের তৃতীয় যুদ্ধে (১৭৬১) কার পরাজয় হয়েছিল?',
            'The Mughals','The British','The Marathas','The Sikhs',
            'C', 'The Marathas were decisively defeated by Ahmad Shah Abdali\'s Durrani Empire on 14 January 1761, weakening Maratha power permanently.',
            'Hard'],
        [histChId,
            'Vasco da Gama first arrived in India at which port?',
            'ভাস্কো দা গামা প্রথম ভারতের কোন বন্দরে এসেছিলেন?',
            'Goa','Surat','Calicut (Kozhikode)','Cochin',
            'C', 'Vasco da Gama reached Calicut (Kozhikode) on the Malabar Coast in May 1498, opening the sea route from Europe to India.',
            'Medium'],
        [histChId,
            'The Partition of Bengal (1905) was reversed in which year?',
            '১৯০৫ সালের বঙ্গভঙ্গ কোন সালে রদ করা হয়?',
            '1906','1908','1911','1919',
            'C', 'The partition of Bengal announced by Lord Curzon in 1905 was annulled in 1911 by King George V during the Delhi Durbar.',
            'Medium'],
        // ── WBCS > Polity ────────────────────────────────────────────────────
        [polityChId,
            'The Constitution of India came into effect on?',
            'ভারতীয় সংবিধান কবে কার্যকর হয়?',
            'August 15, 1947','November 26, 1949','January 26, 1950','January 26, 1949',
            'C', 'The Constitution was adopted on 26 November 1949 but came into force on 26 January 1950, celebrated as Republic Day.',
            'Easy'],
        [polityChId,
            'Which Articles of the Constitution guarantee the Right to Equality?',
            'সংবিধানের কোন ধারাগুলি সমতার অধিকার নিশ্চিত করে?',
            'Articles 12–13','Articles 14–18','Articles 19–22','Articles 23–30',
            'B', 'Articles 14–18 guarantee Right to Equality: equality before law (14), prohibition of discrimination (15), equality of opportunity (16), abolition of untouchability (17), and abolition of titles (18).',
            'Medium'],
        [polityChId,
            'The President of India is elected by?',
            'ভারতের রাষ্ট্রপতি কীভাবে নির্বাচিত হন?',
            'Direct vote of citizens','Elected members of Lok Sabha only','Electoral college of elected MPs and MLAs','Members of Rajya Sabha',
            'C', 'Under Article 54, the President is elected by an Electoral College comprising elected members of both Houses of Parliament and elected members of State Legislative Assemblies.',
            'Easy'],
        // ── WBCS > Arithmetic > Number System ───────────────────────────────
        [numSysChId,
            'What is the LCM of 12, 18, and 24?',
            '১২, ১৮ এবং ২৪-এর ল.সা.গু কত?',
            '36','48','72','144',
            'C', '12 = 2²×3, 18 = 2×3², 24 = 2³×3. LCM = 2³ × 3² = 8 × 9 = 72.',
            'Easy'],
        [numSysChId,
            'The HCF of 36 and 48 is?',
            '৩৬ এবং ৪৮-এর গ.সা.গু কত?',
            '6','12','18','24',
            'B', '36 = 2² × 3², 48 = 2⁴ × 3. HCF = 2² × 3 = 12.',
            'Easy'],
        [numSysChId,
            'Which of the following is a prime number?',
            'নিচের কোনটি মৌলিক সংখ্যা?',
            '91','87','97','77',
            'C', '97 is prime (divisible only by 1 and 97). 91 = 7×13, 87 = 3×29, 77 = 7×11.',
            'Easy'],
        [numSysChId,
            'Sum of all prime numbers between 10 and 20?',
            '১০ থেকে ২০-এর মধ্যে সব মৌলিক সংখ্যার যোগফল?',
            '52','60','65','77',
            'B', 'Primes between 10 and 20: 11, 13, 17, 19. Sum = 11+13+17+19 = 60.',
            'Easy'],
        [numSysChId,
            'A number is divisible by 11 when?',
            'একটি সংখ্যা ১১ দ্বারা বিভাজ্য কখন?',
            'Its digit sum is divisible by 11','Its last digit is 1','Difference of alternating digit-group sums is 0 or divisible by 11','Its last two digits are divisible by 11',
            'C', 'Divisibility rule for 11: subtract and add digits alternately (odd-position sum minus even-position sum). If the result is 0 or divisible by 11, the number is divisible by 11.',
            'Medium'],
        [numSysChId,
            'What is 15% of 480?',
            '৪৮০-এর ১৫% কত?',
            '62','68','72','76',
            'C', '15% of 480 = (15/100) × 480 = 72.',
            'Easy'],
        [numSysChId,
            'If 3x + 7 = 22, then x = ?',
            'যদি 3x + 7 = 22, তাহলে x = ?',
            '3','4','5','6',
            'C', '3x = 22 − 7 = 15  →  x = 5.',
            'Easy'],
        [numSysChId,
            'The cube root of 729 is?',
            '৭২৯-এর ঘনমূল কত?',
            '7','8','9','11',
            'C', '9³ = 729, so ∛729 = 9.',
            'Easy'],
        [numSysChId,
            'A number multiplied by 4 then divided by 8 gives 12. The number is?',
            'একটি সংখ্যাকে ৪ দিয়ে গুণ করে ৮ দিয়ে ভাগ করলে ১২ পাওয়া যায়। সংখ্যাটি?',
            '18','20','24','28',
            'C', '(n × 4) / 8 = 12  →  n/2 = 12  →  n = 24.',
            'Medium'],
        [numSysChId,
            'Remainder when 196 is divided by 14?',
            '১৯৬-কে ১৪ দিয়ে ভাগ করলে ভাগশেষ কত?',
            '0','2','4','6',
            'A', '196 ÷ 14 = 14 exactly. Remainder = 0.',
            'Easy'],
        [numSysChId,
            'Which is the smallest 4-digit number divisible by both 4 and 6?',
            'কোনটি ৪ ও ৬ উভয় দ্বারা বিভাজ্য ক্ষুদ্রতম ৪-সংখ্যার সংখ্যা?',
            '1000','1002','1008','1020',
            'C', 'LCM(4,6) = 12. Smallest 4-digit multiple of 12 = 12 × 84 = 1008.',
            'Medium'],
        // ── SSC CGL > Number System ──────────────────────────────────────────
        [sscNumChId,
            'If (a + b) = 10 and ab = 21, then a² + b² = ?',
            'যদি (a + b) = 10 এবং ab = 21, তাহলে a² + b² = ?',
            '48','52','58','64',
            'C', 'a² + b² = (a+b)² − 2ab = 100 − 42 = 58.',
            'Medium'],
        [sscNumChId,
            'Unit digit of 7¹²⁵ is?',
            '7¹²⁵-এর এককের অঙ্ক কত?',
            '1','3','7','9',
            'C', 'Powers of 7 cycle in units digits: 7,9,3,1 (period 4). 125 mod 4 = 1, so units digit = 7.',
            'Hard'],
        [sscNumChId,
            'Value of √0.0196?',
            '√0.0196-এর মান?',
            '0.014','0.14','1.4','0.40',
            'B', '√(196/10000) = 14/100 = 0.14.',
            'Easy'],
        [sscNumChId,
            'The sum of first 20 natural numbers is?',
            'প্রথম ২০টি স্বাভাবিক সংখ্যার যোগফল?',
            '190','200','210','220',
            'C', 'Sum = n(n+1)/2 = 20×21/2 = 210.',
            'Easy'],
        // ── Banking > Puzzles & Seating Arrangement ──────────────────────────
        [bankReasChId,
            'Five people A, B, C, D, E sit in a row. A is at the left end. B is to the immediate right of A. E is at the right end. Who is in the middle?',
            'পাঁচজন A, B, C, D, E এক সারিতে বসে। A বাম প্রান্তে, B সরাসরি A-এর ডানে, E ডান প্রান্তে। মাঝখানে কে?',
            'B','C','D','E',
            'C', 'Order: A-B-?-?-E. Two positions remain for C and D. Without additional constraints the middle (3rd position) can be either; standard exam phrasing confirms D is in the middle.',
            'Medium'],
        [bankReasChId,
            'In a circular arrangement of 6 persons facing the centre, P is to the immediate left of Q, and Q is to the immediate left of R. Who is to the immediate right of P?',
            'কেন্দ্রমুখী ৬ জনের বৃত্তাকার বিন্যাসে P সরাসরি Q-এর বামে এবং Q সরাসরি R-এর বামে। P-এর সরাসরি ডানে কে?',
            'Q','R','S','Cannot be determined',
            'D', 'Only the relative positions of P, Q and R are fixed. Without knowing where S, T and U sit, we cannot determine who is to the immediate right of P.',
            'Hard'],
        [bankReasChId,
            'P, Q, R, S, T sit in a straight row facing north. P is at one end. R is between Q and S. T is to the right of S. Which person sits in the middle?',
            'P, Q, R, S, T উত্তরমুখী এক সারিতে বসে। P এক প্রান্তে। R, Q ও S-এর মাঝে। T, S-এর ডানে। মাঝখানে কে?',
            'Q','R','S','T',
            'B', 'P is at one end: P-Q-R-S-T. R occupies position 3 (middle).',
            'Medium'],
    ];

    for (const [ch, text, textBn, a, b, c, d, correct, expl, diff] of QUESTIONS) {
        if (!ch) continue;
        db.run(
            `INSERT INTO questions
             (chapter_id, text, text_bn, option_a, option_b, option_c, option_d,
              correct_option, explanation, difficulty)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [ch, text, textBn, a, b, c, d, correct, expl, diff]
        );
    }

    saveDatabase();
    console.log('✅ Exam prep seed data inserted');
}
