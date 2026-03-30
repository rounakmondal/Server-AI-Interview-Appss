import { Router } from 'express';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

const router = Router();

// ─── Folder whitelist ───────────────────────────────────────────────────────
// Maps lowercase route keys → { displayName, scanPath (relative to PUBLIC_DIR) }
const FOLDER_MAP = {
  police: {
    displayName: 'Police',
    scanPath: path.join('Police', 'police-json-data'),   // scan inside police-json-data/
    pathPrefix: '/Police/police-json-data',               // used in response `path` field
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
};

const ALLOWED_EXTENSIONS = new Set(['.json', '.pdf']);

// ─── Helpers ────────────────────────────────────────────────────────────────

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

  const { displayName, scanPath, pathPrefix } = FOLDER_MAP[folderKey];
  const absoluteScanDir = path.join(PUBLIC_DIR, scanPath);

  try {
    const files = await scanDir(absoluteScanDir);

    const payload = files.map((f) => ({
      name: f.name,
      // Build URL-encoded path: prefix + "/" + encoded relative path segments
      path: pathPrefix + '/' + f.relativePath
        .split('/')
        .map((seg) => encodeURIComponent(seg))
        .join('/'),
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

  const { scanPath } = FOLDER_MAP[folderKey];
  const baseDir = path.join(PUBLIC_DIR, scanPath);

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
    res.setHeader('Content-Type', 'application/json');
    return res.sendFile(resolvedFile);
  }

  if (ext === '.pdf') {
    const fileName = path.basename(resolvedFile);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    return res.sendFile(resolvedFile);
  }
});

export default router;
