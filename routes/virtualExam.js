/**
 * Virtual Exam Room API Routes (MongoDB)
 * Handles all exam-related operations: questions, sessions, scoring, results
 */

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { ObjectId } from 'mongodb';

const router = Router();

let db = null;

// Initialize MongoDB connection
export async function initVirtualExamDB(mongoDb) {
  db = mongoDb;
  
  // Create collections and indexes
  const collections = ['exams', 'subjects', 'exam_questions', 'test_sessions', 'test_attempts', 'test_results'];
  
  for (const collection of collections) {
    try {
      await db.createCollection(collection);
      console.log(`✅ Collection ${collection} created`);
    } catch (err) {
      if (err.codeName !== 'NamespaceExists') {
        console.error(`Error creating ${collection}:`, err);
      }
    }
  }
  
  // Create indexes
  await db.collection('exam_questions').createIndex({ exam_id: 1, subject_id: 1 });
  await db.collection('exam_questions').createIndex({ difficulty: 1 });
  await db.collection('test_sessions').createIndex({ user_id: 1, exam_id: 1 });
  await db.collection('test_sessions').createIndex({ status: 1 });
  await db.collection('test_results').createIndex({ user_id: 1, exam_id: 1 });
  await db.collection('test_results').createIndex({ accuracy_percentage: 1 });
}

// Middleware: Auth check (basic validation)
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'AUTH_FAILED',
      message: 'No token provided'
    });
  }
  // In production, verify JWT properly
  req.userId = 'user_' + Date.now(); // Placeholder
  next();
}

// ============================================================
// ENDPOINT 1: Get Questions (Pagination with Lazy Loading)
// ============================================================
router.post('/questions', authMiddleware, async (req, res) => {
  try {
    const { exam, subject, language = 'english', limit = 50, offset = 0 } = req.body;

    // Validation
    if (!exam || !subject) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'exam and subject are required'
      });
    }

    if (limit < 1 || limit > 100) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'limit must be between 1 and 100'
      });
    }

    if (offset < 0) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'offset must be >= 0'
      });
    }

    try {
      // Verify exam exists
      const examDoc = await db.collection('exams').findOne({ name: exam, is_active: true });
      if (!examDoc) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_EXAM',
          message: `Exam '${exam}' not found`
        });
      }

      // Verify subject exists
      const subjectDoc = await db.collection('subjects').findOne({ 
        exam_id: examDoc._id, 
        name: subject 
      });
      if (!subjectDoc) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_SUBJECT',
          message: `Subject '${subject}' not found`
        });
      }

      // Get total count
      const totalQuestions = await db.collection('exam_questions').countDocuments({
        exam_id: examDoc._id,
        subject_id: subjectDoc._id,
        is_active: true
      });

      // Get paginated questions
      const questions = await db.collection('exam_questions')
        .find({
          exam_id: examDoc._id,
          subject_id: subjectDoc._id,
          is_active: true
        })
        .sort({ _id: 1 })
        .skip(offset)
        .limit(limit)
        .toArray();

      // Format response based on language
      const formattedQuestions = questions.map((q, index) => ({
        id: q._id.toString(),
        questionNumber: offset + index + 1,
        text: q.question_text,
        options: [q.option_a, q.option_b, q.option_c, q.option_d],
        correctAnswer: q.correct_answer,
        explanation:
          language === 'hindi' ? (q.explanation_hindi || q.explanation) :
          language === 'bengali' ? (q.explanation_bengali || q.explanation) :
          q.explanation,
        subject: subject,
        difficulty: q.difficulty,
        audioUrl: q.audio_url,
        imageUrl: q.image_url
      }));

      res.json({
        success: true,
        questions: formattedQuestions,
        totalQuestions,
        totalTime: examDoc.duration_minutes * 60,
        pagination: {
          currentOffset: offset,
          currentLimit: limit,
          hasMore: offset + limit < totalQuestions,
          nextOffset: offset + limit
        },
        passingPercentage: examDoc.passing_percentage || 40
      });

    } catch (error) {
      console.error('Questions endpoint error:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Failed to fetch questions'
      });
    }

  } catch (error) {
    console.error('Questions endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to fetch questions'
    });
  }
});

