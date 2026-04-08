-- Virtual Exam Database Schema

CREATE TABLE IF NOT EXISTS exams (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  duration_minutes INT DEFAULT 120,
  total_questions INT NOT NULL,
  passing_percentage DECIMAL(5,2) DEFAULT 40.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  
  UNIQUE KEY unique_exam (name)
);

CREATE TABLE IF NOT EXISTS subjects (
  id VARCHAR(50) PRIMARY KEY,
  exam_id VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  total_questions INT NOT NULL,
  order_index INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
  UNIQUE KEY unique_subject (exam_id, name),
  INDEX idx_exam_subject (exam_id, name)
);

CREATE TABLE IF NOT EXISTS exam_questions (
  id VARCHAR(50) PRIMARY KEY,
  exam_id VARCHAR(50) NOT NULL,
  subject_id VARCHAR(50) NOT NULL,
  question_text LONGTEXT NOT NULL,
  option_a VARCHAR(500) NOT NULL,
  option_b VARCHAR(500) NOT NULL,
  option_c VARCHAR(500) NOT NULL,
  option_d VARCHAR(500) NOT NULL,
  correct_answer INT NOT NULL CHECK (correct_answer IN (0, 1, 2, 3)),
  explanation LONGTEXT,
  explanation_hindi LONGTEXT,
  explanation_bengali LONGTEXT,
  difficulty VARCHAR(20) NOT NULL CHECK (difficulty IN ('Easy', 'Medium', 'Hard')),
  weightage INT DEFAULT 1,
  audio_url VARCHAR(500),
  image_url VARCHAR(500),
  tags JSON,
  year INT,
  source VARCHAR(100),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
  FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
  INDEX idx_exam_subject (exam_id, subject_id),
  INDEX idx_difficulty (difficulty),
  INDEX idx_active (is_active),
  FULLTEXT INDEX idx_search (question_text)
);

CREATE TABLE IF NOT EXISTS test_sessions (
  id VARCHAR(50) PRIMARY KEY,
  user_id VARCHAR(50) NOT NULL,
  exam_id VARCHAR(50) NOT NULL,
  subject_id VARCHAR(50) NOT NULL,
  language VARCHAR(20) NOT NULL DEFAULT 'english',
  status VARCHAR(50) NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted', 'abandoned', 'timeout')),
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  submitted_at TIMESTAMP NULL,
  total_time_seconds INT,
  is_completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (exam_id) REFERENCES exams(id),
  FOREIGN KEY (subject_id) REFERENCES subjects(id),
  INDEX idx_user_exam (user_id, exam_id),
  INDEX idx_status (status),
  INDEX idx_created (created_at)
);

CREATE TABLE IF NOT EXISTS test_attempts (
  id VARCHAR(50) PRIMARY KEY,
  test_session_id VARCHAR(50) NOT NULL,
  question_id VARCHAR(50) NOT NULL,
  user_answer INT,
  is_correct BOOLEAN,
  time_taken_seconds INT NOT NULL DEFAULT 0,
  is_marked_review BOOLEAN DEFAULT FALSE,
  question_order INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (test_session_id) REFERENCES test_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (question_id) REFERENCES exam_questions(id),
  INDEX idx_test_session (test_session_id),
  INDEX idx_question (question_id),
  UNIQUE KEY unique_attempt (test_session_id, question_id)
);

