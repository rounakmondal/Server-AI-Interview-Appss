import pdf from "pdf-parse";

export const handleExtractPdf = async (req, res) => {
  try {
    const { data } = req.body;

    if (!data) {
      return res.status(400).json({ error: "Missing base64 PDF data" });
    }

    const buffer = Buffer.from(data, "base64");

    const result = await pdf(buffer);
    const text = result.text.trim();

    if (text.length < 30) {
      return res.status(422).json({
        error: "Could not extract readable text. The PDF may be scanned."
      });
    }

    res.json({ text });

  } catch (err) {
    console.error("PDF extraction error:", err);
    res.status(500).json({ error: "PDF extraction failed" });
  }
};
