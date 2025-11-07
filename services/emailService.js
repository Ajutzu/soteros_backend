const nodemailer = require("nodemailer")
const pool = require("../config/conn")

// Try to load Brevo (optional dependency)
let brevoApi = null
try {
  const brevo = require("@getbrevo/brevo")
  if (process.env.BREVO_API_KEY) {
    brevoApi = new brevo.TransactionalEmailsApi()
    brevoApi.setApiKey(
      brevo.TransactionalEmailsApiApiKeys.apiKey,
      process.env.BREVO_API_KEY
    )
    console.log("✅ Brevo API configured successfully")
  }
} catch (error) {
  console.log("⚠️ Brevo not available, will use SMTP fallback")
}

// Try to load SendGrid (optional dependency)
let sgMail = null
try {
  sgMail = require("@sendgrid/mail")
  if (process.env.SENDGRID_API_KEY) {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY)
    console.log("✅ SendGrid API configured successfully")
  }
} catch (error) {
  console.log("⚠️ SendGrid not available")
}

// Function to send email using Brevo API
const sendWithBrevo = async (mailOptions) => {
  if (!brevoApi || !process.env.BREVO_API_KEY) {
    throw new Error("Brevo not configured")
  }

  const brevo = require("@getbrevo/brevo")
  const sendSmtpEmail = new brevo.SendSmtpEmail()

  sendSmtpEmail.sender = { 
    email: process.env.BREVO_FROM_EMAIL || process.env.EMAIL_USER,
    name: process.env.EMAIL_FROM_NAME || "SoteROS Emergency Management"
  }
  sendSmtpEmail.to = [{ email: mailOptions.to }]
  sendSmtpEmail.subject = mailOptions.subject
  sendSmtpEmail.htmlContent = mailOptions.html

  console.log("📧 Sending email via Brevo API...")
  const result = await brevoApi.sendTransacEmail(sendSmtpEmail)
  console.log("✅ Email sent via Brevo successfully")
  return { messageId: result.messageId }
}

// Function to send email using SendGrid API
const sendWithSendGrid = async (mailOptions) => {
  if (!sgMail || !process.env.SENDGRID_API_KEY) {
    throw new Error("SendGrid not configured")
  }

  const msg = {
    to: mailOptions.to,
    from: process.env.SENDGRID_FROM_EMAIL || process.env.EMAIL_USER,
    subject: mailOptions.subject,
    html: mailOptions.html,
  }

  console.log("📧 Sending email via SendGrid API...")
  const result = await sgMail.send(msg)
  console.log("✅ Email sent via SendGrid successfully")
  return { messageId: result[0].headers["x-message-id"] }
}

// Function to create transporter with current config
const createTransporter = () => {
  const smtpHost = process.env.SMTP_HOST || process.env.EMAIL_HOST || "smtp.gmail.com"
  const smtpUser = process.env.EMAIL_USER || process.env.SMTP_USER
  const smtpPass = process.env.EMAIL_PASS || process.env.SMTP_PASS
  const smtpPort = process.env.SMTP_PORT || process.env.EMAIL_PORT || 587

  console.log("📧 Creating transporter with config:", {
    host: smtpHost,
    port: smtpPort,
    user: smtpUser ? "***configured***" : "MISSING",
    pass: smtpPass ? "***configured***" : "MISSING",
  })

  return nodemailer.createTransport({
    host: smtpHost,
    port: parseInt(smtpPort),
    secure: parseInt(smtpPort) === 465, // true for 465, false for other ports
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
    tls: {
      rejectUnauthorized: false,
    },
    connectionTimeout: 10000, // 10 seconds
    greetingTimeout: 10000,
    socketTimeout: 10000,
    pool: true, // Use connection pooling
    maxConnections: 5,
    maxMessages: 100,
  })
}