// ============================================================
// ENDPOINT 2: Start Test Session
// ============================================================
router.post('/start', authMiddleware, async (req, res) => {
  try {
    const { exam, subject, language = 'english' } = req.body;

    if (!exam || !subject) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'exam and subject are required'
      });
    }

    try {
      // Verify exam and subject exist
      const examDoc = await db.collection('exams').findOne({ name: exam, is_active: true });
      if (!examDoc) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_EXAM',
          message: `Exam '${exam}' not found`
        });
      }

      const subjectDoc = await db.collection('subjects').findOne({ 
        exam_id: examDoc._id, 
        name: subject 
      });
      if (!subjectDoc) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_SUBJECT',
          message: `Subject '${subject}' not found`
        });
      }

      const sessionId = `session_${uuidv4()}`;

      // Create test session
      await db.collection('test_sessions').insertOne({
        _id: sessionId,
        user_id: req.userId,
        exam_id: examDoc._id,
        subject_id: subjectDoc._id,
        language,
        status: 'in_progress',
        started_at: new Date(),
        created_at: new Date()
      });

      res.json({
        success: true,
        data: {
          sessionId,
          exam,
          subject,
          language,
          startedAt: new Date().toISOString(),
          totalTime: examDoc.duration_minutes * 60,
          message: 'Test session started. Good luck!'
        }
      });

    } catch (error) {
      console.error('Start session error:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Failed to start test session'
      });
    }

  } catch (error) {
    console.error('Start session error:', error);
    res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to start test session'
    });
  }
});

