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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