// Universal send function that tries Brevo first, then SendGrid, then SMTP
const sendEmail = async (mailOptions) => {
  // Try Brevo first (recommended for production/Render - 300/day free)
  if (brevoApi && process.env.BREVO_API_KEY) {
    try {
      console.log("📧 Attempting to send via Brevo API...")
      return await sendWithBrevo(mailOptions)
    } catch (brevoError) {
      console.error("❌ Brevo failed:", brevoError.message)
      console.log("🔄 Falling back to SendGrid...")
    }
  }

  // Try SendGrid as backup (100/day free)
  if (sgMail && process.env.SENDGRID_API_KEY) {
    try {
      console.log("📧 Attempting to send via SendGrid API...")
      return await sendWithSendGrid(mailOptions)
    } catch (sendGridError) {
      console.error("❌ SendGrid failed:", sendGridError.message)
      console.log("🔄 Falling back to SMTP...")
    }
  }

  // Fallback to SMTP (may timeout on Render)
  console.log("📧 Sending via SMTP...")
  const transporter = createTransporter()
  return await transporter.sendMail(mailOptions)
}

const sendPasswordResetOTP = async (email, otp) => {
  try {
    const smtpHost = process.env.SMTP_HOST || process.env.EMAIL_HOST || "smtp.gmail.com"
    const smtpUser = process.env.EMAIL_USER || process.env.SMTP_USER
    const smtpPass = process.env.EMAIL_PASS || process.env.SMTP_PASS
    const smtpPort = process.env.SMTP_PORT || process.env.EMAIL_PORT || 587

    console.log("🔧 SMTP Configuration Debug:", {
      "process.env.EMAIL_USER": process.env.EMAIL_USER ? "***set***" : "NOT SET",
      "process.env.SMTP_USER": process.env.SMTP_USER ? "***set***" : "NOT SET",
      "process.env.EMAIL_PASS": process.env.EMAIL_PASS ? "***set***" : "NOT SET",
      "process.env.SMTP_PASS": process.env.SMTP_PASS ? "***set***" : "NOT SET",
      smtpHost: smtpHost,
      smtpUser: smtpUser ? "***configured***" : "MISSING",
      smtpPass: smtpPass ? "***configured***" : "MISSING",
      smtpPort: smtpPort,
    })

    if (!smtpUser || !smtpPass) {
      console.error("❌ SMTP configuration missing required credentials:", {
        user: smtpUser ? "***set***" : "MISSING",
        pass: smtpPass ? "***set***" : "MISSING",
        host: smtpHost,
        port: smtpPort,
      })
      throw new Error(
        `SMTP credentials missing. Please set EMAIL_USER and EMAIL_PASS in your .env file. Current: User=${smtpUser ? "set" : "missing"}, Pass=${smtpPass ? "set" : "missing"}`,
      )
    }

    console.log("Attempting to send password reset OTP to:", email)

    const mailOptions = {
      from: `"${process.env.EMAIL_FROM_NAME || "SoteROS Emergency Management"}" <${process.env.EMAIL_FROM_ADDRESS || process.env.SMTP_USER}>`,
      to: email,
      subject: "Password Reset Request - SoteROS",
      html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="utf-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Password Reset</title>
                </head>
                <body style="margin: 0; padding: 0; background-color: #f4f7fa; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
                    <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f4f7fa;">
                        <tr>
                            <td align="center" style="padding: 40px 20px;">
                                <table role="presentation" style="max-width: 600px; width: 100%; border-collapse: collapse; background-color: #ffffff; border-radius: 16px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07); overflow: hidden;">
                                    <!-- Header -->
                                    <tr>
                                        <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 40px 30px; text-align: center;">
                                            <div style="background-color: rgba(255, 255, 255, 0.2); width: 80px; height: 80px; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
                                                <span style="font-size: 40px;">🔐</span>
                                            </div>
                                            <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">Password Reset</h1>
                                        </td>
                                    </tr>
                                    
                                    <!-- Content -->
                                    <tr>
                                        <td style="padding: 40px;">
                                            <p style="margin: 0 0 24px; color: #1f2937; font-size: 16px; line-height: 1.6;">Hello,</p>
                                            <p style="margin: 0 0 32px; color: #4b5563; font-size: 15px; line-height: 1.6;">We received a request to reset your password for your SoteROS Emergency Management account. Use the verification code below to complete the process:</p>
                                            
                                            <!-- OTP Box -->
                                            <table role="presentation" style="width: 100%; border-collapse: collapse; margin: 0 0 32px;">
                                                <tr>
                                                    <td style="background: linear-gradient(135deg, #f0f4ff 0%, #e8eeff 100%); border: 2px solid #667eea; border-radius: 12px; padding: 32px; text-align: center;">
                                                        <p style="margin: 0 0 12px; color: #4b5563; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">Your Verification Code</p>
                                                        <div style="font-size: 42px; font-weight: 700; color: #667eea; letter-spacing: 8px; font-family: 'Courier New', monospace;">${otp}</div>
                                                    </td>
                                                </tr>
                                            </table>
                                            
                                            <!-- Info Box -->
                                            <table role="presentation" style="width: 100%; border-collapse: collapse; margin: 0 0 32px;">
                                                <tr>
                                                    <td style="background-color: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 8px; padding: 16px 20px;">
                                                        <p style="margin: 0; color: #92400e; font-size: 14px; line-height: 1.5;">
                                                            <strong style="font-weight: 600;">⏱️ Time Sensitive:</strong> This code will expire in <strong>10 minutes</strong> for your security.
                                                        </p>
                                                    </td>
                                                </tr>
                                            </table>
                                            
                                            <p style="margin: 0 0 8px; color: #4b5563; font-size: 14px; line-height: 1.6;">If you didn't request this password reset, you can safely ignore this email. Your password will remain unchanged.</p>
                                        </td>
                                    </tr>
                                    
                                    <!-- Footer -->
                                    <tr>
                                        <td style="background-color: #f9fafb; padding: 32px 40px; border-top: 1px solid #e5e7eb;">
                                            <p style="margin: 0 0 8px; color: #6b7280; font-size: 13px; line-height: 1.5;">Best regards,</p>
                                            <p style="margin: 0 0 20px; color: #1f2937; font-size: 14px; font-weight: 600;">SoteROS Emergency Management Team</p>
                                            <p style="margin: 0; color: #9ca3af; font-size: 12px; line-height: 1.5;">This is an automated message, please do not reply to this email.</p>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                    </table>
                </body>
                </html>
            `,
    }

    const info = await sendEmail(mailOptions)
    console.log("✅ Password reset OTP email sent successfully:", {
      messageId: info.messageId,
      email: email,
      timestamp: new Date().toISOString(),
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    console.error("❌ Error sending password reset OTP email:", {
      email: email,
      error: error.message,
      code: error.code,
      errno: error.errno,
      syscall: error.syscall,
      hostname: error.hostname,
      timestamp: new Date().toISOString(),
    })

    if (error.code === "EAUTH") {
      throw new Error("SMTP authentication failed. Please check SMTP_USER and SMTP_PASS credentials.")
    } else if (error.code === "ECONNREFUSED") {
      throw new Error("SMTP connection refused. Please check SMTP_HOST and SMTP_PORT settings.")
    } else if (error.code === "ENOTFOUND") {
      throw new Error("SMTP host not found. Please check SMTP_HOST setting.")
    } else if (error.code === "ETIMEDOUT") {
      throw new Error("SMTP connection timed out. Please check network connectivity and SMTP settings.")
    } else {
      throw new Error(`Failed to send password reset email: ${error.message}`)
    }
  }
}

const sendIncidentAssignmentEmail = async (incidentData, teamId) => {
  try {
    console.log("📧 Preparing to send incident assignment emails to team:", teamId)

    const [teamMembers] = await pool.execute(
      `
            SELECT s.id, s.name, s.email, s.position, s.department
            FROM staff s
            WHERE s.assigned_team_id = ? AND (s.status = "active" OR s.status = 1) AND s.availability = 'available'
        `,
      [teamId],
    )

    if (teamMembers.length === 0) {
      console.log("⚠️ No active team members found for team:", teamId)
      return { success: false, error: "No active team members found" }
    }

    console.log(`📧 Found ${teamMembers.length} team members to notify`)

    let emailsSent = 0
    let emailsFailed = 0
    const failedEmails = []

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000"

    // Priority color mapping
    const priorityColors = {
      Critical: { bg: "#fee2e2", border: "#dc2626", text: "#991b1b", badge: "#dc2626" },
      High: { bg: "#fed7aa", border: "#ea580c", text: "#9a3412", badge: "#ea580c" },
      Medium: { bg: "#fef3c7", border: "#f59e0b", text: "#92400e", badge: "#f59e0b" },
      Low: { bg: "#dbeafe", border: "#3b82f6", text: "#1e40af", badge: "#3b82f6" },
    }

    const priorityColor = priorityColors[incidentData.priorityLevel] || priorityColors["Medium"]

    for (const member of teamMembers) {
      try {
        const mailOptions = {
          from: `"SoteROS Emergency Management" <${process.env.SMTP_USER}>`,
          to: member.email,
          subject: `🚨 Incident Assignment - ${incidentData.type}`,
          html: `
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <meta charset="utf-8">
                            <meta name="viewport" content="width=device-width, initial-scale=1.0">
                            <title>Incident Assignment</title>
                        </head>
                        <body style="margin: 0; padding: 0; background-color: #f4f7fa; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f4f7fa;">
                                <tr>
                                    <td align="center" style="padding: 40px 20px;">
                                        <table role="presentation" style="max-width: 600px; width: 100%; border-collapse: collapse; background-color: #ffffff; border-radius: 16px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07); overflow: hidden;">
                                            <!-- Header -->
                                            <tr>
                                                <td style="background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%); padding: 40px 40px 30px; text-align: center;">
                                                    <div style="background-color: rgba(255, 255, 255, 0.2); width: 80px; height: 80px; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
                                                        <span style="font-size: 40px;">🚨</span>
                                                    </div>
                                                    <h1 style="margin: 0 0 8px; color: #ffffff; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">New Incident Assignment</h1>
                                                    <p style="margin: 0; color: rgba(255, 255, 255, 0.9); font-size: 14px;">Immediate attention required</p>
                                                </td>
                                            </tr>
                                            
                                            <!-- Content -->
                                            <tr>
                                                <td style="padding: 40px;">
                                                    <p style="margin: 0 0 8px; color: #1f2937; font-size: 16px; line-height: 1.6;">Hello <strong>${member.name}</strong>,</p>
                                                    <p style="margin: 0 0 32px; color: #4b5563; font-size: 15px; line-height: 1.6;">You have been assigned to handle a new incident through your team. Please review the details below and take appropriate action.</p>
                                                    
                                                    <!-- Priority Badge -->
                                                    <div style="margin: 0 0 24px; text-align: center;">
                                                        <span style="display: inline-block; background-color: ${priorityColor.badge}; color: #ffffff; padding: 8px 20px; border-radius: 20px; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">
                                                            ${incidentData.priorityLevel} Priority
                                                        </span>
                                                    </div>
                                                    
                                                    <!-- Incident Details Card -->
                                                    <table role="presentation" style="width: 100%; border-collapse: collapse; margin: 0 0 32px;">
                                                        <tr>
                                                            <td style="background-color: #f9fafb; border: 2px solid #e5e7eb; border-radius: 12px; padding: 0; overflow: hidden;">
                                                                <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 16px 24px;">
                                                                    <h2 style="margin: 0; color: #ffffff; font-size: 18px; font-weight: 600;">Incident Details</h2>
                                                                </div>
                                                                <div style="padding: 24px;">
                                                                    <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                                                        <tr>
                                                                            <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                                                                <p style="margin: 0 0 4px; color: #6b7280; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Type</p>
                                                                                <p style="margin: 0; color: #1f2937; font-size: 15px; font-weight: 600;">${incidentData.type}</p>
                                                                            </td>
                                                                        </tr>
                                                                        <tr>
                                                                            <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                                                                <p style="margin: 0 0 4px; color: #6b7280; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Location</p>
                                                                                <p style="margin: 0; color: #1f2937; font-size: 15px;">📍 ${incidentData.location || "Not specified"}</p>
                                                                            </td>
                                                                        </tr>
                                                                        <tr>
                                                                            <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                                                                <p style="margin: 0 0 4px; color: #6b7280; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Description</p>
                                                                                <p style="margin: 0; color: #1f2937; font-size: 14px; line-height: 1.6;">${incidentData.description}</p>
                                                                            </td>
                                                                        </tr>
                                                                        <tr>
                                                                            <td style="padding: 12px 0;">
                                                                                <p style="margin: 0 0 4px; color: #6b7280; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Reported</p>
                                                                                <p style="margin: 0; color: #1f2937; font-size: 14px;">🕐 ${new Date(incidentData.dateReported).toLocaleString()}</p>
                                                                            </td>
                                                                        </tr>
                                                                    </table>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    </table>
                                                    
                                                    <!-- CTA Button -->
                                                    <table role="presentation" style="width: 100%; border-collapse: collapse; margin: 0 0 24px;">
                                                        <tr>
                                                            <td align="center">
                                                                <a href="${frontendUrl}/staff/incidents/${incidentData.id}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; padding: 16px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px; box-shadow: 0 4px 6px rgba(102, 126, 234, 0.3);">
                                                                    📋 View Full Incident Details
                                                                </a>
                                                            </td>
                                                        </tr>
                                                    </table>
                                                    
                                                    <p style="margin: 0; color: #6b7280; font-size: 13px; line-height: 1.5; text-align: center;">Click the button above to access the incident dashboard and coordinate your response.</p>
                                                </td>
                                            </tr>
                                            
                                            <!-- Footer -->
                                            <tr>
                                                <td style="background-color: #f9fafb; padding: 32px 40px; border-top: 1px solid #e5e7eb;">
                                                    <p style="margin: 0 0 8px; color: #6b7280; font-size: 13px; line-height: 1.5;">Stay safe,</p>
                                                    <p style="margin: 0 0 20px; color: #1f2937; font-size: 14px; font-weight: 600;">SoteROS Emergency Management Team</p>
                                                    <p style="margin: 0; color: #9ca3af; font-size: 12px; line-height: 1.5;">This is an automated incident notification. For urgent matters, contact your team coordinator directly.</p>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                        </body>
                        </html>
                    `,
        }

        await sendEmail(mailOptions)
        emailsSent++
        console.log(`✅ Email sent to ${member.name} (${member.email})`)
      } catch (emailError) {
        console.error(`❌ Failed to send email to ${member.name} (${member.email}):`, emailError.message)
        emailsFailed++
        failedEmails.push({ name: member.name, email: member.email, error: emailError.message })
      }
    }

    console.log(`📧 Email sending completed: ${emailsSent} sent, ${emailsFailed} failed`)

    return {
      success: true,
      totalMembers: teamMembers.length,
      emailsSent,
      emailsFailed,
      failedEmails,
    }
  } catch (error) {
    console.error("Error sending incident assignment emails:", error)
    return { success: false, error: error.message }
  }
}

const sendStaffAssignmentEmail = async (incidentData, staffId) => {
  try {
    console.log("📧 Preparing to send incident assignment email to staff:", staffId)

    const [staff] = await pool.execute(
      `
            SELECT id, name, email, position, department
            FROM staff
            WHERE id = ? AND (status = "active" OR status = 1)
        `,
      [staffId],
    )

    if (staff.length === 0) {
      console.log("⚠️ Staff member not found:", staffId)
      return { success: false, error: "Staff member not found" }
    }

    const staffMember = staff[0]
    console.log(`📧 Sending email to ${staffMember.name} (${staffMember.email})`)

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000"

    const priorityColors = {
      Critical: { bg: "#fee2e2", border: "#dc2626", text: "#991b1b", badge: "#dc2626" },
      High: { bg: "#fed7aa", border: "#ea580c", text: "#9a3412", badge: "#ea580c" },
      Medium: { bg: "#fef3c7", border: "#f59e0b", text: "#92400e", badge: "#f59e0b" },
      Low: { bg: "#dbeafe", border: "#3b82f6", text: "#1e40af", badge: "#3b82f6" },
    }

    const priorityColor = priorityColors[incidentData.priorityLevel] || priorityColors["Medium"]

    const mailOptions = {
      from: `"SoteROS Emergency Management" <${process.env.SMTP_USER}>`,
      to: staffMember.email,
      subject: `🚨 Personal Incident Assignment - ${incidentData.type}`,
      html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="utf-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Incident Assignment</title>
                </head>
                <body style="margin: 0; padding: 0; background-color: #f4f7fa; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
                    <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f4f7fa;">
                        <tr>
                            <td align="center" style="padding: 40px 20px;">
                                <table role="presentation" style="max-width: 600px; width: 100%; border-collapse: collapse; background-color: #ffffff; border-radius: 16px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07); overflow: hidden;">
                                    <!-- Header -->
                                    <tr>
                                        <td style="background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%); padding: 40px 40px 30px; text-align: center;">
                                            <div style="background-color: rgba(255, 255, 255, 0.2); width: 80px; height: 80px; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
                                                <span style="font-size: 40px;">🚨</span>
                                            </div>
                                            <h1 style="margin: 0 0 8px; color: #ffffff; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">Personal Assignment</h1>
                                            <p style="margin: 0; color: rgba(255, 255, 255, 0.9); font-size: 14px;">You've been directly assigned to this incident</p>
                                        </td>
                                    </tr>
                                    
                                    <!-- Content -->
                                    <tr>
                                        <td style="padding: 40px;">
                                            <p style="margin: 0 0 8px; color: #1f2937; font-size: 16px; line-height: 1.6;">Hello <strong>${staffMember.name}</strong>,</p>
                                            <p style="margin: 0 0 32px; color: #4b5563; font-size: 15px; line-height: 1.6;">You have been personally assigned to handle this incident. Your expertise is needed for this situation.</p>
                                            
                                            <!-- Priority Badge -->
                                            <div style="margin: 0 0 24px; text-align: center;">
                                                <span style="display: inline-block; background-color: ${priorityColor.badge}; color: #ffffff; padding: 8px 20px; border-radius: 20px; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">
                                                    ${incidentData.priorityLevel} Priority
                                                </span>
                                            </div>
                                            
                                            <!-- Incident Details Card -->
                                            <table role="presentation" style="width: 100%; border-collapse: collapse; margin: 0 0 32px;">
                                                <tr>
                                                    <td style="background-color: #f9fafb; border: 2px solid #e5e7eb; border-radius: 12px; padding: 0; overflow: hidden;">
                                                        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 16px 24px;">
                                                            <h2 style="margin: 0; color: #ffffff; font-size: 18px; font-weight: 600;">Incident Details</h2>
                                                        </div>
                                                        <div style="padding: 24px;">
                                                            <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                                                <tr>
                                                                    <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                                                        <p style="margin: 0 0 4px; color: #6b7280; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Type</p>
                                                                        <p style="margin: 0; color: #1f2937; font-size: 15px; font-weight: 600;">${incidentData.type}</p>
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                                                        <p style="margin: 0 0 4px; color: #6b7280; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Location</p>
                                                                        <p style="margin: 0; color: #1f2937; font-size: 15px;">📍 ${incidentData.location || "Not specified"}</p>
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                                                        <p style="margin: 0 0 4px; color: #6b7280; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Description</p>
                                                                        <p style="margin: 0; color: #1f2937; font-size: 14px; line-height: 1.6;">${incidentData.description}</p>
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td style="padding: 12px 0;">
                                                                        <p style="margin: 0 0 4px; color: #6b7280; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Reported</p>
                                                                        <p style="margin: 0; color: #1f2937; font-size: 14px;">🕐 ${new Date(incidentData.dateReported).toLocaleString()}</p>
                                                                    </td>
                                                                </tr>
                                                            </table>
                                                        </div>
                                                    </td>
                                                </tr>
                                            </table>
                                            
                                            <!-- CTA Button -->
                                            <table role="presentation" style="width: 100%; border-collapse: collapse; margin: 0 0 24px;">
                                                <tr>
                                                    <td align="center">
                                                        <a href="${frontendUrl}/staff/incidents/${incidentData.id}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; padding: 16px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px; box-shadow: 0 4px 6px rgba(102, 126, 234, 0.3);">
                                                            📋 View Full Incident Details
                                                        </a>
                                                    </td>
                                                </tr>
                                            </table>
                                            
                                            <p style="margin: 0; color: #6b7280; font-size: 13px; line-height: 1.5; text-align: center;">Click the button above to access the incident dashboard and begin your response.</p>
                                        </td>
                                    </tr>
                                    
                                    <!-- Footer -->
                                    <tr>
                                        <td style="background-color: #f9fafb; padding: 32px 40px; border-top: 1px solid #e5e7eb;">
                                            <p style="margin: 0 0 8px; color: #6b7280; font-size: 13px; line-height: 1.5;">Stay safe,</p>
                                            <p style="margin: 0 0 20px; color: #1f2937; font-size: 14px; font-weight: 600;">SoteROS Emergency Management Team</p>
                                            <p style="margin: 0; color: #9ca3af; font-size: 12px; line-height: 1.5;">This is an automated incident notification. For urgent matters, contact your supervisor directly.</p>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                    </table>
                </body>
                </html>
            `,
    }

    await sendEmail(mailOptions)
    console.log(`✅ Email sent to ${staffMember.name} (${staffMember.email})`)

    return {
      success: true,
      staffName: staffMember.name,
      staffEmail: staffMember.email,
    }
  } catch (error) {
    console.error("Error sending staff assignment email:", error)
    return { success: false, error: error.message }
  }
}

