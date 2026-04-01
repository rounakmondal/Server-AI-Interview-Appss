-- AI Mock Interview Database Schema

-- Interview Sessions
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    interview_type TEXT NOT NULL,
    language TEXT NOT NULL,
    cv_data TEXT,
    cv_filename TEXT,
    job_description TEXT,
    status TEXT DEFAULT 'in_progress',
    question_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME
);

-- Conversation History
CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('interviewer', 'candidate')),
    content TEXT NOT NULL,
    question_number INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Evaluation Results
CREATE TABLE IF NOT EXISTS evaluations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT UNIQUE NOT NULL,
    overall_score REAL,
    communication_score REAL,
    technical_score REAL,
    confidence_score REAL,
    weak_areas TEXT,
    improvement_plan TEXT,
    detailed_feedback TEXT,
    question_reviews TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);

-- ══════════════════════════════════════════════════════════════
-- MedhaHub Exam Prep Schema
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS exams (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    name    TEXT NOT NULL,
    name_bn TEXT,
    slug    TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS subjects (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    exam_id    INTEGER NOT NULL,
    name       TEXT NOT NULL,
    name_bn    TEXT,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chapters (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id INTEGER NOT NULL,
    name       TEXT NOT NULL,
    name_bn    TEXT,
    sort_order INTEGER DEFAULT 0,
    pass_mark  INTEGER DEFAULT 60,
    FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS topics (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    chapter_id INTEGER NOT NULL,
    name       TEXT NOT NULL,
    name_bn    TEXT,
    FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS questions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    chapter_id     INTEGER NOT NULL,
    text           TEXT NOT NULL,
    text_bn        TEXT,
    option_a       TEXT NOT NULL,
    option_b       TEXT NOT NULL,
    option_c       TEXT NOT NULL,
    option_d       TEXT NOT NULL,
    correct_option TEXT NOT NULL CHECK(correct_option IN ('A','B','C','D')),
    explanation    TEXT,
    difficulty     TEXT DEFAULT 'Medium' CHECK(difficulty IN ('Easy','Medium','Hard')),
    FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_exam_preferences (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL,
    exam_id    INTEGER NOT NULL,
    exam_date  TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, exam_id)
);

CREATE TABLE IF NOT EXISTS user_chapter_progress (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       TEXT NOT NULL,
    chapter_id    INTEGER NOT NULL,
    status        TEXT DEFAULT 'not_started' CHECK(status IN ('not_started','in_progress','done')),
    last_score    REAL,
    attempt_count INTEGER DEFAULT 0,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, chapter_id)
);

CREATE TABLE IF NOT EXISTS user_test_attempts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         TEXT NOT NULL,
    chapter_id      INTEGER NOT NULL,
    score           REAL NOT NULL,
    total_questions INTEGER NOT NULL,
    correct         INTEGER NOT NULL,
    time_taken_secs INTEGER,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_test_answers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_id      INTEGER NOT NULL,
    question_id     INTEGER NOT NULL,
    selected_option TEXT CHECK(selected_option IN ('A','B','C','D')),
    is_correct      INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (attempt_id)  REFERENCES user_test_attempts(id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS study_plans_ai (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       TEXT NOT NULL,
    exam_id       INTEGER NOT NULL,
    exam_date     TEXT,
    hours_per_day REAL,
    plan_json     TEXT,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS study_plan_templates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    exam_id     INTEGER NOT NULL,
    phase       TEXT,
    week_number INTEGER,
    subject_id  INTEGER,
    chapter_id  INTEGER,
    notes       TEXT,
    FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
);

-- Indexes for exam prep
CREATE INDEX IF NOT EXISTS idx_ep_subjects_exam      ON subjects(exam_id);
CREATE INDEX IF NOT EXISTS idx_ep_chapters_subj      ON chapters(subject_id);
CREATE INDEX IF NOT EXISTS idx_ep_topics_chap        ON topics(chapter_id);
CREATE INDEX IF NOT EXISTS idx_ep_questions_chap     ON questions(chapter_id);
CREATE INDEX IF NOT EXISTS idx_ep_uep_user           ON user_exam_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_ep_ucp_user_chap      ON user_chapter_progress(user_id, chapter_id);
CREATE INDEX IF NOT EXISTS idx_ep_uta_user_chap      ON user_test_attempts(user_id, chapter_id);
CREATE INDEX IF NOT EXISTS idx_ep_spa_user_exam      ON study_plans_ai(user_id, exam_id);
CREATE INDEX IF NOT EXISTS idx_ep_spt_exam           ON study_plan_templates(exam_id);