// ============================================================
// ENDPOINT 3: Submit Test & Calculate Results
// ============================================================
router.post('/submit', authMiddleware, async (req, res) => {
  try {
    const { sessionId, exam, subject, language, totalTime, attempts } = req.body;

    if (!sessionId || !exam || !subject || !attempts) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Missing required fields'
      });
    }

    try {
      // Calculate scores
      let correctCount = 0;
      let wrongCount = 0;
      let skippedCount = 0;
      let totalMarks = attempts.length;

      attempts.forEach(attempt => {
        if (attempt.userAnswer === null || attempt.userAnswer === undefined) {
          skippedCount++;
        } else if (attempt.isCorrect) {
          correctCount++;
        } else {
          wrongCount++;
        }
      });

      const accuracy = totalMarks > 0 ? (correctCount / totalMarks) * 100 : 0;
      const isPassed = accuracy >= 40;
      const resultId = `result_${uuidv4()}`;

      // Get exam and subject IDs
      const examDoc = await db.collection('exams').findOne({ name: exam });
      const subjectDoc = await db.collection('subjects').findOne({ name: subject });

      // Get question details for subject-wise and difficulty-wise analysis
      const questionIds = attempts.map(a => a.questionId);
      const questionsData = await db.collection('exam_questions')
        .find({ _id: { $in: questionIds.map(id => new ObjectId(id)) } })
        .toArray()
        .catch(() => []);

      // Calculate subject-wise accuracy
      const subjectWiseStats = {};
      attempts.forEach((attempt, index) => {
        const question = questionsData.find(q => q._id.toString() === attempt.questionId);
        if (question && question.subject_id) {
          const subjectId = question.subject_id.toString();
          if (!subjectWiseStats[subjectId]) {
            subjectWiseStats[subjectId] = { correct: 0, total: 0, name: question.subject_name || 'Unknown' };
          }
          subjectWiseStats[subjectId].total++;
          if (attempt.isCorrect) subjectWiseStats[subjectId].correct++;
        }
      });

      // Calculate difficulty-wise accuracy
      const difficultyWiseStats = {};
      ['Easy', 'Medium', 'Hard'].forEach(diff => {
        difficultyWiseStats[diff] = { correct: 0, total: 0 };
      });
      attempts.forEach((attempt, index) => {
        const question = questionsData.find(q => q._id.toString() === attempt.questionId);
        if (question && question.difficulty) {
          const diff = question.difficulty;
          if (difficultyWiseStats[diff]) {
            difficultyWiseStats[diff].total++;
            if (attempt.isCorrect) difficultyWiseStats[diff].correct++;
          }
        }
      });

      // Generate strengths (accuracy > 75%)
      const strengths = [];
      Object.entries(subjectWiseStats).forEach(([_, stats]) => {
        const acc = stats.total > 0 ? (stats.correct / stats.total) * 100 : 0;
        if (acc > 75 && strengths.length < 3) {
          strengths.push({
            name: stats.name,
            accuracy: parseFloat(acc.toFixed(1)),
            message: `Excellent grasp of ${stats.name} (${acc.toFixed(1)}% accuracy)`
          });
        }
      });

      // Generate weak areas (accuracy < 60%)
      const weakAreas = [];
      Object.entries(subjectWiseStats).forEach(([_, stats]) => {
        const acc = stats.total > 0 ? (stats.correct / stats.total) * 100 : 0;
        if (acc < 60 && weakAreas.length < 3) {
          weakAreas.push({
            name: stats.name,
            accuracy: parseFloat(acc.toFixed(1)),
            message: `Focus on ${stats.name} - ${acc.toFixed(1)}% accuracy needs improvement`
          });
        }
      });

      // Add difficulty-based weak areas if not enough
      if (weakAreas.length < 3) {
        Object.entries(difficultyWiseStats).forEach(([diff, stats]) => {
          const acc = stats.total > 0 ? (stats.correct / stats.total) * 100 : 0;
          if (acc < 60 && diff === 'Hard' && weakAreas.length < 3) {
            weakAreas.push({
              name: `${diff} Questions`,
              accuracy: parseFloat(acc.toFixed(1)),
              message: `Struggling with ${diff.toLowerCase()} questions - ${acc.toFixed(1)}% accuracy`
            });
          }
        });
      }

      // Generate comprehensive recommendations (3-4 items)
      const recommendations = [];
      if (accuracy < 40) {
        recommendations.push('⚠️ Intensive study required - Restart basics and focus on fundamental concepts');
      }
      if (weakAreas.length > 0) {
        recommendations.push(`📚 Priority: Master ${weakAreas[0].name} (Currently ${weakAreas[0].accuracy}%)`);
      }
      if (difficultyWiseStats['Hard'].total > 0) {
        const hardAcc = (difficultyWiseStats['Hard'].correct / difficultyWiseStats['Hard'].total) * 100;
        if (hardAcc < 50) {
          recommendations.push('💪 Practice advanced difficulty questions to improve problem-solving skills');
        }
      }
      recommendations.push('🔄 Review incorrect answers and understand the concepts behind them');

      // Get existing results count for ranking
      const higherScores = await db.collection('test_results').countDocuments({
        exam_id: examDoc._id,
        accuracy_percentage: { $gt: accuracy }
      });

      const rank = higherScores + 1;

      // Create test result
      const resultDoc = {
        _id: resultId,
        test_session_id: sessionId,
        user_id: req.userId,
        exam_id: examDoc._id,
        subject_id: subjectDoc._id,
        language,
        total_score: correctCount,
        total_marks: totalMarks,
        accuracy_percentage: parseFloat(accuracy.toFixed(2)),
        total_time_seconds: totalTime,
        questions_attempted: totalMarks - skippedCount,
        questions_correct: correctCount,
        questions_wrong: wrongCount,
        questions_skipped: skippedCount,
        is_passed: isPassed,
        rank_in_exam: rank,
        subject_wise_accuracy: Object.entries(subjectWiseStats).map(([_, stats]) => ({
          name: stats.name,
          accuracy: stats.total > 0 ? parseFloat(((stats.correct / stats.total) * 100).toFixed(1)) : 0,
          correct: stats.correct,
          total: stats.total
        })),
        difficulty_wise_accuracy: Object.entries(difficultyWiseStats).map(([diff, stats]) => ({
          difficulty: diff,
          accuracy: stats.total > 0 ? parseFloat(((stats.correct / stats.total) * 100).toFixed(1)) : 0,
          correct: stats.correct,
          total: stats.total
        })),
        weak_areas: weakAreas,
        strong_areas: strengths,
        recommendations: recommendations,
        created_at: new Date()
      };

      await db.collection('test_results').insertOne(resultDoc);

      // Save attempts
      const attemptDocs = attempts.map((attempt, index) => ({
        _id: `attempt_${uuidv4()}`,
        test_session_id: sessionId,
        question_id: attempt.questionId,
        user_answer: attempt.userAnswer,
        is_correct: attempt.isCorrect,
        time_taken_seconds: attempt.timeTaken,
        question_order: index + 1,
        created_at: new Date()
      }));

      if (attemptDocs.length > 0) {
        await db.collection('test_attempts').insertMany(attemptDocs);
      }

      // Update session status
      await db.collection('test_sessions').updateOne(
        { _id: sessionId },
        {
          $set: {
            status: 'submitted',
            submitted_at: new Date(),
            total_time_seconds: totalTime
          }
        }
      );

      res.json({
        success: true,
        result: {
          resultId,
          sessionId,
          exam,
          subject,
          totalScore: correctCount,
          totalMarks,
          accuracy: parseFloat(accuracy.toFixed(2)),
          totalTime,
          questionsAttempted: totalMarks - skippedCount,
          questionsCorrect: correctCount,
          questionsWrong: wrongCount,
          questionsSkipped: skippedCount,
          isPassed,
          rank,
          subjectWiseAccuracy: Object.entries(subjectWiseStats).map(([_, stats]) => ({
            name: stats.name,
            accuracy: stats.total > 0 ? parseFloat(((stats.correct / stats.total) * 100).toFixed(1)) : 0,
            correct: stats.correct,
            total: stats.total
          })),
          difficultyWiseAccuracy: Object.entries(difficultyWiseStats).map(([diff, stats]) => ({
            difficulty: diff,
            accuracy: stats.total > 0 ? parseFloat(((stats.correct / stats.total) * 100).toFixed(1)) : 0,
            correct: stats.correct,
            total: stats.total
          })),
          weakAreas,
          strongAreas: strengths,
          recommendations,
          languageBasedTips: getLanguageTips(language)
        }
      });

    } catch (error) {
      console.error('Submit test error:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Failed to submit test'
      });
    }

  } catch (error) {
    console.error('Submit test error:', error);
    res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to submit test'
    });
  }
});

