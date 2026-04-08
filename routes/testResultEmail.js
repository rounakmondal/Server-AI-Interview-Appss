import nodemailer from "nodemailer";

/**
 * Test Result Email API
 * Sends professional HTML email with test results and performance metrics
 */

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function getPerformanceColor(accuracy) {
  if (accuracy >= 60) return { color: "#10b981", label: "Great Job!", emoji: "🟢" };
  if (accuracy >= 40) return { color: "#f59e0b", label: "Keep Practicing!", emoji: "🟡" };
  return { color: "#ef4444", label: "Don't Worry!", emoji: "🔴" };
}

function generateHTMLEmail(data) {
  const { name, exam, subject, accuracy, correct, total, timeTaken, weakAreas } = data;
  const performance = getPerformanceColor(accuracy);
  const wrong = total - correct;

  // Weak areas section (only show if any subject < 70%)
  const hasWeakAreas = weakAreas && weakAreas.some(area => area.accuracy < 70);
  const sortedWeakAreas = hasWeakAreas 
    ? weakAreas.filter(area => area.accuracy < 70).sort((a, b) => a.accuracy - b.accuracy)
    : [];

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Your Test Results</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Ubuntu, sans-serif; background: #f9fafb; line-height: 1.6;">
      <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
        
        <!-- Header Banner -->
        <div style="background: linear-gradient(135deg, #2F50B7 0%, #1e3a8a 100%); padding: 40px 24px; border-radius: 12px 12px 0 0; text-align: center; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 700;">🎯 Your Test Results</h1>
          <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">Complete Analysis & Performance Breakdown</p>
        </div>

        <!-- Performance Card -->
        <div style="background: white; padding: 32px; text-align: center; border-top: 4px solid ${performance.color}; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
          <div style="font-size: 48px; margin-bottom: 12px;">${performance.emoji}</div>
          <h2 style="color: ${performance.color}; font-size: 24px; margin: 0 0 8px 0; font-weight: 700;">${performance.label}</h2>
          <div style="background: ${performance.color}; color: white; font-size: 36px; font-weight: 700; padding: 20px; border-radius: 8px; margin: 16px 0;">
            ${accuracy}%
          </div>
          <p style="color: #6b7280; margin: 12px 0 0 0; font-size: 14px;">Accuracy Score</p>
        </div>

        <!-- Test Details -->
        <div style="background: white; padding: 24px; display: flex; gap: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
          <div style="flex: 1; padding: 16px; background: #f3f4f6; border-radius: 8px; text-align: center;">
            <p style="color: #6b7280; font-size: 12px; margin: 0; text-transform: uppercase; font-weight: 600;">Exam</p>
            <p style="color: #111827; font-size: 16px; font-weight: 700; margin: 4px 0 0 0;">${exam}</p>
          </div>
          <div style="flex: 1; padding: 16px; background: #f3f4f6; border-radius: 8px; text-align: center;">
            <p style="color: #6b7280; font-size: 12px; margin: 0; text-transform: uppercase; font-weight: 600;">Subject</p>
            <p style="color: #111827; font-size: 16px; font-weight: 700; margin: 4px 0 0 0;">${subject || "Mixed"}</p>
          </div>
        </div>

        <!-- Score Breakdown -->
        <div style="background: white; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
          <h3 style="color: #111827; font-size: 16px; font-weight: 700; margin: 0 0 16px 0;">Score Breakdown</h3>
          
          <div style="display: flex; gap: 12px; margin-bottom: 16px;">
            <div style="flex: 1;">
              <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 16px; border-radius: 8px; text-align: center; color: white;">
                <div style="font-size: 24px; font-weight: 700;">${correct}</div>
                <div style="font-size: 12px; opacity: 0.9; margin-top: 4px;">Correct</div>
              </div>
            </div>
            <div style="flex: 1;">
              <div style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); padding: 16px; border-radius: 8px; text-align: center; color: white;">
                <div style="font-size: 24px; font-weight: 700;">${wrong}</div>
                <div style="font-size: 12px; opacity: 0.9; margin-top: 4px;">Wrong/Skipped</div>
              </div>
            </div>
            <div style="flex: 1;">
              <div style="background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); padding: 16px; border-radius: 8px; text-align: center; color: white;">
                <div style="font-size: 24px; font-weight: 700;">${total}</div>
                <div style="font-size: 12px; opacity: 0.9; margin-top: 4px;">Total</div>
              </div>
            </div>
          </div>

          <!-- Progress Bar -->
          <div style="background: #e5e7eb; height: 8px; border-radius: 4px; overflow: hidden;">
            <div style="background: linear-gradient(90deg, #10b981, #059669); width: ${accuracy}%; height: 100%; transition: width 0.3s ease;"></div>
          </div>
        </div>

        <!-- Time Taken -->
        <div style="background: white; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); border-left: 4px solid #3b82f6;">
          <p style="color: #6b7280; font-size: 12px; margin: 0; text-transform: uppercase; font-weight: 600;">⏱️ Time Taken</p>
          <p style="color: #111827; font-size: 24px; font-weight: 700; margin: 8px 0 0 0;">${timeTaken}</p>
        </div>

        ${hasWeakAreas ? `
          <!-- Weak Areas Section -->
          <div style="background: white; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
            <h3 style="color: #111827; font-size: 16px; font-weight: 700; margin: 0 0 16px 0;">📊 Areas to Improve</h3>
            
            ${sortedWeakAreas.map((area, index) => `
              <div style="margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid #f3f4f6;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                  <span style="color: #111827; font-weight: 600; font-size: 14px;">${area.name}</span>
                  <span style="color: #ef4444; font-weight: 700; font-size: 14px;">${area.accuracy}%</span>
                </div>
                <div style="background: #f3f4f6; height: 6px; border-radius: 3px; overflow: hidden;">
                  <div style="background: linear-gradient(90deg, #ef4444, #dc2626); width: ${area.accuracy}%; height: 100%; border-radius: 3px;"></div>
                </div>
              </div>
            `).join('')}

            <div style="background: #fef3c7; padding: 12px; border-radius: 6px; border-left: 4px solid #f59e0b;">
              <p style="color: #92400e; font-size: 13px; margin: 0; font-weight: 500;">💡 Tip: Focus on these areas first for maximum improvement</p>
            </div>
          </div>
        ` : ''}

        <!-- Improvements Section -->
        <div style="background: linear-gradient(135deg, #dbeafe 0%, #e0e7ff 100%); padding: 24px; margin: 20px 0; border-radius: 12px; border-left: 4px solid #3b82f6;">
          <h3 style="color: #1e40af; font-size: 16px; font-weight: 700; margin: 0 0 12px 0;">✨ Next Steps to Excel</h3>
          <ul style="color: #1e40af; margin: 0; padding-left: 20px; font-size: 14px;">
            <li style="margin-bottom: 8px;">Review weak areas with updated study materials</li>
            <li style="margin-bottom: 8px;">Practice similar questions from previous papers</li>
            <li style="margin-bottom: 8px;">Take another full-length mock test to track progress</li>
            <li>Join our study groups for peer learning and support</li>
          </ul>
        </div>

        <!-- CTA Button -->
        <div style="text-align: center; margin: 24px 0;">
          <a href="https://medhahub.in/govt-practice" style="display: inline-block; background: linear-gradient(135deg, #2F50B7 0%, #1e3a8a 100%); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 16px; border: none; cursor: pointer; box-shadow: 0 4px 6px rgba(47, 80, 183, 0.3); transition: transform 0.2s ease;">
            📝 Take Another Test
          </a>
        </div>

        <!-- Footer -->
        <div style="background: #f9fafb; padding: 24px; text-align: center; border-radius: 0 0 12px 12px; border-top: 1px solid #e5e7eb;">
          <p style="color: #6b7280; font-size: 12px; margin: 0 0 8px 0;">
            Keep practicing to improve your skills<br>
            Good luck with your exam preparation! 🚀
          </p>
          <p style="color: #9ca3af; font-size: 11px; margin: 12px 0 0 0;">
            MedhaHub - Your AI Interview & Exam Preparation Partner<br>
            © 2026 MedhaHub. All rights reserved.
          </p>
        </div>

      </div>
    </body>
    </html>
  `;
}

export async function sendTestResultEmail(req, res) {
  const { email, name, exam, subject, accuracy, correct, total, timeTaken, weakAreas } = req.body;

  // Validation
  if (!email || !name || !exam || accuracy === undefined || !correct || !total || !timeTaken) {
    return res.status(400).json({
      success: false,
      error: "VALIDATION_ERROR",
      message: "Missing required fields: email, name, exam, accuracy, correct, total, timeTaken"
    });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({
      success: false,
      error: "INVALID_EMAIL",
      message: "Invalid email address"
    });
  }

  if (accuracy < 0 || accuracy > 100) {
    return res.status(400).json({
      success: false,
      error: "INVALID_ACCURACY",
      message: "Accuracy must be between 0 and 100"
    });
  }

  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.error("SMTP credentials not configured");
    return res.status(500).json({
      success: false,
      error: "EMAIL_SERVICE_ERROR",
      message: "Email service not configured"
    });
  }

  try {
    const transporter = createTransporter();
    const htmlContent = generateHTMLEmail({
      name,
      exam,
      subject: subject || "Mixed Paper",
      accuracy,
      correct,
      total,
      timeTaken,
      weakAreas: weakAreas || []
    });

    await transporter.sendMail({
      from: `"MedhaHub Test Results" <${process.env.SMTP_USER}>`,
      to: email,
      replyTo: process.env.SMTP_USER,
      subject: `📊 Your ${exam} Test Results - ${accuracy}% Accuracy`,
      html: htmlContent,
    });

    res.status(200).json({
      success: true,
      message: "Test result email sent successfully",
      data: {
        email,
        exam,
        accuracy,
        emailSentAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error("Error sending test result email:", error);
    res.status(500).json({
      success: false,
      error: "EMAIL_SEND_ERROR",
      message: error.message || "Failed to send email"
    });
  }
}

export default { sendTestResultEmail };
