import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ensure database directory exists
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'interview.db');

let db = null;

// Check if a column exists in a table
function columnExists(tableName, columnName) {
    const stmt = db.prepare(`PRAGMA table_info(${tableName})`);
    const columns = [];
    while (stmt.step()) {
        columns.push(stmt.getAsObject().name);
    }
    stmt.free();
    return columns.includes(columnName);
}

// Run database migrations for schema updates
function runMigrations() {
    // Migration: Add job_description column to sessions table
    if (!columnExists('sessions', 'job_description')) {
        db.run('ALTER TABLE sessions ADD COLUMN job_description TEXT');
        console.log('✅ Migration: Added job_description column to sessions');
    }
}

// Initialize database
export async function initializeDatabase() {
    const SQL = await initSqlJs();

    // Load existing database or create new one
    if (fs.existsSync(dbPath)) {
        const buffer = fs.readFileSync(dbPath);
        db = new SQL.Database(buffer);
    } else {
        db = new SQL.Database();
    }

    // Read and execute schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    db.run(schema);

    // Run migrations for existing databases
    runMigrations();

    // Save database
    saveDatabase();

    console.log('✅ Database initialized successfully');
    return db;
}

// Save database to file
function saveDatabase() {
    if (db) {
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(dbPath, buffer);
    }
}

// Get database instance
export function getDb() {
    return db;
}

// Session operations
export const sessionQueries = {
    create: (id, type, language, cvData, cvFilename, jobDescription = null) => {
        db.run(`
            INSERT INTO sessions (id, interview_type, language, cv_data, cv_filename, job_description, status)
            VALUES (?, ?, ?, ?, ?, ?, 'in_progress')
        `, [id, type, language, cvData, cvFilename, jobDescription]);
        saveDatabase();
    },

    getById: (id) => {
        const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
        stmt.bind([id]);
        if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            return row;
        }
        stmt.free();
        return null;
    },

    updateStatus: (status, id) => {
        db.run(`UPDATE sessions SET status = ?, ended_at = datetime('now') WHERE id = ?`, [status, id]);
        saveDatabase();
    },

    incrementQuestionCount: (id) => {
        db.run(`UPDATE sessions SET question_count = question_count + 1 WHERE id = ?`, [id]);
        saveDatabase();
    },

    getQuestionCount: (id) => {
        const stmt = db.prepare('SELECT question_count FROM sessions WHERE id = ?');
        stmt.bind([id]);
        if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            return row.question_count;
        }
        stmt.free();
        return 0;
    }
};

// Conversation operations
export const conversationQueries = {
    add: (sessionId, role, content, questionNumber) => {
        db.run(`
            INSERT INTO conversations (session_id, role, content, question_number)
            VALUES (?, ?, ?, ?)
        `, [sessionId, role, content, questionNumber]);
        saveDatabase();
    },

    getBySession: (sessionId) => {
        const results = [];
        const stmt = db.prepare('SELECT * FROM conversations WHERE session_id = ? ORDER BY timestamp ASC');
        stmt.bind([sessionId]);
        while (stmt.step()) {
            results.push(stmt.getAsObject());
        }
        stmt.free();
        return results;
    },

    getLastN: (sessionId, n) => {
        const results = [];
        const stmt = db.prepare('SELECT * FROM conversations WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?');
        stmt.bind([sessionId, n]);
        while (stmt.step()) {
            results.push(stmt.getAsObject());
        }
        stmt.free();
        return results.reverse();
    }
};

// Evaluation operations
export const evaluationQueries = {
    create: (sessionId, overallScore, communicationScore, technicalScore, confidenceScore, weakAreas, improvementPlan, detailedFeedback) => {
        db.run(`
            INSERT INTO evaluations (
                session_id, overall_score, communication_score, technical_score,
                confidence_score, weak_areas, improvement_plan, detailed_feedback
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [sessionId, overallScore, communicationScore, technicalScore, confidenceScore, weakAreas, improvementPlan, detailedFeedback]);
        saveDatabase();
    },

    getBySession: (sessionId) => {
        const stmt = db.prepare('SELECT * FROM evaluations WHERE session_id = ?');
        stmt.bind([sessionId]);
        if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            return row;
        }
        stmt.free();
        return null;
    }
};

export default { initializeDatabase, getDb, sessionQueries, conversationQueries, evaluationQueries };
