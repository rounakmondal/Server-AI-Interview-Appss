/**
 * Virtual Exam Business Logic & Utilities
 * Score calculations, recommendations, analytics
 */

/**
 * Calculate score and accuracy
 */
export function calculateScore(attempts) {
  let correctCount = 0;
  let wrongCount = 0;
  let skippedCount = 0;

  attempts.forEach(attempt => {
    if (attempt.userAnswer === null || attempt.userAnswer === undefined) {
      skippedCount++;
    } else if (attempt.isCorrect) {
      correctCount++;
    } else {
      wrongCount++;
    }
  });

  const totalMarks = attempts.length;
  const accuracy = totalMarks > 0 ? (correctCount / totalMarks) * 100 : 0;

  return {
    correctCount,
    wrongCount,
    skippedCount,
    totalMarks,
    accuracy: parseFloat(accuracy.toFixed(2)),
    isPassed: accuracy >= 40
  };
}

/**
 * Identify weak areas from performance data
 */
export function identifyWeakAreas(subjectPerformance, difficultyPerformance) {
  const weakAreas = [];

  // Subject-based weak areas
  subjectPerformance?.forEach(sp => {
    const accuracy = sp.total_questions > 0 ? 
      (sp.correct_answers / sp.total_questions * 100) : 0;
    
    if (accuracy < 50) {
      weakAreas.push({
        type: 'subject',
        name: sp.subject_name,
        accuracy: parseFloat(accuracy.toFixed(1)),
        message: `${sp.subject_name} - Only ${accuracy.toFixed(1)}% accuracy, needs focused study`
      });
    }
  });

  // Difficulty-based weak areas
  difficultyPerformance?.forEach(dp => {
    const accuracy = dp.total_questions > 0 ? 
      (dp.correct_answers / dp.total_questions * 100) : 0;
    
    if (accuracy < 60 && dp.difficulty === 'Hard') {
      weakAreas.push({
        type: 'difficulty',
        name: `${dp.difficulty} Difficulty`,
        accuracy: parseFloat(accuracy.toFixed(1)),
        message: `${dp.difficulty} difficulty - Only ${accuracy.toFixed(1)}% accuracy, practice more complex problems`
      });
    }
  });

  return weakAreas;
}

/**
 * Identify strong areas from performance data
 */
export function identifyStrongAreas(subjectPerformance, difficultyPerformance) {
  const strongAreas = [];

  // Subject-based strong areas
  subjectPerformance?.forEach(sp => {
    const accuracy = sp.total_questions > 0 ? 
      (sp.correct_answers / sp.total_questions * 100) : 0;
    
    if (accuracy > 75) {
      strongAreas.push({
        type: 'subject',
        name: sp.subject_name,
        accuracy: parseFloat(accuracy.toFixed(1)),
        message: `${sp.subject_name} - Excellent grasp of concepts (${accuracy.toFixed(1)}% accuracy)`
      });
    }
  });

  // Difficulty-based strong areas
  difficultyPerformance?.forEach(dp => {
    const accuracy = dp.total_questions > 0 ? 
      (dp.correct_answers / dp.total_questions * 100) : 0;
    
    if (accuracy > 80 && dp.difficulty === 'Easy') {
      strongAreas.push({
        type: 'difficulty',
        name: `${dp.difficulty} Difficulty`,
        accuracy: parseFloat(accuracy.toFixed(1)),
        message: `${dp.difficulty} difficulty questions - Strong fundamentals (${accuracy.toFixed(1)}% accuracy)`
      });
    }
  });

  return strongAreas;
}

/**
 * Generate personalized recommendations based on performance
 */
export function generateRecommendations(scoreData, weakAreas, strongAreas, examDetails) {
  const recommendations = [];
  const { accuracy, isPassed } = scoreData;

  // Critical score-based recommendations
  if (accuracy < 40) {
    recommendations.push({
      priority: 'CRITICAL',
      message: 'Intensive study needed - Target 40% accuracy minimum to pass',
      action: 'Focus on fundamentals and important topics'
    });
  } else if (accuracy < 60) {
    recommendations.push({
      priority: 'HIGH',
      message: 'Focus on weak areas - More practice needed for consistency',
      action: 'Practice 1-2 hours daily on weak subjects'
    });
  } else if (accuracy > 80) {
    recommendations.push({
      priority: 'LOW',
      message: 'Great progress! Maintain consistency',
      action: 'Continue current study strategy'
    });
  }

  // Weak area recommendations
  weakAreas.forEach(weakness => {
    if (weakness.accuracy < 40) {
      recommendations.push({
        priority: 'CRITICAL',
        message: `${weakness.name}: ${weakness.accuracy}% - Critical weakness`,
        action: `Study ${weakness.name} for 1-2 hours daily`
      });
    } else if (weakness.accuracy < 60) {
      recommendations.push({
        priority: 'HIGH',
        message: `${weakness.name}: ${weakness.accuracy}% - Needs improvement`,
        action: `Practice ${weakness.name} for 45 mins daily`
      });
    }
  });

  // Strong area reinforcement
  if (strongAreas.length > 0) {
    recommendations.push({
      priority: 'INFO',
      message: `Maintain strength in ${strongAreas.map(s => s.name).join(', ')}`,
      action: 'Continue regular practice in strong areas'
    });
  }

  // Time-based recommendations
  if (examDetails?.averageTimePerQuestion > examDetails?.benchmarkTime) {
    recommendations.push({
      priority: 'MEDIUM',
      message: 'Speed improvement needed',
      action: 'Practice time-bound tests for better time management'
    });
  }

  return recommendations;
}

