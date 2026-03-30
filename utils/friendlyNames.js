/**
 * friendlyNames.js — User-friendly display names for exams and files
 * Maps technical IDs and filenames to readable display names
 */

export const EXAM_DISPLAY_NAMES = {
    // Technical ID → User-friendly name
    'wbcs': 'West Bengal Civil Service (WBCS)',
    'WBCS': 'West Bengal Civil Service (WBCS)',
    
    'wbpsc': 'West Bengal PSC - Clerkship',
    'WBPSC': 'West Bengal PSC - Clerkship',
    
    'wb-police-si': 'West Bengal Police SI',
    'Police_SI': 'West Bengal Police SI',
    'WB-Police-SI': 'West Bengal Police SI',
    
    'ssc-cgl': 'SSC Combined Graduate Level (CGL)',
    'SSC_CGL': 'SSC Combined Graduate Level (CGL)',
    
    'banking-ibps-sbi': 'Banking IBPS / SBI',
    'Banking': 'Banking IBPS / SBI',
};

export const FILENAME_DISPLAY_NAMES = {
    // Filename patterns → User-friendly names
    'WBP-SI-Police-2018.json': 'West Bengal Police SI - 2018',
    'WBP-SI-Police-2019.json': 'West Bengal Police SI - 2019',
    'WBP-SI-Police-2020.json': 'West Bengal Police SI - 2020',
    'WBP-SI-Police-2021.json': 'West Bengal Police SI - 2021',
    'WBP-SI-Police-2022.json': 'West Bengal Police SI - 2022',
    'WBP-SI-Police-2023.json': 'West Bengal Police SI - 2023',
    'WBP-SI-Police-2024.json': 'West Bengal Police SI - 2024',
    
    'WBCS-GS-2018.json': 'WBCS General Studies - 2018',
    'WBCS-GS-2019.json': 'WBCS General Studies - 2019',
    'WBCS-GS-2020.json': 'WBCS General Studies - 2020',
    'WBCS-GS-2021.json': 'WBCS General Studies - 2021',
    
    'SSC-CGL-2018.json': 'SSC CGL - 2018',
    'SSC-CGL-2019.json': 'SSC CGL - 2019',
    'SSC-CGL-2020.json': 'SSC CGL - 2020',
    
    'Banking-IBPS-2018.json': 'Banking IBPS - 2018',
    'Banking-IBPS-2019.json': 'Banking IBPS - 2019',
    'Banking-SBI-2018.json': 'Banking SBI - 2018',
    'Banking-SBI-2019.json': 'Banking SBI - 2019',
};

export const LEVEL_DISPLAY_NAMES = {
    'constable': 'Constable',
    'si': 'Sub-Inspector (SI)',
    'sub-inspector': 'Sub-Inspector (SI)',
    'inspector': 'Inspector',
    'asi': 'Assistant Sub-Inspector (ASI)',
};

export const SUBJECT_DISPLAY_NAMES = {
    'general-knowledge': 'General Knowledge',
    'general-studies': 'General Studies',
    'reasoning': 'Reasoning & Logic',
    'mathematics': 'Mathematics / Quantitative Aptitude',
    'english': 'English Language',
    'bengali': 'Bengali',
    'polity': 'Indian Polity & Constitution',
    'history': 'History',
    'geography': 'Geography',
    'economy': 'Economy',
    'science': 'Science',
};

/**
 * Get user-friendly display name from exam ID
 */
export function getExamDisplayName(examId) {
    return EXAM_DISPLAY_NAMES[examId] || examId;
}

/**
 * Get user-friendly display name from filename
 */
export function getFilenameDisplayName(filename) {
    // Check exact match first
    if (FILENAME_DISPLAY_NAMES[filename]) {
        return FILENAME_DISPLAY_NAMES[filename];
    }
    
    // Try pattern matching if not exact match
    for (const [pattern, displayName] of Object.entries(FILENAME_DISPLAY_NAMES)) {
        if (filename.toLowerCase().includes(pattern.replace('.json', ''))) {
            return displayName;
        }
    }
    
    // Fallback: convert filename to readable format
    // "WBP-SI-Police-2018.json" → "WBP SI Police 2018"
    return filename
        .replace('.json', '')
        .replace(/-/g, ' ')
        .replace(/([A-Z])/g, ' $1')
        .trim();
}

/**
 * Get user-friendly level name
 */
export function getLevelDisplayName(level) {
    return LEVEL_DISPLAY_NAMES[level?.toLowerCase()] || level;
}

/**
 * Get user-friendly subject name
 */
export function getSubjectDisplayName(subject) {
    return SUBJECT_DISPLAY_NAMES[subject?.toLowerCase().replace(/\s+/g, '-')] || subject;
}

/**
 * Format exam info for API response
 * Keeps technical ID for backend but provides displayName for UI
 */
export function getExamInfo(examId, filename = null) {
    return {
        id: examId,
        displayName: getExamDisplayName(examId),
        filename: filename,
        filenameDisplay: filename ? getFilenameDisplayName(filename) : null,
    };
}
