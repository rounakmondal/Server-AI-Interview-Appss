import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';

// Extract text content from PDF
async function extractFromPDF(buffer) {
    try {
        const data = await pdfParse(buffer);
        return data.text;
    } catch (error) {
        console.error('PDF parsing error:', error);
        throw new Error('Failed to parse PDF file');
    }
}

// Clean and summarize CV text
function cleanCVText(text) {
    // Remove excessive whitespace and newlines
    let cleaned = text.replace(/\s+/g, ' ').trim();

    // Limit to reasonable length for context
    if (cleaned.length > 4000) {
        cleaned = cleaned.substring(0, 4000) + '...';
    }

    return cleaned;
}

// Extract key sections from CV text
function extractKeyInfo(text) {
    const sections = {
        skills: [],
        experience: [],
        education: [],
        projects: []
    };

    // Simple keyword-based extraction
    const skillsMatch = text.match(/skills?[:\s]+([\s\S]*?)(?:experience|education|project|$)/i);
    if (skillsMatch) {
        sections.skills = skillsMatch[1].split(/[,\n]/).map(s => s.trim()).filter(s => s.length > 0);
    }

    const expMatch = text.match(/experience[:\s]+([\s\S]*?)(?:education|skills?|project|$)/i);
    if (expMatch) {
        sections.experience = expMatch[1].substring(0, 500);
    }

    return sections;
}

// Main CV parsing function
export async function parseCV(file) {
    try {
        const buffer = file.buffer || fs.readFileSync(file.path);
        const filename = file.originalname || path.basename(file.path);
        const ext = path.extname(filename).toLowerCase();

        let text = '';

        if (ext === '.pdf') {
            text = await extractFromPDF(buffer);
        } else if (ext === '.txt') {
            text = buffer.toString('utf-8');
        } else {
            // For other formats, try basic text extraction
            text = buffer.toString('utf-8');
        }

        const cleanedText = cleanCVText(text);
        const keyInfo = extractKeyInfo(cleanedText);

        return {
            success: true,
            filename: filename,
            rawText: cleanedText,
            keyInfo: keyInfo
        };
    } catch (error) {
        console.error('CV parsing error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}