/**
 * Calculate percentile and rank
 */
export function calculateRankAndPercentile(userRank, totalTestTakers) {
  if (totalTestTakers === 0) return { rank: 0, percentile: 0 };
  
  const percentile = ((totalTestTakers - userRank) / totalTestTakers * 100);
  
  return {
    rank: userRank,
    percentile: parseFloat(percentile.toFixed(2))
  };
}

/**
 * Determine clearance probability
 */
export function calculateClearanceProbability(accuracyHistory, passingPercentage = 40) {
  if (!accuracyHistory || accuracyHistory.length === 0) return 0;

  const recentAccuracy = accuracyHistory.slice(-5).reduce((a, b) => a + b, 0) / 
                         Math.min(5, accuracyHistory.length);
  
  if (recentAccuracy >= passingPercentage) {
    return Math.min(100, recentAccuracy + 10);
  }
  
  const trend = accuracyHistory.length > 1 ? 
    ((accuracyHistory[accuracyHistory.length - 1] - accuracyHistory[0]) / 
    accuracyHistory[0] * 100) : 0;
  
  return Math.max(20, recentAccuracy + (trend / 2));
}

/**
 * Get performance trend
 */
export function analyzePerformanceTrend(testResults) {
  if (testResults.length < 2) return 'insufficient_data';

  const recentAvg = testResults.slice(-3).reduce((sum, r) => sum + r.accuracy, 0) / 
                   Math.min(3, testResults.length);
  const previousAvg = testResults.slice(0, Math.max(1, testResults.length - 3))
                     .reduce((sum, r) => sum + r.accuracy, 0) / 
                     (testResults.length - Math.min(3, testResults.length));

  const improvement = recentAvg - previousAvg;

  if (improvement > 10) return 'improving_fast';
  if (improvement > 0) return 'improving';
  if (improvement > -5) return 'stable';
  if (improvement > -15) return 'declining';
  return 'declining_fast';
}

/**
 * Calculate study hours recommendation
 */
export function calculateRecommendedStudyHours(currentAccuracy, targetAccuracy = 40) {
  if (currentAccuracy >= targetAccuracy) return 5; // Maintenance
  
  const gap = targetAccuracy - currentAccuracy;
  const baseHours = 25; // Base study hours needed
  const additionalHours = (gap / 10) * 10; // Additional based on gap
  
  return Math.round(baseHours + additionalHours);
}

/**
 * Format score card for display
 */
export function formatScoreCard(resultData) {
  return {
    resultId: resultData.id,
    exam: resultData.exam_name,
    subject: resultData.subject_name,
    testDate: resultData.created_at,
    score: {
      total: resultData.total_score,
      outOf: resultData.total_marks,
      percentage: parseFloat(resultData.accuracy_percentage.toFixed(2))
    },
    status: resultData.is_passed ? 'PASSED' : 'FAILED',
    details: {
      correct: resultData.questions_correct,
      wrong: resultData.questions_wrong,
      skipped: resultData.questions_skipped,
      attempted: resultData.questions_attempted
    },
    ranking: {
      rank: resultData.rank_in_exam,
      percentile: parseFloat((resultData.percentile || 0).toFixed(2))
    },
    timing: {
      totalTime: resultData.total_time_seconds,
      timePerQuestion: resultData.total_time_seconds / resultData.total_marks
    }
  };
}

/**
 * Check if user has sufficient practice
 */
export function checkPracticeSufficiency(testCount, targetTests = 10) {
  if (testCount < targetTests) {
    return {
      sufficient: false,
      message: `Take ${targetTests - testCount} more tests for better consistency evaluation`,
      progress: parseFloat(((testCount / targetTests) * 100).toFixed(2))
    };
  }
  
  return {
    sufficient: true,
    message: 'Good practice history - Performance is reliable',
    progress: 100
  };
}

export default {
  calculateScore,
  identifyWeakAreas,
  identifyStrongAreas,
  generateRecommendations,
  calculateRankAndPercentile,
  calculateClearanceProbability,
  analyzePerformanceTrend,
  calculateRecommendedStudyHours,
  formatScoreCard,
  checkPracticeSufficiency
};
