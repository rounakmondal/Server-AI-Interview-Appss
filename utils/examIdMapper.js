/**
 * examIdMapper.js — Maps string exam IDs (e.g., "WBCS") to numeric database IDs.
 * Handles both slug format and exam name format.
 */

import { examQueries } from '../database/examDb.js';

// Cache for exam mappings
const exemIdCache = new Map();

/**
 * Convert exam string ID (e.g., "WBCS", "wbcs", "WBPSC") to numeric database ID
 * Returns null if exam not found
 */
export function getExamIdBySlug(examSlug) {
    if (!examSlug) return null;

    // Check cache first
    const slugNorm = String(examSlug).toLowerCase().trim();
    if (exemIdCache.has(slugNorm)) {
        return exemIdCache.get(slugNorm);
    }

    // Query database
    const exams = examQueries.listAll();
    for (const exam of exams) {
        const slug = String(exam.slug).toLowerCase();
        const name = String(exam.name).toLowerCase();

        // Try matching by slug or name
        if (slug === slugNorm || name === slugNorm) {
            exemIdCache.set(slugNorm, exam.id);
            return exam.id;
        }
    }

    return null;
}

/**
 * Get exam info by string ID
 */
export function getExamBySlug(examSlug) {
    const id = getExamIdBySlug(examSlug);
    if (!id) return null;
    return examQueries.getById(id);
}

/**
 * Map supported exam IDs
 */
export const EXAM_IDS = {
    WBCS: 'wbcs',
    WBPSC: 'wbpsc',
    Police_SI: 'wb-police-si',
    SSC_CGL: 'ssc-cgl',
    Banking: 'banking-ibps-sbi',
};

/**
 * Normalize chapter ID (accepts "ch_1", "1", 1 formats)
 */
export function normalizeChapterId(chapterId) {
    if (!chapterId && chapterId !== 0) return null;
    const str = String(chapterId);
    const match = str.match(/\d+/);
    return match ? parseInt(match[0], 10) : null;
}
