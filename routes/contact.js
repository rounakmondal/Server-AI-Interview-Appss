import nodemailer from "nodemailer";

const categoryLabels = {
  general: "General Inquiry",
  support: "Technical Support",
  billing: "Billing & Subscriptions",
  feedback: "Feedback & Suggestions",
  bug: "Report a Bug",
  partnership: "Business & Partnerships",
  privacy: "Privacy & Data",
  other: "Other",
};

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true", // true for port 465, false for 587
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

export const handleContact = async (req, res) => {
  const { name, email, subject, category, message } = req.body;

  // Basic validation
  if (!name || !email || !subject || !message) {
    res.status(400).json({ error: "Missing required fields." });
    return;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    res.status(400).json({ error: "Invalid email address." });
    return;
  }

  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.error("SMTP credentials not configured.");
    res.status(500).json({ error: "Email service not configured." });
    return;
  }

  try {
    const transporter = createTransporter();
    const categoryLabel = categoryLabels[category] || category;
    const toAddress = process.env.CONTACT_RECEIVER || "aiinterview0@gmail.com";

    // Email to site owner
    await transporter.sendMail({
      from: `"InterviewAI Contact Form" <${process.env.SMTP_USER}>`,
      to: toAddress,
      replyTo: email,
      subject: `[${categoryLabel}] ${subject}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9fafb; border-radius: 12px;">
          <div style="background: #2F50B7; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">InterviewAI</h1>
            <p style="color: rgba(255,255,255,0.8); margin: 4px 0 0; font-size: 14px;">New Contact Form Submission</p>
          </div>
          <div style="background: white; padding: 24px; border-radius: 0 0 8px 8px; border: 1px solid #e5e7eb; border-top: none;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; font-weight: bold; color: #374151; width: 140px;">Name</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; color: #111827;">${name}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; font-weight: bold; color: #374151;">Email</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; color: #111827;"><a href="mailto:${email}" style="color: #2F50B7;">${email}</a></td>
              </tr>
              <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; font-weight: bold; color: #374151;">Category</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; color: #111827;">${categoryLabel}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; font-weight: bold; color: #374151;">Subject</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; color: #111827;">${subject}</td>
              </tr>
            </table>
            <div style="margin-top: 20px;">
              <p style="font-weight: bold; color: #374151; margin: 0 0 8px;">Message</p>
              <div style="background: #f9fafb; padding: 16px; border-radius: 8px; border-left: 4px solid #2F50B7; color: #374151; line-height: 1.6; white-space: pre-wrap;">${message}</div>
            </div>
            <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 13px; margin: 0;">Reply directly to this email to respond to ${name}.</p>
            </div>
          </div>
        </div>
      `,
    });

    // Auto-reply to the sender
    await transporter.sendMail({
      from: `"InterviewAI" <${process.env.SMTP_USER}>`,
      to: email,
      subject: `We received your message — ${subject}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9fafb; border-radius: 12px;">
          <div style="background: #2F50B7; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">InterviewAI</h1>
            <p style="color: rgba(255,255,255,0.8); margin: 4px 0 0; font-size: 14px;">We got your message!</p>
          </div>
          <div style="background: white; padding: 24px; border-radius: 0 0 8px 8px; border: 1px solid #e5e7eb; border-top: none;">
            <p style="color: #111827; font-size: 16px; line-height: 1.6;">Hi <strong>${name}</strong>,</p>
            <p style="color: #374151; line-height: 1.6;">
              Thank you for reaching out! We've received your message and will get back to you within <strong>24–48 hours</strong> during business days.
            </p>
            <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 20px 0;">
              <p style="color: #6b7280; font-size: 13px; margin: 0 0 8px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.05em;">Your message summary</p>
              <p style="color: #374151; margin: 0;"><strong>Subject:</strong> ${subject}</p>
              <p style="color: #374151; margin: 4px 0 0;"><strong>Category:</strong> ${categoryLabel}</p>
            </div>
            <p style="color: #374151; line-height: 1.6;">
              In the meantime, feel free to explore our platform and start practicing your interview skills!
            </p>
            <div style="text-align: center; margin: 28px 0;">
              <a href="${process.env.VITE_APP_URL || "https://interviewai.in"}/setup" 
                 style="background: #2F50B7; color: white; padding: 12px 28px; border-radius: 50px; text-decoration: none; font-weight: bold; font-size: 15px;">
                Start Practicing
              </a>
            </div>
            <p style="color: #9ca3af; font-size: 13px; text-align: center; margin-top: 24px; border-top: 1px solid #e5e7eb; padding-top: 16px;">
              © 2026 InterviewAI · <a href="mailto:aiinterview0@gmail.com" style="color: #2F50B7;">aiinterview0@gmail.com</a>
            </p>
          </div>
        </div>
      `,
    });

    res.json({ success: true, message: "Message sent successfully." });
  } catch (err) {
    console.error("SMTP error:", err);
    res.status(500).json({ error: "Failed to send email. Please try again." });
  }
};
