const { PDFParse } = require("pdf-parse");

/**
 * POST /api/extract-pdf
 * Body: { data: string } — base64-encoded PDF bytes
 * Returns: { text: string }
 *
 * Uses pdf-parse which runs natively in Node.js / serverless — no worker, no MIME issues.
 */
const handleExtractPdf = async (req, res) => {
  try {
    const { data } = req.body;

    if (!data) {
      res.status(400).json({ error: "Missing base64 PDF data" });
      return;
    }

    // Decode base64 → Buffer
    const buffer = Buffer.from(data, "base64");

    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    const text = result.text.trim();

    if (text.length < 30) {
      res.status(422).json({
        error: "Could not extract readable text. The PDF may be image-based or scanned.",
      });
      return;
    }

    res.json({ text });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("PDF extraction error:", message);
    res.status(500).json({ error: `PDF extraction failed: ${message}` });
  }
};

module.exports = { handleExtractPdf };