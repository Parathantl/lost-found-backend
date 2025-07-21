// services/emailService.js - CORRECTED VERSION
const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    // FIXED: Changed from createTransporter to createTransport
    this.transporter = nodemailer.createTransport({
      service: 'gmail', // or your email service
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS // Use app password for Gmail
      }
    });
  }

  async sendPasswordResetEmail(to, resetToken) {
    const resetURL = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;
    
    const mailOptions = {
      from: `"Lost & Found System" <${process.env.EMAIL_USER}>`,
      to: to,
      subject: 'Password Reset Request',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            .container {
              max-width: 600px;
              margin: 0 auto;
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
            }
            .header {
              background-color: #8249C0;
              color: white;
              padding: 20px;
              text-align: center;
            }
            .content {
              padding: 30px;
              background-color: #f9f9f9;
            }
            .button {
              display: inline-block;
              background-color: #8249C0;
              color: white;
              padding: 12px 24px;
              text-decoration: none;
              border-radius: 5px;
              margin: 20px 0;
            }
            .footer {
              padding: 20px;
              text-align: center;
              font-size: 12px;
              color: #666;
            }
            .warning {
              background-color: #fff3cd;
              border: 1px solid #ffeaa7;
              padding: 15px;
              border-radius: 5px;
              margin: 20px 0;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Password Reset Request</h1>
            </div>
            <div class="content">
              <p>Hello,</p>
              <p>We received a request to reset your password for your Lost & Found account.</p>
              <p>Click the button below to reset your password:</p>
              <div style="text-align: center;">
                <a href="${resetURL}" class="button">Reset Password</a>
              </div>
              <p>Or copy and paste this link into your browser:</p>
              <p style="word-break: break-all; background-color: #f1f1f1; padding: 10px; border-radius: 3px;">
                ${resetURL}
              </p>
              <div class="warning">
                <strong>⚠️ Important:</strong>
                <ul>
                  <li>This link will expire in 10 minutes</li>
                  <li>If you didn't request this reset, please ignore this email</li>
                  <li>For security, never share this link with anyone</li>
                </ul>
              </div>
              <p>If you continue to have problems, please contact our support team.</p>
              <p>Best regards,<br>Lost & Found Team</p>
            </div>
            <div class="footer">
              <p>This is an automated email. Please do not reply to this email.</p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    try {
      await this.transporter.sendMail(mailOptions);
      return { success: true };
    } catch (error) {
      console.error('Email sending error:', error);
      return { success: false, error: error.message };
    }
  }

  // Test email connection (optional - useful for debugging)
  async testConnection() {
    try {
      await this.transporter.verify();
      return true;
    } catch (error) {
      console.error('❌ Email service error:', error);
      return false;
    }
  }
}

module.exports = new EmailService();
