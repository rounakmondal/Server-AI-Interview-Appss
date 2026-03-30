# API Quick Reference

## All 7 Endpoints Implemented ✅

### 1️⃣ Get Syllabus
```bash
GET /api/syllabus/:examId
Params: WBCS, WBPSC, Police_SI, SSC_CGL, Banking
Returns: All chapters grouped by subject with metadata
```

### 2️⃣ Get Study Plan Template
```bash
GET /api/studyplan/template/:examId
Params: WBCS, WBPSC, Police_SI, SSC_CGL, Banking
Returns: 3-phase template (Foundation → Practice → Revision)
```

### 3️⃣ Generate AI Study Plan
```bash
POST /api/studyplan/ai
Body: { examId, examDate: "YYYY-MM-DD", hoursPerDay: number }
Returns: Week-by-week personalized study plan
```

### 4️⃣ Get Syllabus Progress
```bash
GET /api/syllabus/:examId/progress?userId=user123
Params: WBCS, WBPSC, Police_SI, SSC_CGL, Banking
Returns: Overall % complete + subject-wise breakdown
```

### 5️⃣ Get Chapter Questions
```bash
GET /api/test/:chapterId/questions
Params: ch_1 or 1 (accepts both formats)
Returns: 10 MCQ questions without answers revealed
```

### 6️⃣ Submit Test & Get Score
```bash
POST /api/test/submit
Body: { chapterId, userId, answers: [{questionId, selected}...] }
Returns: Accuracy %, score, pass/fail, correct answers
```

### 7️⃣ Get AI Study Guide
```bash
POST /api/ai/chapter-guide
Body: { chapterId, chapterName, userQuery }
Returns: AI-generated markdown study guide
```

---

## Key Files

| File | Purpose |
|------|---------|
| `routes/syllabusApi.js` | All 7 endpoint implementations |
| `utils/examIdMapper.js` | Exam ID string→numeric conversion |
| `index.js` | Route registration (modified) |
| `API_IMPLEMENTATION.md` | Full documentation |

---

## Features

✅ String exam IDs (WBCS, WBPSC, etc)  
✅ Anonymous + authenticated user tracking  
✅ Bilingual (English + Bengali)  
✅ AI-powered study plans & guides  
✅ Server-side answer validation  
✅ Auto progress updates  
✅ Error handling & validation  
✅ Rate limiting included  

---

## To Run

```bash
npm start
# Server starts on http://localhost:8000
# Test: curl http://localhost:8000/api/health
```

---

## Test Exam IDs

- `WBCS` - West Bengal Civil Service
- `WBPSC` - West Bengal Public Service Commission  
- `Police_SI` - Police Sub-Inspector
- `SSC_CGL` - SSC Combined Graduate Level
- `Banking` - Banking IBPS/SBI
