# User-Friendly Display Names Guide

## Overview

Technical IDs and filenames are now hidden from users. All API responses include both technical IDs and user-friendly display names.

---

## New Endpoint: Get All Exams with Display Names

```bash
GET /api/exams-list
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "wbcs",
      "technicalName": "WBCS",
      "displayName": "West Bengal Civil Service (WBCS)",
      "nameBn": "ডব্লিউবিসিএস",
      "slug": "wbcs"
    },
    {
      "id": "wb-police-si",
      "technicalName": "WB Police SI",
      "displayName": "West Bengal Police SI",
      "nameBn": "পশ্চিমবঙ্গ পুলিশ এসআই",
      "slug": "wb-police-si"
    },
    {
      "id": "ssc-cgl",
      "technicalName": "SSC CGL",
      "displayName": "SSC Combined Graduate Level (CGL)",
      "nameBn": "এসএসসি সিজিএল",
      "slug": "ssc-cgl"
    },
    // ... more exams
  ]
}
```

---

## Updated API Responses

All endpoints now include **displayName** fields:

### 1. GET `/api/syllabus/:examId`

**Before:**
```json
{
  "examId": "WBCS",
  "totalChapters": 35,
  "subjects": [...]
}
```

**Now:**
```json
{
  "examId": "wbcs",
  "examName": "WBCS",
  "examDisplayName": "West Bengal Civil Service (WBCS)",
  "totalChapters": 35,
  "subjects": [
    {
      "id": "wbcs_1",
      "name": "General Studies",
      "displayName": "General Studies",
      "subjects": [...]
    }
  ]
}
```

### 2. GET `/api/studyplan/template/:examId`

**Now includes:**
```json
{
  "examId": "wbcs",
  "examName": "WBCS",
  "examDisplayName": "West Bengal Civil Service (WBCS)",
  "totalHours": 12,
  "phases": [...]
}
```

### 3. POST `/api/studyplan/ai`

**Now includes:**
```json
{
  "examId": "wbcs",
  "examName": "WBCS",
  "examDisplayName": "West Bengal Civil Service (WBCS)",
  "hoursPerDay": 3,
  "weeks": [...]
}
```

### 4. GET `/api/syllabus/:examId/progress`

**Now includes:**
```json
{
  "examId": "wbcs",
  "examName": "WBCS",
  "examDisplayName": "West Bengal Civil Service (WBCS)",
  "completionPercentage": 35,
  "subjectProgress": [
    {
      "subjectName": "History",
      "displayName": "History",
      "completionPercentage": 50,
      "chaptersCompleted": 3,
      "totalChapters": 6
    }
  ]
}
```

---

## Frontend Implementation Example

### React Component

```typescript
import { useEffect, useState } from 'react';

export function ExamSelector() {
  const [exams, setExams] = useState([]);

  useEffect(() => {
    // Fetch list of all exams with friendly names
    fetch('/api/exams-list')
      .then(res => res.json())
      .then(data => setExams(data.data));
  }, []);

  return (
    <select>
      {exams.map(exam => (
        <option key={exam.id} value={exam.id}>
          {exam.displayName}  {/* Show friendly name to user */}
        </option>
      ))}
    </select>
  );
}

export function SyllabusView({ examId }) {
  const [syllabus, setSyllabus] = useState(null);

  useEffect(() => {
    fetch(`/api/syllabus/${examId}`)
      .then(res => res.json())
      .then(data => setSyllabus(data.data));
  }, [examId]);

  if (!syllabus) return <div>Loading...</div>;

  return (
    <div>
      {/* Display user-friendly name */}
      <h1>{syllabus.examDisplayName}</h1>
      
      <div>
        <p>Total Chapters: {syllabus.totalChapters}</p>
        
        {syllabus.subjects.map(subject => (
          <div key={subject.id}>
            {/* Display friendly subject name */}
            <h2>{subject.displayName || subject.name}</h2>
            <p>Chapters: {subject.chapters.length}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProgressView({ examId, userId }) {
  const [progress, setProgress] = useState(null);

  useEffect(() => {
    fetch(`/api/syllabus/${examId}/progress?userId=${userId}`)
      .then(res => res.json())
      .then(data => setProgress(data.data));
  }, [examId, userId]);

  if (!progress) return <div>Loading...</div>;

  return (
    <div>
      {/* Display user-friendly exam name */}
      <h1>{progress.examDisplayName}</h1>
      
      <div className="progress-bar">
        <div style={{ width: `${progress.completionPercentage}%` }}>
          {progress.completionPercentage}% Complete
        </div>
      </div>

      {progress.subjectProgress.map(subject => (
        <div key={subject.subjectId}>
          {/* Display friendly subject name */}
          <h3>{subject.displayName || subject.subjectName}</h3>
          <p>
            {subject.chaptersCompleted}/{subject.totalChapters} chapters - 
            {subject.completionPercentage}%
          </p>
        </div>
      ))}
    </div>
  );
}
```

