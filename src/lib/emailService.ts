import nodemailer from "nodemailer";

export interface EmailPayload {
  to: string;
  customerName: string;
  orderId: string;
  productName: string;
  refundAmount: number;
  reason: string;
}

export async function sendRefundConfirmationEmail(payload: EmailPayload): Promise<{ success: boolean; messageId?: string; simulated?: boolean }> {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = parseInt(process.env.SMTP_PORT || "587", 10);
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const fromEmail = process.env.SYSTEM_EMAIL || "support@techmart.com";

  const emailBodyHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; background-color: #ffffff;">
      <div style="background-color: #0f172a; padding: 24px; text-align: center; color: #ffffff;">
        <h1 style="margin: 0; font-size: 24px; font-weight: bold; letter-spacing: -0.5px;">TechMart Support</h1>
        <p style="margin: 4px 0 0 0; color: #94a3b8; font-size: 14px;">Refund Confirmation Notice</p>
      </div>

      <div style="padding: 24px; color: #334155; line-height: 1.6;">
        <p style="font-size: 16px;">Hello <strong>${payload.customerName}</strong>,</p>

        <p>Great news! Your refund request for order <strong>${payload.orderId}</strong> has been evaluated against our company policy and has been <strong>APPROVED</strong>.</p>

        <div style="background-color: #f8fafc; border-left: 4px solid #10b981; padding: 16px; border-radius: 4px; margin: 20px 0;">
          <h3 style="margin: 0 0 8px 0; color: #0f172a; font-size: 15px;">Refund Details</h3>
          <ul style="margin: 0; padding-left: 20px; color: #475569; font-size: 14px;">
            <li><strong>Order ID:</strong> ${payload.orderId}</li>
            <li><strong>Item:</strong> ${payload.productName}</li>
            <li><strong>Refund Amount:</strong> $${payload.refundAmount.toFixed(2)}</li>
            <li><strong>Payment Method:</strong> Original Payment Method</li>
            <li><strong>Processing Timeline:</strong> 3–5 Business Days</li>
          </ul>
        </div>

        <p><strong>Evaluation Summary:</strong> ${payload.reason}</p>

        <p style="font-size: 14px; color: #64748b; margin-top: 24px;">If you have any further questions, simply reply to this email or chat with Charlie, our AI Customer Sales & Support Agent anytime.</p>
      </div>

      <div style="background-color: #f1f5f9; padding: 16px; text-align: center; font-size: 12px; color: #64748b;">
        &copy; 2026 TechMart Online Store. All rights reserved. | support@techmart.com
      </div>
    </div>
  `;

  // If SMTP environment variables are set, use Nodemailer to send real email
  if (smtpHost && smtpUser && smtpPass) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: {
          user: smtpUser,
          pass: smtpPass
        }
      });

      const info = await transporter.sendMail({
        from: `"TechMart Support" <${fromEmail}>`,
        to: payload.to,
        subject: `[Refund Approved] Confirmation for Order #${payload.orderId}`,
        html: emailBodyHtml
      });

      console.log(`Email sent successfully via SMTP: ${info.messageId}`);
      return { success: true, messageId: info.messageId, simulated: false };
    } catch (err) {
      console.warn("SMTP email dispatch failed, falling back to simulated log dispatch:", err);
    }
  }

  // Simulated Email Dispatch mode
  const simulatedId = `SIM-EMAIL-${Date.now()}`;
  console.log(`[SIMULATED EMAIL SENT TO ${payload.to}]: Order #${payload.orderId} Refund $${payload.refundAmount}`);
  return { success: true, messageId: simulatedId, simulated: true };
}