// ============================================================
// ENDPOINT 4: Get Test History
// ============================================================
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const { exam, subject, limit = 10, offset = 0 } = req.query;

    try {
      let filter = { user_id: req.userId };

      if (exam) {
        const examDoc = await db.collection('exams').findOne({ name: exam });
        if (examDoc) {
          filter.exam_id = examDoc._id;
        }
      }

      if (subject) {
        const subjectDoc = await db.collection('subjects').findOne({ name: subject });
        if (subjectDoc) {
          filter.subject_id = subjectDoc._id;
        }
      }

      const results = await db.collection('test_results')
        .find(filter)
        .sort({ created_at: -1 })
        .skip(parseInt(offset))
        .limit(parseInt(limit))
        .toArray();

      // Calculate statistics
      const allResults = await db.collection('test_results')
        .find({ user_id: req.userId })
        .toArray();

      const stats = {
        total_attempts: allResults.length,
        avg_accuracy: allResults.length > 0 ? 
          allResults.reduce((sum, r) => sum + r.accuracy_percentage, 0) / allResults.length : 0,
        best_score: allResults.length > 0 ? 
          Math.max(...allResults.map(r => r.total_score)) : 0,
        passed_count: allResults.filter(r => r.is_passed).length
      };

      res.json({
        success: true,
        data: {
          history: results.map(r => ({
            testId: r._id,
            exam: r.exam_id,
            subject: r.subject_id,
            attemptDate: r.created_at,
            score: r.total_score,
            totalMarks: r.total_marks,
            accuracy: parseFloat(r.accuracy_percentage.toFixed(2)),
            totalTime: r.total_time_seconds,
            questionsAttempted: r.questions_attempted,
            questionsCorrect: r.questions_correct,
            rank: r.rank_in_exam,
            status: r.is_passed ? 'PASSED' : 'FAILED'
          })),
          statistics: {
            totalAttempts: stats.total_attempts,
            averageScore: parseFloat(stats.avg_accuracy.toFixed(2)),
            bestScore: stats.best_score,
            averageAccuracy: parseFloat(stats.avg_accuracy.toFixed(2)),
            passingRate: stats.total_attempts > 0 ?
              parseFloat(((stats.passed_count / stats.total_attempts) * 100).toFixed(2)) : 0
          }
        }
      });

    } catch (error) {
      console.error('History endpoint error:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Failed to fetch history'
      });
    }

  } catch (error) {
    console.error('History endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to fetch history'
    });
  }
});