---

## Mapping Reference

### Exam Display Names
| Technical ID | Display Name |
|---|---|
| `wbcs` | West Bengal Civil Service (WBCS) |
| `wbpsc` | West Bengal PSC - Clerkship |
| `wb-police-si` | West Bengal Police SI |
| `ssc-cgl` | SSC Combined Graduate Level (CGL) |
| `banking-ibps-sbi` | Banking IBPS / SBI |

### Subject Display Names
| Technical Name | Display Name |
|---|---|
| `general-studies` | General Studies |
| `reasoning` | Reasoning & Logic |
| `mathematics` | Mathematics / Quantitative Aptitude |
| `english` | English Language |
| `polity` | Indian Polity & Constitution |
| `history` | History |
| `geography` | Geography |

### Filename Display Names
| Filename | Display Name |
|---|---|
| `WBP-SI-Police-2018.json` | West Bengal Police SI - 2018 |
| `WBP-SI-Police-2024.json` | West Bengal Police SI - 2024 |
| `WBCS-GS-2021.json` | WBCS General Studies - 2021 |
| `SSC-CGL-2020.json` | SSC CGL - 2020 |
| `Banking-IBPS-2019.json` | Banking IBPS - 2019 |

---

## Best Practices

1. **Always use `displayName` in UI:** Show user-friendly names in frontend
   ```tsx
   <h1>{exam.displayName}</h1>  // ✅ Good
   <h1>{exam.id}</h1>            // ❌ Avoid
   ```

2. **Use technical IDs for API calls:** Keep using `id` or `examId` for backend requests
   ```tsx
   fetch(`/api/syllabus/${exam.id}`)  // ✅ Correct
   fetch(`/api/syllabus/${exam.displayName}`)  // ❌ Wrong
   ```

3. **Cache display names:** Fetch `/api/exams-list` once on app load
   ```tsx
   const examMap = new Map(
     exams.map(e => [e.id, e.displayName])
   );
   // Use later: examMap.get('wbcs')
   ```

4. **Fallback gracefully:** Handle missing display names
   ```tsx
   <h2>{subject.displayName || subject.name}</h2>
   ```

---

## Adding New Display Names

To add a new exam or update display names, edit `utils/friendlyNames.js`:

```javascript
export const EXAM_DISPLAY_NAMES = {
  'new-exam-slug': 'New Exam - Full Name',
  // ... existing entries
};

export const SUBJECT_DISPLAY_NAMES = {
  'new-subject': 'New Subject - Full Name',
  // ... existing entries
};

export const FILENAME_DISPLAY_NAMES = {
  'New-Exam-2024.json': 'New Exam - 2024',
  // ... existing entries
};
```

Then use the functions to get display names:
- `getExamDisplayName(examId)`
- `getSubjectDisplayName(subjectName)`
- `getFilenameDisplayName(filename)`

---

## Summary

✅ **Technical IDs remain** (wbcs, wb-police-si, etc.) for API consistency  
✅ **Display names added** to all responses for frontend use  
✅ **New endpoint** `/api/exams-list` shows all exams with display names  
✅ **Filename handling** - "WBP-SI-Police-2018.json" → "West Bengal Police SI - 2018"  
✅ **Subject naming** - All subjects have friendly display names  

Users never see technical filenames or IDs—only beautiful, readable names! 🎉
