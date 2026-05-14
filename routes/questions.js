import { Router } from 'express';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const MOCK_TEST_DIR = path.resolve(__dirname, '..', '..', 'Ai_Interview', 'public', 'mock_test');

const router = Router();

// ─── Folder whitelist ───────────────────────────────────────────────────────
// Maps lowercase route keys → { displayName, scanPath (relative to PUBLIC_DIR), baseDir? (override) }
const FOLDER_MAP = {
  police: {
    displayName: 'Police',
    scanPath: 'police',                                   // server's public/police/ directory
    pathPrefix: '/Police/police-json-data',               // must match Ai_Interview/public/Police/police-json-data/
  },
  wbcs: {
    displayName: 'WBCS',
    scanPath: 'WBCS',                                     // scan entire WBCS/ (includes wbcs_json_data/)
    pathPrefix: '/WBCS',
  },
  wbpsc: {
    displayName: 'WBPSC',
    scanPath: 'WBPSC',
    pathPrefix: '/WBPSC',
  },
  ssc: {
    displayName: 'SSC',
    scanPath: 'SSC',                                      // scan entire SSC/ (includes MTS/)
    pathPrefix: '/SSC',
  },
  'wb-primary-tet': {
    displayName: 'WB Primary TET Question',
    scanPath: 'WB Primary TET Question',
    pathPrefix: '/WB Primary TET Question',
  },
  ibps: {
    displayName: 'IBPS',
    scanPath: 'IBPS',
    pathPrefix: '/IBPS',
  },
  jtet: {
    displayName: 'JTET',
    scanPath: 'JTET',
    pathPrefix: '/JTET',
  },
  'rrb-ntpc': {
    displayName: 'RRB NTPC',
    scanPath: 'RRB-NTPC',
    pathPrefix: '/RRB-NTPC',
  },
  // ── Mock Test folders (from Ai_Interview/public/mock_test/) ──
  'mock-wbcs': {
    displayName: 'WBCS Mock Tests',
    scanPath: 'wbcs',
    pathPrefix: '/mock_test/wbcs',
    baseDir: MOCK_TEST_DIR,
  },
  'mock-wbpsc': {
    displayName: 'WBPSC Mock Tests',
    scanPath: 'wbpsc',
    pathPrefix: '/mock_test/wbpsc',
    baseDir: MOCK_TEST_DIR,
  },
  'mock-wbp-si': {
    displayName: 'WBP SI Mock Tests',
    scanPath: 'wbp_si',
    pathPrefix: '/mock_test/wbp_si',
    baseDir: MOCK_TEST_DIR,
  },
  'mock-wbp-constable': {
    displayName: 'WBP Constable Mock Tests',
    scanPath: 'wbp_constable',
    pathPrefix: '/mock_test/wbp_constable',
    baseDir: MOCK_TEST_DIR,
  },
  'mock-ssc-mts': {
    displayName: 'SSC MTS Mock Tests',
    scanPath: 'ssc_mts',
    pathPrefix: '/mock_test/ssc_mts',
    baseDir: MOCK_TEST_DIR,
  },
  'mock-ssc-cgl': {
    displayName: 'SSC CGL Mock Tests',
    scanPath: 'ssc_cgl',
    pathPrefix: '/mock_test/ssc_cgl',
    baseDir: MOCK_TEST_DIR,
  },
  'mock-ibps-po': {
    displayName: 'IBPS PO Mock Tests',
    scanPath: 'ibps_po',
    pathPrefix: '/mock_test/ibps_po',
    baseDir: MOCK_TEST_DIR,
  },
  'mock-jtet': {
    displayName: 'JTET Mock Tests',
    scanPath: 'jtet',
    pathPrefix: '/mock_test/jtet',
    baseDir: MOCK_TEST_DIR,
  },
};

const ALLOWED_EXTENSIONS = new Set(['.json', '.pdf']);

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Map numeric option keys (1,2,3,4) to letter keys (A,B,C,D).
 */
const NUM_TO_LETTER = { '1': 'A', '2': 'B', '3': 'C', '4': 'D' };

/**
 * Detect and normalize non-standard JSON formats (e.g. JTET bilingual)
 * into the standard format the frontend expects:
 *   { exam, sections: [{ section, subject, questions: [{ q_no, question, options: {A,B,C,D}, answer }] }] }
 */
function normalizeExamJSON(data) {
  // Already standard format — has flat `questions[]` or `sections[]` with `question` field
  if (Array.isArray(data.questions) && data.questions[0]?.question) return data;
  if (Array.isArray(data.sections) && data.sections[0]?.questions?.[0]?.question) return data;

  // JTET-style: has `parts[]` with `question_en`/`options_en`
  if (Array.isArray(data.parts) && data.parts[0]?.questions?.[0]?.question_en) {
    return {
      exam: data.exam || data.exam_title || 'Unknown Exam',
      total_questions: data.total_questions,
      sections: data.parts.map((part) => ({
        section: part.part,
        subject: part.subject_en || part.subject_hi || '',
        questions: part.questions.map((q) => {
          // Build normalized options: { A, B, C, D }
          const rawOpts = q.options_en || q.options_hi || {};
          const options = {};
          for (const [key, val] of Object.entries(rawOpts)) {
            const letterKey = NUM_TO_LETTER[key] || key;
            options[letterKey] = val;
          }
          return {
            q_no: q.q_no,
            question: q.question_en || q.question_hi || '',
            question_hi: q.question_hi || undefined,
            options,
            answer: q.answer
              ? (NUM_TO_LETTER[String(q.answer)] || q.answer)
              : undefined,
          };
        }),
      })),
    };
  }

  // Unknown format — return as-is
  return data;
}

/**
 * Recursively collect files with allowed extensions from a directory.
 * Returns array of { name, absolutePath, relativePath, size }.
 */