// ============================================================
// ENDPOINT 5: Get Leaderboard
// ============================================================
router.get('/leaderboard', authMiddleware, async (req, res) => {
  try {
    const { exam, period = 'weekly', limit = 100 } = req.query;

    if (!exam) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'exam parameter is required'
      });
    }

    try {
      // Determine date filter
      let periodDate;
      if (period === 'monthly') {
        periodDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      } else if (period === 'all-time') {
        periodDate = new Date('2000-01-01');
      } else {
        periodDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      }

      // Get exam document
      const examDoc = await db.collection('exams').findOne({ name: exam });
      if (!examDoc) {
        return res.status(400).json({
          success: false,
          error: 'NOT_FOUND',
          message: 'Exam not found'
        });
      }

      // MongoDB aggregation for leaderboard with ranking
      const leaderboard = await db.collection('test_results')
        .aggregate([
          {
            $match: {
              exam_id: examDoc._id,
              created_at: { $gte: periodDate }
            }
          },
          {
            $group: {
              _id: '$user_id',
              avg_accuracy: { $avg: '$accuracy_percentage' },
              best_score: { $max: '$total_score' },
              tests_completed: { $sum: 1 }
            }
          },
          { $sort: { avg_accuracy: -1 } },
          { $limit: parseInt(limit) },
          {
            $project: {
              user_id: '$_id',
              avg_accuracy: '$avg_accuracy',
              best_score: '$best_score',
              tests_completed: '$tests_completed',
              _id: 0
            }
          }
        ])
        .toArray();

      // Get user's rank
      const userLeaderboardPos = leaderboard.findIndex(entry => entry.user_id === req.userId);
      const userStats = await db.collection('test_results')
        .aggregate([
          {
            $match: {
              exam_id: examDoc._id,
              user_id: req.userId,
              created_at: { $gte: periodDate }
            }
          },
          {
            $group: {
              _id: '$user_id',
              avg_accuracy: { $avg: '$accuracy_percentage' },
              best_score: { $max: '$total_score' },
              tests_completed: { $sum: 1 }
            }
          }
        ])
        .toArray();

      res.json({
        success: true,
        data: {
          leaderboard: leaderboard.map((entry, index) => ({
            rank: index + 1,
            userId: entry.user_id,
            accuracy: parseFloat(entry.avg_accuracy.toFixed(2)),
            bestScore: entry.best_score,
            testsCompleted: entry.tests_completed,
            isSelf: entry.user_id === req.userId
          })),
          userRank: userStats.length > 0 ? {
            rank: userLeaderboardPos + 1,
            accuracy: parseFloat(userStats[0].avg_accuracy.toFixed(2)),
            bestScore: userStats[0].best_score
          } : null
        }
      });

    } catch (error) {
      console.error('Leaderboard error:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Failed to fetch leaderboard'
      });
    }

  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to fetch leaderboard'
    });
  }
});