CREATE TABLE IF NOT EXISTS test_results (
  id VARCHAR(50) PRIMARY KEY,
  test_session_id VARCHAR(50) NOT NULL UNIQUE,
  user_id VARCHAR(50) NOT NULL,
  exam_id VARCHAR(50) NOT NULL,
  subject_id VARCHAR(50) NOT NULL,
  language VARCHAR(20),
  total_score INT NOT NULL,
  total_marks INT NOT NULL,
  accuracy_percentage DECIMAL(5,2) NOT NULL,
  total_time_seconds INT NOT NULL,
  questions_attempted INT NOT NULL,
  questions_correct INT NOT NULL,
  questions_wrong INT NOT NULL,
  questions_skipped INT NOT NULL,
  rank_in_exam INT,
  percentile DECIMAL(5,2),
  status VARCHAR(50),
  is_passed BOOLEAN,
  weak_areas JSON,
  strong_areas JSON,
  recommendations JSON DEFAULT '[]',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (test_session_id) REFERENCES test_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (exam_id) REFERENCES exams(id),
  FOREIGN KEY (subject_id) REFERENCES subjects(id),
  INDEX idx_user_exam (user_id, exam_id),
  INDEX idx_created (created_at),
  INDEX idx_accuracy (accuracy_percentage)
);

CREATE TABLE IF NOT EXISTS subject_performance (
  id VARCHAR(50) PRIMARY KEY,
  test_result_id VARCHAR(50) NOT NULL,
  subject_id VARCHAR(50) NOT NULL,
  correct_answers INT NOT NULL,
  total_questions INT NOT NULL,
  accuracy_percentage DECIMAL(5,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (test_result_id) REFERENCES test_results(id) ON DELETE CASCADE,
  FOREIGN KEY (subject_id) REFERENCES subjects(id),
  INDEX idx_test_result (test_result_id),
  UNIQUE KEY unique_subject_performance (test_result_id, subject_id)
);

CREATE TABLE IF NOT EXISTS difficulty_performance (
  id VARCHAR(50) PRIMARY KEY,
  test_result_id VARCHAR(50) NOT NULL,
  difficulty VARCHAR(20) NOT NULL,
  correct_answers INT NOT NULL,
  total_questions INT NOT NULL,
  accuracy_percentage DECIMAL(5,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (test_result_id) REFERENCES test_results(id) ON DELETE CASCADE,
  INDEX idx_test_result (test_result_id),
  UNIQUE KEY unique_difficulty_performance (test_result_id, difficulty)
);

CREATE TABLE IF NOT EXISTS user_statistics (
  id VARCHAR(50) PRIMARY KEY,
  user_id VARCHAR(50) NOT NULL UNIQUE,
  exam_id VARCHAR(50) NOT NULL,
  total_tests INT DEFAULT 0,
  total_attempts INT DEFAULT 0,
  best_score INT,
  best_accuracy DECIMAL(5,2),
  average_score DECIMAL(7,2),
  average_accuracy DECIMAL(5,2),
  average_time_seconds INT,
  total_practice_time_seconds INT DEFAULT 0,
  study_streak INT DEFAULT 0,
  last_test_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (exam_id) REFERENCES exams(id),
  INDEX idx_user_exam (user_id, exam_id),
  UNIQUE KEY unique_user_exam (user_id, exam_id)
);

-- Sample data
INSERT INTO exams (id, name, description, duration_minutes, total_questions) VALUES
('exam_wbcs', 'WBCS', 'West Bengal Civil Service', 120, 500),
('exam_ssc', 'SSC', 'Staff Selection Commission', 120, 450),
('exam_railway', 'Railway', 'Railway Group D/NTPC', 90, 400),
('exam_banking', 'Banking', 'IBPS/SBI Banking', 120, 480),
('exam_police', 'Police', 'West Bengal Police', 120, 420)
ON DUPLICATE KEY UPDATE name=name;

INSERT INTO subjects (id, exam_id, name, total_questions, order_index) VALUES
('subj_hist_wbcs', 'exam_wbcs', 'History', 100, 1),
('subj_geo_wbcs', 'exam_wbcs', 'Geography', 100, 2),
('subj_pol_wbcs', 'exam_wbcs', 'Polity', 100, 3),
('subj_rea_wbcs', 'exam_wbcs', 'Reasoning', 100, 4),
('subj_math_wbcs', 'exam_wbcs', 'Math', 100, 5)
ON DUPLICATE KEY UPDATE name=name;