async function scanDir(baseDir, currentDir = '') {
  const results = [];
  const fullDir = path.join(baseDir, currentDir);

  let entries;
  try {
    entries = await fs.readdir(fullDir, { withFileTypes: true });
  } catch {
    // Directory doesn't exist – return empty
    return results;
  }

  for (const entry of entries) {
    const relPath = currentDir ? path.join(currentDir, entry.name) : entry.name;

    if (entry.isDirectory()) {
      // Recurse into subdirectories
      const sub = await scanDir(baseDir, relPath);
      results.push(...sub);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (ALLOWED_EXTENSIONS.has(ext)) {
        const stat = await fs.stat(path.join(fullDir, entry.name));
        results.push({
          name: entry.name,
          // Use forward-slash relative path for consistent URL building
          relativePath: relPath.replace(/\\/g, '/'),
          size: stat.size,
        });
      }
    }
  }

  return results;
}

/**
 * Returns true if `resolvedPath` is safely inside `baseDir` (no traversal).
 */
function isSafePath(resolvedPath, baseDir) {
  const normalizedResolved = path.resolve(resolvedPath);
  const normalizedBase = path.resolve(baseDir);
  return normalizedResolved.startsWith(normalizedBase + path.sep) ||
         normalizedResolved === normalizedBase;
}

// ─── Endpoint 1: GET /api/questions/:folder ─────────────────────────────────
// Lists all JSON / PDF files in a whitelisted folder (recursive).
router.get('/:folder', async (req, res) => {
  const folderKey = req.params.folder.toLowerCase();

  // Whitelist check
  if (!FOLDER_MAP[folderKey]) {
    return res.status(400).json({
      success: false,
      error: `Invalid folder "${req.params.folder}". Allowed: ${Object.keys(FOLDER_MAP).join(', ')}`,
    });
  }

  const { displayName, scanPath, pathPrefix, baseDir } = FOLDER_MAP[folderKey];
  const absoluteScanDir = path.join(baseDir || PUBLIC_DIR, scanPath);

  try {
    const files = await scanDir(absoluteScanDir);

    // Filter out manifest.json from results
    const filtered = files.filter((f) => f.name.toLowerCase() !== 'manifest.json');

    const payload = filtered.map((f) => ({
      name: f.name,
      // Build URL-encoded path: prefix + "/" + encoded relative path segments
      path: pathPrefix + '/' + f.relativePath
        .split('/')
        .map((seg) => encodeURIComponent(seg))
        .join('/'),
      // Relative path for API calls (GET /api/questions/:folder/<relativePath>)
      relativePath: f.relativePath,
      size: f.size,
    }));

    return res.json({
      success: true,
      folder: displayName,
      count: payload.length,
      files: payload,
    });
  } catch (err) {
    console.error(`[questions] Error scanning folder "${folderKey}":`, err);
    return res.status(500).json({ success: false, error: 'Failed to list files' });
  }
});

// ─── Endpoint 2: GET /api/questions/:folder/:path(*) ────────────────────────
// Serves a specific JSON or PDF file from a whitelisted folder.
router.get('/:folder/*', async (req, res) => {
  const folderKey = req.params.folder.toLowerCase();

  // Whitelist check
  if (!FOLDER_MAP[folderKey]) {
    return res.status(400).json({
      success: false,
      error: `Invalid folder "${req.params.folder}". Allowed: ${Object.keys(FOLDER_MAP).join(', ')}`,
    });
  }

  const entry = FOLDER_MAP[folderKey];
  const resolvedBase = path.join(entry.baseDir || PUBLIC_DIR, entry.scanPath);
  const baseDir = resolvedBase;

  // Capture the wildcard portion (everything after /:folder/)
  // Express 4 puts wildcard in req.params[0]
  const wildcardPath = req.params[0] || '';

  // URL-decode each segment to handle spaces / encoded characters
  const decodedSegments = wildcardPath
    .split('/')
    .filter(Boolean)
    .map((seg) => decodeURIComponent(seg));

  if (decodedSegments.length === 0) {
    return res.status(400).json({ success: false, error: 'No file path specified' });
  }

  // Build the resolved absolute path
  const resolvedFile = path.resolve(baseDir, ...decodedSegments);

  // ── Security: directory traversal prevention ──────────────────────────────
  if (!isSafePath(resolvedFile, baseDir)) {
    console.warn(`[questions] Blocked traversal attempt: ${wildcardPath}`);
    return res.status(403).json({ success: false, error: 'Access denied' });
  }

  // ── Extension check ───────────────────────────────────────────────────────
  const ext = path.extname(resolvedFile).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return res.status(400).json({
      success: false,
      error: `File type "${ext}" is not allowed. Only .json and .pdf files are served.`,
    });
  }

  // ── File existence ────────────────────────────────────────────────────────
  try {
    await fs.access(resolvedFile);
  } catch {
    return res.status(404).json({ success: false, error: 'File not found' });
  }

  // ── Serve the file ────────────────────────────────────────────────────────
  if (ext === '.json') {
    try {
      const raw = await fs.readFile(resolvedFile, 'utf-8');
      const parsed = JSON.parse(raw);
      const normalized = normalizeExamJSON(parsed);
      res.setHeader('Content-Type', 'application/json');
      return res.json(normalized);
    } catch (parseErr) {
      // Fallback: serve raw file if JSON parse/normalize fails
      console.warn('[questions] JSON normalize failed, serving raw:', parseErr.message);
      res.setHeader('Content-Type', 'application/json');
      return res.sendFile(resolvedFile);
    }
  }

  if (ext === '.pdf') {
    const fileName = path.basename(resolvedFile);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    return res.sendFile(resolvedFile);
  }
});

export default router;