// ============================================================
// ENDPOINT 6: Get Analytics Dashboard
// ============================================================
router.get('/analytics', authMiddleware, async (req, res) => {
  try {
    const { exam } = req.query;

    if (!exam) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'exam parameter is required'
      });
    }

    try {
      // Get exam document
      const examDoc = await db.collection('exams').findOne({ name: exam });
      if (!examDoc) {
        return res.status(400).json({
          success: false,
          error: 'NOT_FOUND',
          message: 'Exam not found'
        });
      }

      // Get overall statistics
      const stats = await db.collection('test_results')
        .aggregate([
          {
            $match: {
              exam_id: examDoc._id,
              user_id: req.userId
            }
          },
          {
            $group: {
              _id: '$user_id',
              total_tests: { $sum: 1 },
              avg_accuracy: { $avg: '$accuracy_percentage' },
              best_score: { $max: '$total_score' },
              worst_score: { $min: '$total_score' }
            }
          }
        ])
        .toArray();

      // Get 30-day trend
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const trend = await db.collection('test_results')
        .aggregate([
          {
            $match: {
              exam_id: examDoc._id,
              user_id: req.userId,
              created_at: { $gte: thirtyDaysAgo }
            }
          },
          {
            $group: {
              _id: {
                $dateToString: { format: '%Y-%m-%d', date: '$created_at' }
              },
              avg_score: { $avg: '$total_score' },
              avg_accuracy: { $avg: '$accuracy_percentage' }
            }
          },
          { $sort: { _id: 1 } },
          {
            $project: {
              date: '$_id',
              score: '$avg_score',
              accuracy: '$avg_accuracy',
              _id: 0
            }
          }
        ])
        .toArray();

      res.json({
        success: true,
        data: {
          analytics: {
            totalTestsTaken: stats.length > 0 ? stats[0].total_tests : 0,
            avgScore: stats.length > 0 ? parseFloat(stats[0].avg_accuracy.toFixed(2)) : 0,
            bestScore: stats.length > 0 ? stats[0].best_score : 0,
            worstScore: stats.length > 0 ? stats[0].worst_score : 0,
            avgAccuracy: stats.length > 0 ? parseFloat(stats[0].avg_accuracy.toFixed(2)) : 0,
            performanceTrend: trend.map(t => ({
              date: t.date,
              score: parseFloat(t.score.toFixed(2)),
              accuracy: parseFloat(t.accuracy.toFixed(2))
            })),
            recommendations: [
              'Practice weak areas daily',
              'Solve previous year papers',
              'Join study groups',
              'Review concepts regularly'
            ]
          }
        }
      });

    } catch (error) {
      console.error('Analytics error:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Failed to fetch analytics'
      });
    }

  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to fetch analytics'
    });
  }
});

// Helper function to get language-specific tips
function getLanguageTips(language) {
  const tips = {
    english: [
      "Read each question twice before selecting",
      "Look for tricky wording in options",
      "Use process of elimination",
      "Don't rush - accuracy > speed"
    ],
    hindi: [
      "प्रत्येक प्रश्न को दो बार पढ़ें",
      "विकल्पों में जाल हो सकता है",
      "संदेहास्पद प्रश्नों के लिए विलोपन विधि",
      "जल्दबाजी न करें - सटीकता > गति"
    ],
    bengali: [
      "প्রতিটি প্রশ্ন দুইবার পড়ুন",
      "বিকল্পগুলি সাবধানে স্কেন করুন",
      "বর্জন পদ্ধতি ব্যবহার করুন",
      "তাড়াহুড়ো করবেন না"
    ]
  };
  return tips[language] || tips.english;
}

export default router;