const sendStaffAccountCreationEmail = async (staffData, plainPassword) => {
  try {
    console.log("📧 Preparing to send staff account creation email to:", staffData.email)

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000"

    const mailOptions = {
      from: `"${process.env.EMAIL_FROM_NAME || "SoteROS Emergency Management"}" <${process.env.EMAIL_FROM_ADDRESS || process.env.SMTP_USER}>`,
      to: staffData.email,
      subject: "Welcome to SoteROS - Your Account is Ready",
      html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="utf-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Welcome to SoteROS</title>
                </head>
                <body style="margin: 0; padding: 0; background-color: #f4f7fa; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
                    <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f4f7fa;">
                        <tr>
                            <td align="center" style="padding: 40px 20px;">
                                <table role="presentation" style="max-width: 600px; width: 100%; border-collapse: collapse; background-color: #ffffff; border-radius: 16px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07); overflow: hidden;">
                                    <!-- Header -->
                                    <tr>
                                        <td style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 40px 40px 30px; text-align: center;">
                                            <div style="background-color: rgba(255, 255, 255, 0.2); width: 80px; height: 80px; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
                                                <span style="font-size: 40px;">👋</span>
                                            </div>
                                            <h1 style="margin: 0 0 8px; color: #ffffff; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">Welcome to SoteROS!</h1>
                                            <p style="margin: 0; color: rgba(255, 255, 255, 0.9); font-size: 14px;">Your account has been successfully created</p>
                                        </td>
                                    </tr>
                                    
                                    <!-- Content -->
                                    <tr>
                                        <td style="padding: 40px;">
                                            <p style="margin: 0 0 8px; color: #1f2937; font-size: 16px; line-height: 1.6;">Hello <strong>${staffData.name}</strong>,</p>
                                            <p style="margin: 0 0 32px; color: #4b5563; font-size: 15px; line-height: 1.6;">Welcome to the SoteROS Emergency Management System! Your staff account has been created and you're ready to get started.</p>
                                            
                                            <!-- Credentials Card -->
                                            <table role="presentation" style="width: 100%; border-collapse: collapse; margin: 0 0 24px;">
                                                <tr>
                                                    <td style="background-color: #f9fafb; border: 2px solid #e5e7eb; border-radius: 12px; padding: 0; overflow: hidden;">
                                                        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 16px 24px;">
                                                            <h2 style="margin: 0; color: #ffffff; font-size: 18px; font-weight: 600;">🔑 Your Login Credentials</h2>
                                                        </div>
                                                        <div style="padding: 24px;">
                                                            <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                                                <tr>
                                                                    <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                                                        <p style="margin: 0 0 4px; color: #6b7280; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Email</p>
                                                                        <p style="margin: 0; color: #1f2937; font-size: 15px; font-family: 'Courier New', monospace;">${staffData.email}</p>
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                                                        <p style="margin: 0 0 4px; color: #6b7280; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Temporary Password</p>
                                                                        <p style="margin: 0; color: #1f2937; font-size: 15px; font-family: 'Courier New', monospace; background-color: #fef3c7; padding: 8px 12px; border-radius: 6px; display: inline-block;">${plainPassword}</p>
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                                                        <p style="margin: 0 0 4px; color: #6b7280; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Position</p>
                                                                        <p style="margin: 0; color: #1f2937; font-size: 15px;">${staffData.position}</p>
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td style="padding: 12px 0;">
                                                                        <p style="margin: 0 0 4px; color: #6b7280; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Department</p>
                                                                        <p style="margin: 0; color: #1f2937; font-size: 15px;">${staffData.department}</p>
                                                                    </td>
                                                                </tr>
                                                            </table>
                                                        </div>
                                                    </td>
                                                </tr>
                                            </table>
                                            
                                            <!-- Security Notice -->
                                            <table role="presentation" style="width: 100%; border-collapse: collapse; margin: 0 0 32px;">
                                                <tr>
                                                    <td style="background-color: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 8px; padding: 16px 20px;">
                                                        <p style="margin: 0 0 8px; color: #92400e; font-size: 14px; font-weight: 600;">
                                                            🔒 Important Security Notice
                                                        </p>
                                                        <p style="margin: 0; color: #92400e; font-size: 13px; line-height: 1.5;">
                                                            Please change your password immediately after your first login. Never share your credentials with anyone.
                                                        </p>
                                                    </td>
                                                </tr>
                                            </table> 
                                            
                                            <!-- CTA Button -->
                                            <table role="presentation" style="width: 100%; border-collapse: collapse; margin: 0 0 24px;">
                                                <tr>
                                                    <td align="center">
                                                        <a href="${frontendUrl}/auth/login" style="display: inline-block; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #ffffff; padding: 16px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px; box-shadow: 0 4px 6px rgba(16, 185, 129, 0.3);">
                                                            🚀 Login to Your Account
                                                        </a>
                                                    </td>
                                                </tr>
                                            </table>
                                            
                                            <p style="margin: 0; color: #6b7280; font-size: 13px; line-height: 1.5; text-align: center;">If you have any questions or need assistance, please contact your system administrator.</p>
                                        </td>
                                    </tr>
                                    
                                    <!-- Footer -->
                                    <tr>
                                        <td style="background-color: #f9fafb; padding: 32px 40px; border-top: 1px solid #e5e7eb;">
                                            <p style="margin: 0 0 8px; color: #6b7280; font-size: 13px; line-height: 1.5;">Welcome aboard,</p>
                                            <p style="margin: 0 0 20px; color: #1f2937; font-size: 14px; font-weight: 600;">SoteROS Emergency Management Team</p>
                                            <p style="margin: 0; color: #9ca3af; font-size: 12px; line-height: 1.5;">This email contains sensitive information. Please keep it secure and delete it after changing your password.</p>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                    </table>
                </body>
                </html>
            `,
    }

    const info = await sendEmail(mailOptions)
    console.log(`✅ Staff account creation email sent to ${staffData.name} (${staffData.email})`)
    return { success: true, messageId: info.messageId }
  } catch (error) {
    console.error("❌ Error sending staff account creation email:", error)
    throw new Error(`Failed to send account creation email: ${error.message}`)
  }
}

module.exports = {
  sendPasswordResetOTP,
  sendIncidentAssignmentEmail,
  sendStaffAssignmentEmail,
  sendStaffAccountCreationEmail,
}
