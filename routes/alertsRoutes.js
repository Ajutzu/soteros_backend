const express = require('express');
const router = express.Router();
const pool = require('../config/conn');
const nodemailer = require('nodemailer');
const https = require('https');
const { authenticateAdmin } = require('../middleware/authMiddleware');
const NotificationService = require('../services/notificationService');

// Try to load Brevo (optional dependency)
let brevoApi = null;
try {
  const brevo = require('@getbrevo/brevo');
  if (process.env.BREVO_API_KEY) {
    brevoApi = new brevo.TransactionalEmailsApi();
    brevoApi.setApiKey(
      brevo.TransactionalEmailsApiApiKeys.apiKey,
      process.env.BREVO_API_KEY
    );
    console.log('✅ Brevo API configured for alerts');
  }
} catch (error) {
  console.log('⚠️ Brevo not available for alerts, will use SMTP');
}

// Try to load SendGrid (optional dependency)
let sgMail = null;
try {
  sgMail = require('@sendgrid/mail');
  if (process.env.SENDGRID_API_KEY) {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    console.log('✅ SendGrid API configured for alerts');
  }
} catch (error) {
  console.log('⚠️ SendGrid not available for alerts');
}

// Function to send email using Brevo API
const sendWithBrevo = async (mailOptions) => {
  if (!brevoApi || !process.env.BREVO_API_KEY) {
    throw new Error('Brevo not configured');
  }

  const brevo = require('@getbrevo/brevo');
  const sendSmtpEmail = new brevo.SendSmtpEmail();

  sendSmtpEmail.sender = { 
    email: process.env.BREVO_FROM_EMAIL || process.env.EMAIL_USER,
    name: process.env.EMAIL_FROM_NAME || "SoteROS Emergency Management"
  };
  
  // Use BCC for privacy - send to system email and BCC all recipients
  sendSmtpEmail.to = [{ email: process.env.EMAIL_USER || process.env.BREVO_FROM_EMAIL }];
  if (mailOptions.bcc && mailOptions.bcc.length > 0) {
    sendSmtpEmail.bcc = mailOptions.bcc.map(email => ({ email: email.trim() }));
  }
  
  sendSmtpEmail.subject = mailOptions.subject;
  sendSmtpEmail.htmlContent = mailOptions.html;

  console.log('📧 Sending alert via Brevo API with BCC...');
  const result = await brevoApi.sendTransacEmail(sendSmtpEmail);
  console.log('✅ Alert sent via Brevo successfully');
  return { messageId: result.messageId };
};

// Function to send email using SendGrid API
const sendWithSendGrid = async (mailOptions) => {
  if (!sgMail || !process.env.SENDGRID_API_KEY) {
    throw new Error('SendGrid not configured');
  }

  const msg = {
    to: process.env.EMAIL_USER || process.env.SENDGRID_FROM_EMAIL, // Send to system email
    from: process.env.SENDGRID_FROM_EMAIL || process.env.EMAIL_USER,
    subject: mailOptions.subject,
    html: mailOptions.html,
    bcc: mailOptions.bcc || [], // Use BCC for privacy
  };

  console.log('📧 Sending alert via SendGrid API with BCC...');
  const result = await sgMail.send(msg);
  console.log('✅ Alert sent via SendGrid successfully');
  return { messageId: result[0].headers['x-message-id'] };
};

// Configure nodemailer transporter with improved settings
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || 587),
    secure: parseInt(process.env.SMTP_PORT || 587) === 465,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS 
    }, 
    tls: {
      rejectUnauthorized: false
    },
    connectionTimeout: 10000, // 10 seconds
    greetingTimeout: 10000,
    socketTimeout: 10000,
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
  });
};

// Universal send function that tries Brevo first, then SendGrid, then SMTP
const sendEmail = async (mailOptions) => {
  // Try Brevo first (recommended for production/Render - 300/day free)
  if (brevoApi && process.env.BREVO_API_KEY) {
    try {
      console.log('📧 Attempting to send alert via Brevo API...');
      return await sendWithBrevo(mailOptions);
    } catch (brevoError) {
      console.error('❌ Brevo failed:', brevoError.message);
      console.log('🔄 Falling back to SendGrid...');
    }
  }

  // Try SendGrid as backup (100/day free)
  if (sgMail && process.env.SENDGRID_API_KEY) {
    try {
      console.log('📧 Attempting to send alert via SendGrid API...');
      return await sendWithSendGrid(mailOptions);
    } catch (sendGridError) {
      console.error('❌ SendGrid failed:', sendGridError.message);
      console.log('🔄 Falling back to SMTP...');
    }
  }

  // Fallback to SMTP (may timeout on Render)
  console.log('📧 Sending alert via SMTP...');
  const transporter = createTransporter();
  return await transporter.sendMail(mailOptions);
};

// GET - Get all alerts
router.get('/', async (req, res) => {
  try {
    console.log('Fetching all alerts...');
    const [alerts] = await pool.execute(`
      SELECT * FROM alerts 
      ORDER BY created_at DESC
    `);
    
    console.log('Found alerts:', alerts.length);
    res.json({
      success: true,
      alerts
    });
  } catch (error) {
    console.error('Error fetching alerts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch alerts',
      error: error.message
    });
  }
});

// GET - Get alert by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log('Fetching alert with ID:', id);
    
    const [alerts] = await pool.execute(
      'SELECT * FROM alerts WHERE id = ?',
      [id]
    );
    
    if (alerts.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Alert not found'
      });
    }
    
    res.json({
      success: true,
      alert: alerts[0]
    });
  } catch (error) {
    console.error('Error fetching alert:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch alert',
      error: error.message
    });
  }
});

// POST - Create new alert
router.post('/', authenticateAdmin, async (req, res) => {
  try {
    const {
      title,
      message,
      type,
      recipients,
      priority = 'medium',
      send_immediately = false,
      // Geographic fields
      latitude,
      longitude,
      radius_km,
      location_text
    } = req.body;

    console.log('Creating new alert:', { title, type, priority, latitude, longitude, radius_km, recipients });

    if (!title || !message || !type) {
      return res.status(400).json({
        success: false,
        message: 'Title, message, and type are required'
      });
    }

    // Store recipients info in description
    const recipientsText = recipients && recipients.length > 0 ? ` [Recipients: ${recipients.join(', ')}]` : ' [Recipients: all_users]';
    const fullDescription = message + recipientsText;

    // Set default coordinates if not provided (for email alerts)
    const defaultLat = latitude || 13.7565;  // San Juan, Batangas coordinates
    const defaultLng = longitude || 121.3851;
    const defaultRadius = radius_km || 5.0;

    // Validate alert severity
    const validSeverities = ['emergency', 'warning', 'info'];
    const alertSeverity = validSeverities.includes(type.toLowerCase()) ? type.toLowerCase() : 'warning';

    // Insert into alerts table using the schema-defined fields
    const [result] = await pool.execute(`
      INSERT INTO alerts (alert_type, alert_severity, title, description, latitude, longitude, radius_km, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
    `, [type, alertSeverity, title, fullDescription, defaultLat, defaultLng, defaultRadius]);

    const alertId = result.insertId;
    console.log('Created alert with ID:', alertId, 'with recipients:', recipients);

    // Create notification for specified recipients
    try {
      await NotificationService.createAlertNotification({
        id: alertId,
        title: title,
        description: fullDescription,
        alert_severity: alertSeverity,
        alert_type: type,
        recipients: recipients || [] // Pass recipients to notification service
      });
      console.log('Notification created for alert:', alertId, 'with recipients:', recipients || 'all users');
    } catch (notificationError) {
      console.error('Error creating notification for alert:', notificationError);
      // Don't fail the alert creation if notification fails
    }

    // Log the alert creation
    try {
      const { created_by } = req.body;
      const finalCreatedBy = created_by !== null && created_by !== undefined
        ? created_by
        : (req.admin?.admin_id || req.user?.id || null);

      console.log('Final created_by value to be inserted:', finalCreatedBy);

      const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip || 'unknown';
      await pool.execute(`
        INSERT INTO activity_logs (admin_id, action, details, ip_address, created_at)
        VALUES (?, 'alert_create', ?, ?, NOW())
      `, [finalCreatedBy, `Created alert: ${title} (ID: ${alertId})`, clientIP]);
      console.log('✅ Activity logged: alert_create');
    } catch (logError) {
      console.warn('Failed to log alert creation activity:', logError.message);
    }

    // If send_immediately is true, send the alert via email with full information
    if (send_immediately) {
      const fullAlertData = {
        title,
        message,
        type,
        recipients,
        severity: alertSeverity,
        priority: priority || 'medium',
        status: 'active',
        latitude: defaultLat,
        longitude: defaultLng,
        radius_km: defaultRadius,
        location_text: location_text,
        created_at: new Date(),
        updated_at: new Date()
      };
      await sendAlertEmail(alertId, fullAlertData);
    }

    res.status(201).json({
      success: true,
      message: 'Alert created successfully',
      alertId,
      sent: send_immediately,
      geographic: !!(latitude && longitude),
      location: location_text || null
    });

  } catch (error) {
    console.error('Error creating alert:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create alert',
      error: error.message
    });
  }
});

// PUT - Update alert
router.put('/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      message,
      type,
      recipients,
      priority,
      status,
      // Geographic fields
      latitude,
      longitude,
      radius_km,
      location_text
    } = req.body;

    console.log('Updating alert:', id);

    // Check if alert exists
    const [existingAlerts] = await pool.execute(
      'SELECT * FROM alerts WHERE id = ?',
      [id]
    );

    if (existingAlerts.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Alert not found'
      });
    }

    const existingAlert = existingAlerts[0];

    // Validate alert status and severity
    const validStatuses = ['active', 'resolved', 'draft', 'sent'];
    const validSeverities = ['emergency', 'warning', 'info'];

    const alertStatus = validStatuses.includes(status) ? status : existingAlert.status;
    const alertSeverity = validSeverities.includes(type?.toLowerCase()) ? type.toLowerCase() : existingAlert.alert_severity;

    // Prepare update data
    const updateData = {
      title: title !== undefined ? title : existingAlert.title,
      description: message !== undefined ? message : existingAlert.description,
      alert_type: type !== undefined ? type : existingAlert.alert_type,
      alert_severity: alertSeverity,
      status: alertStatus,
      latitude: latitude !== undefined ? latitude : existingAlert.latitude,
      longitude: longitude !== undefined ? longitude : existingAlert.longitude,
      radius_km: radius_km !== undefined ? radius_km : existingAlert.radius_km
    };

    // If recipients are provided, update the description to include them
    if (recipients && Array.isArray(recipients) && recipients.length > 0) {
      const recipientsText = ` [Recipients: ${recipients.join(', ')}]`;
      const cleanMessage = updateData.description.replace(/\s*\[Recipients: [^\]]+\]/, '');
      updateData.description = cleanMessage + recipientsText;
    }

    // Update alert according to schema
    await pool.execute(`
      UPDATE alerts
      SET title = ?, description = ?, alert_type = ?, alert_severity = ?, status = ?, latitude = ?, longitude = ?, radius_km = ?, updated_at = NOW()
      WHERE id = ?
    `, [updateData.title, updateData.description, updateData.alert_type, updateData.alert_severity, updateData.status, updateData.latitude, updateData.longitude, updateData.radius_km, id]);

    // Log the alert update
    try {
      const { created_by } = req.body;
      const finalCreatedBy = created_by !== null && created_by !== undefined
        ? created_by
        : (req.admin?.admin_id || req.user?.id || null);

      console.log('Final created_by value to be inserted:', finalCreatedBy);

      const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip || 'unknown';
      await pool.execute(`
        INSERT INTO activity_logs (admin_id, action, details, ip_address, created_at)
        VALUES (?, 'alert_update', ?, ?, NOW())
      `, [finalCreatedBy, `Updated alert: ${updateData.title} (ID: ${id})`, clientIP]);
      console.log('✅ Activity logged: alert_update');
    } catch (logError) {
      console.warn('Failed to log alert update activity:', logError.message);
    }

    res.json({
      success: true,
      message: 'Alert updated successfully'
    });

  } catch (error) {
    console.error('Error updating alert:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update alert',
      error: error.message
    });
  }
});

// POST - Send alert via email
router.post('/:id/send', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('🚨 Sending alert via email:', id);

    // Get alert details with full information
    // Use DATE_FORMAT to get created_at as exact string from database (no timezone conversion)
    const [alerts] = await pool.execute(
      `SELECT *, 
       DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') as created_at_string
       FROM alerts WHERE id = ?`,
      [id]
    );

    if (alerts.length === 0) {
      console.log('❌ Alert not found:', id);
      return res.status(404).json({
        success: false,
        message: 'Alert not found'
      });
    }

    const alert = alerts[0];
    console.log('📋 Raw alert data:', alert);

    // Map database columns to expected format
    // Extract recipients from description if stored there
    let extractedRecipients = [];
    const description = alert.description || '';
    const recipientsMatch = description.match(/\[Recipients: ([^\]]+)\]/);
    if (recipientsMatch) {
      extractedRecipients = recipientsMatch[1].split(', ').map(r => r.trim());
    }

    const mappedAlert = {
      id: alert.id,
      title: alert.title,
      message: description.replace(/\s*\[Recipients: [^\]]+\]/, ''), // Remove recipients from message
      type: alert.alert_severity || alert.alert_type || 'info',
      recipients: extractedRecipients,
      // Add all additional alert information
      severity: alert.alert_severity || alert.alert_type || 'info',
      priority: alert.priority || 'medium',
      status: alert.status || 'active',
      latitude: alert.latitude,
      longitude: alert.longitude,
      radius_km: alert.radius_km,
      location_text: alert.location_text,
      created_at: alert.created_at_string || (alert.created_at ? String(alert.created_at) : null), // Use formatted string from database, ensure it's a string
      updated_at: alert.updated_at
    };

    console.log('📋 Mapped alert data:', {
      id: mappedAlert.id,
      title: mappedAlert.title,
      type: mappedAlert.type,
      recipients: mappedAlert.recipients,
      severity: mappedAlert.severity,
      priority: mappedAlert.priority,
      status: mappedAlert.status,
      latitude: mappedAlert.latitude ? parseFloat(mappedAlert.latitude) : null,
      longitude: mappedAlert.longitude ? parseFloat(mappedAlert.longitude) : null,
      radius_km: mappedAlert.radius_km
    });

    // Use extracted recipients
    let parsedRecipients = mappedAlert.recipients;

    // Create alert data object with parsed recipients and full info
    const alertData = {
      ...mappedAlert,
      recipients: parsedRecipients
    };

    // Send email with full alert information
    console.log('📧 Attempting to send alert email...');
    await sendAlertEmail(id, alertData);
    console.log('✅ Email sending completed successfully');

    // Update status to resolved (since your table only has 'active' and 'resolved')
    console.log('📝 Updating alert status to resolved...');
    await pool.execute(
      'UPDATE alerts SET status = "resolved", updated_at = NOW() WHERE id = ?',
      [id]
    );
    console.log('✅ Alert status updated to resolved');

    // Log the alert resolution
    try {
      const { created_by } = req.body;
      const finalCreatedBy = created_by !== null && created_by !== undefined
        ? created_by
        : (req.admin?.admin_id || req.user?.id || null);

      console.log('Final created_by value to be inserted:', finalCreatedBy);

      const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip || 'unknown';
      await pool.execute(`
        INSERT INTO activity_logs (admin_id, action, details, ip_address, created_at)
        VALUES (?, 'alert_resolve', ?, ?, NOW())
      `, [finalCreatedBy, `Resolved alert: ${mappedAlert.title} (ID: ${id})`, clientIP]);
      console.log('✅ Activity logged: alert_resolve');
    } catch (logError) {
      console.error('❌ Failed to log alert resolution activity:', logError.message);
    }

    console.log('✅ Alert sent successfully:', id);
    res.json({
      success: true,
      message: 'Alert sent successfully via email'
    });

  } catch (error) {
    console.error('❌ Error sending alert:', error);
    console.error('❌ Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });

    // Check if it's an email-related error
    if (error.message && error.message.toLowerCase().includes('email')) {
      console.error('❌ Email sending failed - check EMAIL_USER and EMAIL_PASS environment variables');
    }

    res.status(500).json({
      success: false,
      message: 'Failed to send alert',
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// DELETE - Delete alert
router.delete('/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('Deleting alert:', id);
    
    // Check if alert exists
    const [existingAlerts] = await pool.execute(
      'SELECT * FROM alerts WHERE id = ?',
      [id]
    );
    
    if (existingAlerts.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Alert not found'
      });
    }
    
    // Delete alert
    await pool.execute('DELETE FROM alerts WHERE id = ?', [id]);
    
    // Log the alert deletion
    try {
      const { created_by } = req.body;
      const finalCreatedBy = created_by !== null && created_by !== undefined
        ? created_by
        : (req.admin?.admin_id || req.user?.id || null);

      console.log('Final created_by value to be inserted:', finalCreatedBy);

      const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip || 'unknown';
      await pool.execute(`
        INSERT INTO activity_logs (admin_id, action, details, ip_address, created_at)
        VALUES (?, 'alert_delete', ?, ?, NOW())
      `, [finalCreatedBy, `Deleted alert: ${existingAlerts[0].title} (ID: ${id})`, clientIP]);
      console.log('✅ Activity logged: alert_delete');
    } catch (logError) {
      console.error('❌ Failed to log alert deletion activity:', logError.message);
    }
    
    res.json({
      success: true,
      message: 'Alert deleted successfully'
    });
    
  } catch (error) {
    console.error('Error deleting alert:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete alert',
      error: error.message
    });
  }
});

// Helper function to send alert emails
async function sendAlertEmail(alertId, alertData) {
  try {
    const {
      title,
      message,
      type,
      recipients,
      severity,
      priority,
      status,
      latitude,
      longitude,
      radius_km,
      location_text,
      created_at,
      updated_at
    } = alertData;
    console.log('📧 Processing email for alert:', { alertId, title, type, recipients });

    // Geocode location if coordinates provided but no location text
    let geocodedAddress = null;
    let locationDisplayText = '';
    
    console.log('📍 Location data:', { location_text, latitude, longitude });
    
    if (latitude && longitude) {
      // If location_text is provided, use it
      if (location_text && location_text.trim() !== '' && location_text.trim() !== 'null') {
        locationDisplayText = location_text.trim();
        console.log('📍 Using provided location_text:', locationDisplayText);
      } else {
        // Try to get location name from coordinates using reverse geocoding
        console.log('📍 Attempting reverse geocoding for coordinates:', latitude, longitude);
        try {
          geocodedAddress = await reverseGeocode(latitude, longitude);
          console.log('📍 Reverse geocoding result:', geocodedAddress);
          
          // If reverse geocoding succeeds and returns valid address
          if (geocodedAddress && geocodedAddress.trim() !== '') {
            locationDisplayText = geocodedAddress.trim();
            console.log('✅ Using reverse geocoded address:', locationDisplayText);
          } else {
            // Fallback: show coordinates as location
            locationDisplayText = `Coordinates: ${parseFloat(latitude).toFixed(6)}, ${parseFloat(longitude).toFixed(6)}`;
            console.log('⚠️ Using coordinates as fallback:', locationDisplayText);
          }
        } catch (e) {
          console.error('❌ Error reverse geocoding:', e);
          // Fallback: show coordinates as location
          locationDisplayText = `Coordinates: ${parseFloat(latitude).toFixed(6)}, ${parseFloat(longitude).toFixed(6)}`;
          console.log('⚠️ Using coordinates as fallback after error:', locationDisplayText);
        }
      }
    } else if (location_text && location_text.trim() !== '' && location_text.trim() !== 'null') {
      // Only location text, no coordinates
      locationDisplayText = location_text.trim();
      console.log('📍 Using location_text only:', locationDisplayText);
    } else {
      // No coordinates and no location text
      locationDisplayText = null;
      console.log('⚠️ No location data available');
    }

    // Get recipient email addresses based on recipient groups
    let emailAddresses = [];

    if (recipients && recipients.length > 0) {
      console.log('👥 Processing recipients:', recipients);

      for (const recipient of recipients) {
        console.log('🔍 Processing recipient:', recipient);

        if (recipient === 'all_users') {
          // Get all user emails from general_users table
          const [users] = await pool.execute('SELECT email FROM general_users WHERE status = 1');
          console.log(`📋 Found ${users.length} active users in general_users table`);
          emailAddresses.push(...users.map(user => user.email));
        } else if (recipient === 'all_students') {
          // Get all student emails
          const [students] = await pool.execute('SELECT email FROM general_users WHERE user_type = "STUDENT" AND status = 1');
          console.log(`🎓 Found ${students.length} active students`);
          emailAddresses.push(...students.map(user => user.email));
        } else if (recipient === 'all_faculty') {
          // Get all faculty emails
          const [faculty] = await pool.execute('SELECT email FROM general_users WHERE user_type = "FACULTY" AND status = 1');
          console.log(`👨‍🏫 Found ${faculty.length} active faculty`);
          emailAddresses.push(...faculty.map(user => user.email));
        } else if (recipient === 'all_employees') {
          // Get all university employee emails
          const [employees] = await pool.execute('SELECT email FROM general_users WHERE user_type = "UNIVERSITY_EMPLOYEE" AND status = 1');
          console.log(`👷 Found ${employees.length} active university employees`);
          emailAddresses.push(...employees.map(user => user.email));
        } else if (recipient === 'emergency_responders') {
          // Get all available staff emails for emergency response
          const [staff] = await pool.execute('SELECT email FROM staff WHERE status = 1 AND availability = "available"');
          console.log(`👨‍🚒 Found ${staff.length} available staff members for emergency response`);
          emailAddresses.push(...staff.map(member => member.email));
        } else if (recipient === 'all_staff') {
          // Get all staff emails
          const [staff] = await pool.execute('SELECT email FROM staff WHERE status = 1 AND availability = "available"');
          console.log(`👥 Found ${staff.length} available staff members`);
          emailAddresses.push(...staff.map(member => member.email));
        } else if (recipient === 'all_admins') {
          // Get all admin emails
          const [admins] = await pool.execute('SELECT email FROM admin WHERE status = "active"');
          console.log(`👑 Found ${admins.length} active admins`);
          emailAddresses.push(...admins.map(admin => admin.email));
        } else if (recipient.startsWith('department_')) {
          // Get users from specific department
          const department = recipient.replace('department_', '').replace('_', ' ');
          const [users] = await pool.execute('SELECT email FROM general_users WHERE department = ? AND status = 1', [department]);
          console.log(`🏢 Found ${users.length} users in ${department} department`);
          emailAddresses.push(...users.map(user => user.email));
        } else if (recipient === 'nearby_users') {
          // Handle nearby users based on geographic location
          console.log('📍 Processing nearby users recipient');
          // This would require additional logic to filter users within the alert radius
          // For now, we'll skip this as it requires more complex geographic queries
          console.log('⚠️ Nearby users recipient detected but not implemented yet');
        } else {
          // Check if recipient is a barangay name (from Rosario barangays)
          const rosarioBarangays = [
            'Alupay', 'Antipolo', 'Bagong Pook', 'Balibago', 'Barangay A', 'Barangay B', 'Barangay C', 'Barangay D', 'Barangay E',
            'Bayawang', 'Baybayin', 'Bulihan', 'Cahigam', 'Calantas', 'Colongan', 'Itlugan', 'Leviste', 'Lumbangan',
            'Maalas-as', 'Mabato', 'Mabunga', 'Macalamcam A', 'Macalamcam B', 'Malaya', 'Maligaya', 'Marilag',
            'Masaya', 'Matamis', 'Mavalor', 'Mayuro', 'Namuco', 'Namunga', 'Nasi', 'Natu', 'Palakpak',
            'Pinagsibaan', 'Putingkahoy', 'Quilib', 'Salao', 'San Carlos', 'San Ignacio', 'San Isidro',
            'San Jose', 'San Roque', 'Santa Cruz', 'Timbugan', 'Tiquiwan', 'Tulos'
          ];

          if (rosarioBarangays.includes(recipient)) {
            // Get users from the specific barangay based on their address
            try {
              const [users] = await pool.execute(`
                SELECT email FROM general_users
                WHERE (address LIKE ? OR city LIKE ? OR state LIKE ? OR zip_code LIKE ?)
                AND status = 1
              `, [
                `%${recipient}%`,
                `%${recipient}%`,
                `%${recipient}%`,
                `%${recipient}%`
              ]);
              console.log(`🏘️ Found ${users.length} users in ${recipient} barangay`);
              emailAddresses.push(...users.map(user => user.email));
            } catch (error) {
              console.error(`❌ Error fetching users for barangay ${recipient}:`, error.message);
            }
          } else if (recipient.includes('@')) {
            // If recipient is an email address directly
            console.log('📧 Adding direct email:', recipient);
            emailAddresses.push(recipient);
          } else {
            console.log(`⚠️ Unknown recipient type: ${recipient}`);
          }
        }
      }
    } else {
      console.log('⚠️ No recipients specified, sending to all active general_users');
      // If no recipients specified, send to all active users in general_users
      const [allUsers] = await pool.execute('SELECT email FROM general_users WHERE status = 1');
      console.log(`👥 Found ${allUsers.length} active users in general_users table`);
      emailAddresses.push(...allUsers.map(u => u.email));

      // If still none (edge case), fallback to system email
      if (emailAddresses.length === 0 && process.env.EMAIL_USER) {
        console.log('🔄 No users found, adding system email as final fallback');
        emailAddresses.push(process.env.EMAIL_USER);
      }
    }

    // Additional fallback: if still no emails, add system email
    if (emailAddresses.length === 0 && process.env.EMAIL_USER) {
      console.log('🔄 Adding system email as final fallback');
      emailAddresses.push(process.env.EMAIL_USER);
    }

    // Remove duplicates
    emailAddresses = [...new Set(emailAddresses)];
    console.log('📬 Final email list:', emailAddresses);

    if (emailAddresses.length === 0) {
      console.log('❌ No email addresses found for recipients');
      throw new Error('No valid email addresses found for the specified recipients');
    }

    // Prepare email content with all alert information
    // Format date to display exactly as stored in database
    // MySQL returns dates as Date objects or strings - we need to extract the exact value
    // Format date to display exactly as stored in database (created_at field)
    // This function uses the exact date/time from database without any timezone conversion
    const formatDateForEmail = (dateValue) => {
      if (!dateValue) {
        return 'N/A';
      }
      
      // Convert to string if it's a Date object (shouldn't happen if using created_at_string)
      let dateString = dateValue;
      if (dateValue instanceof Date) {
        // This should not happen if we're using created_at_string from DATE_FORMAT
        // But as fallback, convert Date to MySQL format string
        // WARNING: This might have timezone issues, so we prefer using created_at_string
        console.warn('⚠️ Received Date object instead of string, converting (may have timezone issues)');
        const year = dateValue.getFullYear();
        const month = String(dateValue.getMonth() + 1).padStart(2, '0');
        const day = String(dateValue.getDate()).padStart(2, '0');
        const hours = String(dateValue.getHours()).padStart(2, '0');
        const minutes = String(dateValue.getMinutes()).padStart(2, '0');
        const seconds = String(dateValue.getSeconds()).padStart(2, '0');
        dateString = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
      } else if (typeof dateValue !== 'string') {
        // Convert to string if not already
        dateString = String(dateValue);
      }
      
      // Parse MySQL datetime format: 'YYYY-MM-DD HH:MM:SS' or 'YYYY-MM-DD HH:MM:SS.mmm'
      // This format comes directly from DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s')
      // Use the exact values from database - NO timezone conversion
      if (typeof dateString === 'string') {
        // Handle both with and without milliseconds
        const mysqlDateRegex = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})(\.\d+)?$/;
        const match = dateString.match(mysqlDateRegex);
        
        if (match) {
          const [, year, month, day, hour, minute, second] = match;
          // Use exact hour, minute, second from database - NO conversion, NO timezone adjustment
          // These are the exact values stored in the created_at field
          const hour24 = parseInt(hour, 10);
          const ampm = hour24 >= 12 ? 'PM' : 'AM';
          const displayHour = hour24 % 12 || 12;
          
          // Format as: MM/DD/YYYY, HH:MM:SS AM/PM
          // This displays the exact same date/time as stored in database created_at field
          return `${month}/${day}/${year}, ${String(displayHour).padStart(2, '0')}:${minute}:${second} ${ampm}`;
        }
        
        // Try ISO format (YYYY-MM-DDTHH:MM:SS) as fallback
        const isoRegex = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/;
        const isoMatch = dateString.match(isoRegex);
        if (isoMatch) {
          const [, year, month, day, hour, minute, second] = isoMatch;
          const hour24 = parseInt(hour, 10);
          const ampm = hour24 >= 12 ? 'PM' : 'AM';
          const displayHour = hour24 % 12 || 12;
          return `${month}/${day}/${year}, ${String(displayHour).padStart(2, '0')}:${minute}:${second} ${ampm}`;
        }
      }
      
      // Last resort: return as string
      console.warn('⚠️ Date format not recognized, returning as-is:', dateValue);
      return String(dateValue);
    };
    
    // Log the raw created_at value for debugging
    console.log('📅 Raw created_at from database:', created_at);
    console.log('📅 Type of created_at:', typeof created_at);
    console.log('📅 created_at value:', JSON.stringify(created_at));
    
    const createdDateFormatted = formatDateForEmail(created_at);
    console.log('📅 Formatted created_at for email:', createdDateFormatted);
    
    // Helper function to format alert type/severity for display
    const formatAlertTypeForDisplay = (alertType) => {
      if (!alertType) return 'ALERT';
      const lowerType = alertType.toLowerCase();
      switch (lowerType) {
        case 'info':
          return 'INFORMATION';
        case 'emergency':
          return 'EMERGENCY';
        case 'warning':
          return 'WARNING';
        default:
          return alertType.toUpperCase();
      }
    };
    
    const formatSeverityForDisplay = (severityValue) => {
      if (!severityValue) return 'INFO';
      const lowerSeverity = severityValue.toLowerCase();
      switch (lowerSeverity) {
        case 'info':
          return 'INFORMATION';
        case 'emergency':
          return 'EMERGENCY';
        case 'warning':
          return 'WARNING';
        default:
          return severityValue.toUpperCase();
      }
    };
    
    const displayAlertType = formatAlertTypeForDisplay(type);
    const displaySeverity = formatSeverityForDisplay(severity);
    
    // Format current date for "Sent on" timestamp (use server's current time)
    const now = new Date();
    const sentYear = now.getFullYear();
    const sentMonth = String(now.getMonth() + 1).padStart(2, '0');
    const sentDay = String(now.getDate()).padStart(2, '0');
    const sentHours = String(now.getHours()).padStart(2, '0');
    const sentMinutes = String(now.getMinutes()).padStart(2, '0');
    const sentSeconds = String(now.getSeconds()).padStart(2, '0');
    const sentHour12 = parseInt(sentHours, 10);
    const sentAmpm = sentHour12 >= 12 ? 'PM' : 'AM';
    const sentDisplayHour = sentHour12 % 12 || 12;
    const sentDate = `${sentMonth}/${sentDay}/${sentYear}, ${String(sentDisplayHour).padStart(2, '0')}:${sentMinutes}:${sentSeconds} ${sentAmpm}`;
    const emailSubject = `[${displayAlertType}] ${title}`;
    const emailHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <title>${title} - Emergency Alert</title>
    <!--[if mso]>
    <style type="text/css">
        table {border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt;}
        .mobile-hidden {display: none !important;}
    </style>
    <![endif]-->
    <style type="text/css">
        /* Reset styles */
        body, table, td, p, a, li, blockquote {
            -webkit-text-size-adjust: 100%;
            -ms-text-size-adjust: 100%;
        }
        table, td {
            mso-table-lspace: 0pt;
            mso-table-rspace: 0pt;
        }
        img {
            -ms-interpolation-mode: bicubic;
            border: 0;
            outline: none;
            text-decoration: none;
        }
        
        /* Mobile styles */
        @media only screen and (max-width: 600px) {
            .email-container {
                width: 100% !important;
                max-width: 100% !important;
                margin: 0 !important;
                padding: 0 !important;
            }
            .email-wrapper {
                width: 100% !important;
                padding: 0 !important;
                border-radius: 0 !important;
            }
            .header-section {
                padding: 24px 20px !important;
            }
            .header-badge {
                font-size: 11px !important;
                padding: 10px 18px !important;
                margin-bottom: 16px !important;
            }
            .header-title {
                font-size: 24px !important;
                margin-bottom: 10px !important;
            }
            .header-subtitle {
                font-size: 14px !important;
            }
            .content-section {
                padding: 24px 16px !important;
            }
            .content-card {
                padding: 20px !important;
                margin-bottom: 20px !important;
                border-radius: 12px !important;
            }
            .card-title {
                font-size: 18px !important;
                margin-bottom: 12px !important;
            }
            .card-title svg {
                width: 18px !important;
                height: 18px !important;
            }
            .message-text {
                font-size: 16px !important;
                padding: 12px 16px !important;
                line-height: 1.6 !important;
            }
            .detail-card {
                padding: 16px !important;
            }
            .detail-card table[role="presentation"] {
                width: 100% !important;
            }
            .detail-icon {
                padding: 10px !important;
                margin-right: 12px !important;
            }
            .detail-icon svg {
                width: 20px !important;
                height: 20px !important;
            }
            .detail-label {
                font-size: 11px !important;
            }
            .detail-value {
                font-size: 16px !important;
            }
            .location-header {
                padding: 20px !important;
                flex-direction: column !important;
                align-items: flex-start !important;
                gap: 12px !important;
            }
            .location-title {
                font-size: 18px !important;
            }
            .location-text {
                font-size: 14px !important;
            }
            .coordinate-box {
                width: 100% !important;
                max-width: 100% !important;
                padding: 0 0 12px 0 !important;
                display: block !important;
            }
            .coordinate-box table[role="presentation"] {
                width: 100% !important;
                max-width: 100% !important;
            }
            /* Force coordinate boxes to stack on mobile */
            table.coordinates-table[role="presentation"] tr {
                display: block !important;
                width: 100% !important;
            }
            table.coordinates-table[role="presentation"] td {
                display: block !important;
                width: 100% !important;
                padding: 0 0 12px 0 !important;
            }
            .map-container {
                padding: 16px !important;
            }
            .map-image {
                border-radius: 12px !important;
            }
            .map-overlay {
                padding: 16px !important;
                flex-direction: column !important;
                gap: 12px !important;
                align-items: flex-start !important;
            }
            .map-overlay-text {
                font-size: 12px !important;
                margin-bottom: 2px !important;
            }
            .map-overlay-subtext {
                font-size: 11px !important;
            }
            .map-button {
                padding: 10px 20px !important;
                font-size: 14px !important;
                width: 100% !important;
                justify-content: center !important;
            }
            .recipients-grid {
                grid-template-columns: 1fr !important;
                gap: 12px !important;
            }
            .recipient-card {
                padding: 12px !important;
            }
            .action-section {
                padding: 24px 20px !important;
                border-radius: 12px !important;
                margin-bottom: 20px !important;
            }
            .action-badge {
                font-size: 11px !important;
                padding: 10px 18px !important;
                margin-bottom: 16px !important;
            }
            .action-title {
                font-size: 18px !important;
                margin-bottom: 12px !important;
            }
            .action-text {
                font-size: 14px !important;
                margin-bottom: 16px !important;
            }
            .action-time {
                font-size: 12px !important;
            }
            .footer-section {
                padding: 24px 20px !important;
            }
            .footer-logo {
                width: 40px !important;
                height: 40px !important;
                margin-bottom: 12px !important;
            }
            .footer-title {
                font-size: 18px !important;
                margin-bottom: 6px !important;
            }
            .footer-subtitle {
                font-size: 14px !important;
            }
        }
        
        /* Desktop styles */
        @media only screen and (min-width: 601px) {
            .mobile-hidden {
                display: block !important;
            }
        }
    </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: 'Inter', 'Segoe UI', Arial, sans-serif;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f3f4f6;">
        <tr>
            <td align="center" style="padding: 20px 0;">
                <table role="presentation" class="email-container" cellspacing="0" cellpadding="0" border="0" width="650" style="max-width: 650px; background-color: #ffffff; border-radius: 24px; box-shadow: 0 8px 32px rgba(0,0,0,0.12); overflow: hidden;">
                    <!-- Header -->
                    <tr>
                        <td class="header-section" style="background: linear-gradient(135deg, ${getAlertColor(type)} 0%, ${getAlertColor(type)}ee 100%); color: white; padding: 42px 32px; text-align: center; position: relative;">
                            <div style="position: relative; z-index: 2;">
                                <div class="header-badge" style="display: inline-flex; align-items: center; gap: 12px; background-color: rgba(255,255,255,0.22); backdrop-filter: blur(8px); padding: 12px 24px; border-radius: 32px; font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 24px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                                    <svg width="20" height="20" fill="currentColor" viewBox="0 0 20 20" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));">
                                        <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"></path>
                                    </svg>
                                    ${displayAlertType} ALERT
                                </div>
                                <h1 class="header-title" style="margin: 0; font-size: 36px; font-weight: 800; margin-bottom: 14px; text-shadow: 0 4px 8px rgba(0,0,0,0.12); line-height: 1.3;">${title}</h1>
                                <p class="header-subtitle" style="margin: 0; font-size: 16px; opacity: 0.95; font-weight: 600; letter-spacing: 0.6px; text-shadow: 0 2px 4px rgba(0,0,0,0.08);">Alert ID: ${alertId}</p>
                            </div>
                            <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: radial-gradient(circle at top right, rgba(255,255,255,0.12) 0%, transparent 60%); z-index: 1;"></div>
                        </td>
                    </tr>
                    
                    <!-- Content -->
                    <tr>
                        <td class="content-section" style="padding: 42px 32px; background-color: #f8fafc;">
                            <!-- Alert Message -->
                            <table role="presentation" class="content-card" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: white; border-radius: 18px; padding: 32px; margin-bottom: 32px; border: 1px solid #e5e7eb; box-shadow: 0 4px 16px rgba(0,0,0,0.06);">
                                <tr>
                                    <td>
                                        <h2 class="card-title" style="color: #1f2937; margin-top: 0; font-size: 24px; font-weight: 700; margin-bottom: 18px; display: flex; align-items: center; gap: 12px;">
                                            <svg width="24" height="24" fill="currentColor" viewBox="0 0 20 20" style="color: ${getAlertColor(type)};">
                                                <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"></path>
                                            </svg>
                                            Alert Message
                                        </h2>
                                        <p class="message-text" style="color: #374151; line-height: 1.8; font-size: 18px; margin: 0; padding: 16px 20px; background-color: #f9fafb; border-radius: 12px; border-left: 4px solid ${getAlertColor(type)};">${message}</p>
                                    </td>
                                </tr>
                            </table>

                            <!-- Alert Details -->
                            <table role="presentation" class="content-card" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: white; border-radius: 18px; padding: 32px; margin-bottom: 32px; border: 1px solid #e5e7eb; box-shadow: 0 4px 16px rgba(0,0,0,0.06);">
                                <tr>
                                    <td>
                                        <h3 class="card-title" style="margin: 0 0 24px 0; color: #1f2937; font-size: 24px; font-weight: 700; display: flex; align-items: center; gap: 12px;">
                                            <svg width="24" height="24" fill="currentColor" viewBox="0 0 20 20" style="color: ${getAlertColor(type)};">
                                                <path fill-rule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clip-rule="evenodd"></path>
                                            </svg>
                                            Alert Details
                                        </h3>
                                        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom: 24px;">
                                            <tr>
                                                <td style="padding-bottom: 16px;">
                                                    <table role="presentation" class="detail-card" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: white; border-radius: 16px; border: 1px solid #e5e7eb; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                                                        <tr>
                                                            <td style="padding: 20px;">
                                                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                                                    <tr>
                                                                        <td width="56" style="vertical-align: middle; padding-right: 16px;">
                                                                            <div class="detail-icon" style="background-color: ${getAlertColor(type)}15; padding: 12px; border-radius: 12px; width: 48px; height: 48px; text-align: center;">
                                                                                <svg width="24" height="24" fill="${getAlertColor(type)}" viewBox="0 0 20 20" style="vertical-align: middle;">
                                                                                    <path d="M3.807 2.342a1 1 0 010 1.414l-1.06 1.06a1 1 0 11-1.414-1.414l1.06-1.06a1 1 0 011.414 0zm12.728 0a1 1 0 011.414 0l1.06 1.06a1 1 0 11-1.414 1.414l-1.06-1.06a1 1 0 010-1.414zM10 2a1 1 0 011 1v1.586l4.707 4.707a1 1 0 01-1.414 1.414L10 6.414l-4.293 4.293a1 1 0 01-1.414-1.414L9 4.586V3a1 1 0 011-1z"/>
                                                                                </svg>
                                                                            </div>
                                                                        </td>
                                                                        <td style="vertical-align: middle;">
                                                                            <div class="detail-label" style="font-size: 13px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Severity Level</div>
                                                                            <div class="detail-value" style="font-size: 18px; font-weight: 700; color: ${getAlertColor(type)};">${displaySeverity}</div>
                                                                        </td>
                                                                    </tr>
                                                                </table>
                                                            </td>
                                                        </tr>
                                                    </table>
                                                </td>
                                            </tr>
                                            <tr>
                                                <td style="padding-bottom: 16px;">
                                                    <table role="presentation" class="detail-card" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: white; border-radius: 16px; border: 1px solid #e5e7eb; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                                                        <tr>
                                                            <td style="padding: 20px;">
                                                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                                                    <tr>
                                                                        <td width="56" style="vertical-align: middle; padding-right: 16px;">
                                                                            <div class="detail-icon" style="background-color: ${getAlertColor(type)}15; padding: 12px; border-radius: 12px; width: 48px; height: 48px; text-align: center;">
                                                                                <svg width="24" height="24" fill="${getAlertColor(type)}" viewBox="0 0 20 20" style="vertical-align: middle;">
                                                                                    <path d="M5 4a1 1 0 00-2 0v7.268a2 2 0 000 3.464V16a1 1 0 102 0v-1.268a2 2 0 000-3.464V4zM11 4a1 1 0 10-2 0v1.268a2 2 0 000 3.464V16a1 1 0 102 0V8.732a2 2 0 000-3.464V4zM16 3a1 1 0 011 1v7.268a2 2 0 010 3.464V16a1 1 0 11-2 0v-1.268a2 2 0 010-3.464V4a1 1 0 011-1z"/>
                                                                                </svg>
                                                                            </div>
                                                                        </td>
                                                                        <td style="vertical-align: middle;">
                                                                            <div class="detail-label" style="font-size: 13px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Priority</div>
                                                                            <div class="detail-value" style="font-size: 18px; font-weight: 700; color: ${getAlertColor(type)};">${priority.toUpperCase()}</div>
                                                                        </td>
                                                                    </tr>
                                                                </table>
                                                            </td>
                                                        </tr>
                                                    </table>
                                                </td>
                                            </tr>
                                            <tr>
                                                <td style="padding-bottom: 16px;">
                                                    <table role="presentation" class="detail-card" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: white; border-radius: 16px; border: 1px solid #e5e7eb; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                                                        <tr>
                                                            <td style="padding: 20px;">
                                                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                                                    <tr>
                                                                        <td width="56" style="vertical-align: middle; padding-right: 16px;">
                                                                            <div class="detail-icon" style="background-color: ${getAlertColor(type)}15; padding: 12px; border-radius: 12px; width: 48px; height: 48px; text-align: center;">
                                                                                <svg width="24" height="24" fill="${getAlertColor(type)}" viewBox="0 0 20 20" style="vertical-align: middle;">
                                                                                    <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
                                                                                </svg>
                                                                            </div>
                                                                        </td>
                                                                        <td style="vertical-align: middle;">
                                                                            <div class="detail-label" style="font-size: 13px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Status</div>
                                                                            <div class="detail-value" style="font-size: 18px; font-weight: 700; color: ${getAlertColor(type)};">${status.toUpperCase()}</div>
                                                                        </td>
                                                                    </tr>
                                                                </table>
                                                            </td>
                                                        </tr>
                                                    </table>
                                                </td>
                                            </tr>
                                        </table>
                                        ${locationDisplayText && locationDisplayText !== 'Location not specified' && locationDisplayText !== null ? `
                                        <!-- Location Information -->
                                        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top: 32px; background-color: white; border-radius: 20px; border: 1px solid #e5e7eb; box-shadow: 0 4px 16px rgba(0,0,0,0.06); overflow: hidden;">
                                            <tr>
                                                <td class="location-header" style="background: linear-gradient(135deg, ${getAlertColor(type)}11 0%, ${getAlertColor(type)}22 100%); padding: 24px; border-bottom: 1px solid #e5e7eb;">
                                                    <div style="display: flex; align-items: center; gap: 16px;">
                                                        <div style="background-color: ${getAlertColor(type)}22; padding: 12px; border-radius: 12px;">
                                                            <svg width="28" height="28" fill="${getAlertColor(type)}" viewBox="0 0 20 20">
                                                                <path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd"></path>
                                                            </svg>
                                                        </div>
                                                        <div>
                                                            <h4 class="location-title" style="margin: 0 0 4px 0; font-size: 20px; font-weight: 700; color: #1f2937;">Incident Location</h4>
                                                            <p class="location-text" style="margin: 0; font-size: 15px; color: #6b7280; font-weight: 500;">${locationDisplayText}</p>
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                            ${latitude && longitude ? `
                                            <tr>
                                                <td class="map-container" style="padding: 24px;">
                                                    <table role="presentation" class="coordinates-table" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom: 20px;">
                                                        <tr>
                                                            <td width="${radius_km ? '33' : '50'}%" class="coordinate-box" style="padding: 0 8px 16px 0; vertical-align: top;">
                                                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="padding: 16px; background-color: #f9fafb; border-radius: 12px; border: 1px solid #e5e7eb;">
                                                                    <tr>
                                                                        <td>
                                                                            <div style="font-size: 13px; font-weight: 600; color: #6b7280; margin-bottom: 4px;">Latitude</div>
                                                                            <div style="font-size: 16px; font-weight: 700; color: #1f2937;">${parseFloat(latitude).toFixed(6)}</div>
                                                                        </td>
                                                                    </tr>
                                                                </table>
                                                            </td>
                                                            <td width="${radius_km ? '33' : '50'}%" class="coordinate-box" style="padding: 0 ${radius_km ? '8px' : '0'} 16px ${radius_km ? '8px' : '8px'}; vertical-align: top;">
                                                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="padding: 16px; background-color: #f9fafb; border-radius: 12px; border: 1px solid #e5e7eb;">
                                                                    <tr>
                                                                        <td>
                                                                            <div style="font-size: 13px; font-weight: 600; color: #6b7280; margin-bottom: 4px;">Longitude</div>
                                                                            <div style="font-size: 16px; font-weight: 700; color: #1f2937;">${parseFloat(longitude).toFixed(6)}</div>
                                                                        </td>
                                                                    </tr>
                                                                </table>
                                                            </td>
                                                            ${radius_km ? `
                                                            <td width="34%" class="coordinate-box" style="padding: 0 0 16px 8px; vertical-align: top;">
                                                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="padding: 16px; background-color: #f9fafb; border-radius: 12px; border: 1px solid #e5e7eb;">
                                                                    <tr>
                                                                        <td>
                                                                            <div style="font-size: 13px; font-weight: 600; color: #6b7280; margin-bottom: 4px;">Affected Radius</div>
                                                                            <div style="font-size: 16px; font-weight: 700; color: #1f2937;">${radius_km} km</div>
                                                                        </td>
                                                                    </tr>
                                                                </table>
                                                            </td>
                                                            ` : ''}
                                                        </tr>
                                                    </table>
                                                    <div style="position: relative; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.08); background-color: #f3f4f6; min-height: 300px;">
                                                        ${process.env.GOOGLE_MAPS_API_KEY ? `
                                                        <img src="https://maps.googleapis.com/maps/api/staticmap?center=${latitude},${longitude}&zoom=15&size=800x400&scale=2&markers=color:${getAlertColor(type).replace('#', '0x')}%7C${latitude},${longitude}&key=${process.env.GOOGLE_MAPS_API_KEY}" 
                                                            alt="Alert Location Map" 
                                                            class="map-image"
                                                            style="width: 100%; height: auto; display: block; max-width: 100%;"
                                                            onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                                                        ` : ''}
                                                        <div style="display: ${process.env.GOOGLE_MAPS_API_KEY ? 'none' : 'flex'}; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; text-align: center; background: linear-gradient(135deg, ${getAlertColor(type)}15 0%, ${getAlertColor(type)}08 100%); min-height: 300px;">
                                                            <div style="background-color: ${getAlertColor(type)}22; padding: 20px; border-radius: 16px; margin-bottom: 20px;">
                                                                <svg width="48" height="48" fill="${getAlertColor(type)}" viewBox="0 0 20 20">
                                                                    <path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd"></path>
                                                                </svg>
                                                            </div>
                                                            <h4 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 700; color: #1f2937;">Location Coordinates</h4>
                                                            <p style="margin: 0 0 20px 0; font-size: 16px; color: #6b7280; line-height: 1.6;">
                                                                ${latitude}, ${longitude}
                                                            </p>
                                                            <a href="https://www.google.com/maps?q=${latitude},${longitude}" 
                                                                target="_blank"
                                                                class="map-button"
                                                                style="display: inline-flex; align-items: center; gap: 8px; padding: 14px 28px; background: ${getAlertColor(type)}; color: white; text-decoration: none; border-radius: 12px; font-size: 16px; font-weight: 600; transition: all 0.3s ease; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
                                                                <svg width="20" height="20" fill="currentColor" viewBox="0 0 20 20">
                                                                    <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z"></path>
                                                                    <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z"></path>
                                                                </svg>
                                                                Open in Google Maps
                                                            </a>
                                                        </div>
                                                        ${process.env.GOOGLE_MAPS_API_KEY ? `
                                                        <div class="map-overlay" style="position: absolute; bottom: 0; left: 0; right: 0; padding: 20px; background: linear-gradient(to top, rgba(0,0,0,0.8), transparent); display: flex; justify-content: space-between; align-items: center;">
                                                            <div style="color: white;">
                                                                <div class="map-overlay-text" style="font-size: 14px; font-weight: 600; opacity: 0.9; margin-bottom: 4px;">View Full Map</div>
                                                                <div class="map-overlay-subtext" style="font-size: 12px; opacity: 0.7;">Click to open in Google Maps</div>
                                                            </div>
                                                            <a href="https://www.google.com/maps?q=${latitude},${longitude}" 
                                                                target="_blank"
                                                                class="map-button"
                                                                style="display: inline-flex; align-items: center; gap: 8px; padding: 12px 24px; background: white; color: ${getAlertColor(type)}; text-decoration: none; border-radius: 10px; font-size: 15px; font-weight: 600; transition: all 0.3s ease;">
                                                                <svg width="18" height="18" fill="currentColor" viewBox="0 0 20 20">
                                                                    <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z"></path>
                                                                    <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z"></path>
                                                                </svg>
                                                                Open Maps
                                                            </a>
                                                        </div>
                                                        ` : ''}
                                                    </div>
                                                </td>
                                            </tr>
                                            ` : ''}
                                        </table>
                                        ` : ''}
                                    </td>
                                </tr>
                            </table>

                            <!-- Action Section -->
                            <table role="presentation" class="action-section" cellspacing="0" cellpadding="0" border="0" width="100%" style="background: linear-gradient(135deg, ${getAlertColor(type)} 0%, ${getAlertColor(type)}ee 100%); color: white; padding: 36px; text-align: center; border-radius: 18px; margin-bottom: 32px; position: relative; overflow: hidden;">
                                <tr>
                                    <td style="position: relative; z-index: 2;">
                                        <div class="action-badge" style="display: inline-flex; align-items: center; gap: 12px; background-color: rgba(255,255,255,0.22); backdrop-filter: blur(8px); padding: 12px 24px; border-radius: 32px; margin-bottom: 24px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                                            <svg width="24" height="24" fill="currentColor" viewBox="0 0 20 20">
                                                <path fill-rule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path>
                                            </svg>
                                            <span style="font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px;">Official Emergency Alert</span>
                                        </div>
                                        <h3 class="action-title" style="margin: 0 0 16px 0; font-size: 24px; font-weight: 800; text-shadow: 0 2px 4px rgba(0,0,0,0.1);">SoteROS Emergency Management System</h3>
                                        <p class="action-text" style="margin: 0 0 24px 0; font-size: 16px; opacity: 0.95; font-weight: 500; max-width: 500px; margin-left: auto; margin-right: auto; line-height: 1.6;">This is an official alert notification from the MDRRMO Rosario, Batangas Emergency Response Team.</p>
                                 
                                    </td>
                                </tr>
                                <tr>
                                    <td style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: radial-gradient(circle at top right, rgba(255,255,255,0.15) 0%, transparent 60%); z-index: 1;"></td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                        <td class="footer-section" style="background: linear-gradient(135deg, #1f2937 0%, #111827 100%); color: #9ca3af; padding: 36px; text-align: center; border-bottom-left-radius: 24px; border-bottom-right-radius: 24px; position: relative; overflow: hidden;">
                            <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: radial-gradient(circle at top right, rgba(255,255,255,0.08) 0%, transparent 60%); z-index: 1;"></div>
                            <div style="position: relative; z-index: 2; max-width: 440px; margin: 0 auto;">
                                <div style="margin-bottom: 24px;">
                                    <svg class="footer-logo" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin: 0 auto 16px; color: #f3f4f6;">
                                        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path>
                                    </svg>
                                </div>
                                <div class="footer-title" style="font-size: 22px; font-weight: 800; color: #f3f4f6; margin-bottom: 8px; letter-spacing: 0.5px;">MDRRMO Rosario, Batangas</div>
                                <div class="footer-subtitle" style="opacity: 0.9; font-size: 16px; font-weight: 500; letter-spacing: 0.3px;">SoteROS Emergency Management System</div>
                            </div>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
    `;
    
    // Send email using BCC for privacy - recipients won't see each other's emails
    const mailOptions = {
      from: `${process.env.EMAIL_FROM_NAME || 'SoteROS Emergency Management'} <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER, // Send to system email
      bcc: emailAddresses, // All recipients in BCC for privacy
      subject: emailSubject,
      html: emailHtml
    };

    console.log('📤 Sending email with BCC to:', {
      from: mailOptions.from,
      bcc: `${emailAddresses.length} recipients (BCC - hidden)`,
      subject: mailOptions.subject
    });

    const emailResult = await sendEmail(mailOptions);
    console.log('✅ Email sent successfully:', emailResult.messageId);

    // Log the email sending (optional - don't fail if table doesn't exist)
    try {
      await pool.execute(`
        INSERT INTO alert_logs (alert_id, action, recipients_count, created_at)
        VALUES (?, 'email_sent', ?, NOW())
      `, [alertId, emailAddresses.length]);
      console.log('📝 Email sending logged to database');
    } catch (logError) {
      console.log('⚠️ Failed to log email sending (table may not exist):', logError.message);
    }

    console.log(`📊 Alert email sent to ${emailAddresses.length} recipients`);
    
  } catch (error) {
    console.error('Error sending alert email:', error);
    throw error;
  }
}

// Helper function to get alert color based on type
function getAlertColor(type) {
  if (!type) return '#6b7280'; // Default color for undefined/null types

  switch (type.toLowerCase()) {
    case 'emergency': return '#dc2626';
    case 'warning': return '#d97706';
    case 'info': return '#2563eb';
    case 'typhoon': return '#dc2626';
    case 'earthquake': return '#d97706';
    case 'fire': return '#dc2626';
    default: return '#6b7280';
  }
}

// Helper function for reverse geocoding
async function reverseGeocode(lat, lng) {
  return new Promise((resolve, reject) => {
    try {
      // OpenStreetMap Nominatim requires a User-Agent header
      const urlPath = `/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
      
      const options = {
        hostname: 'nominatim.openstreetmap.org',
        path: urlPath,
        method: 'GET',
        headers: {
          'User-Agent': 'SoteROS-Emergency-Management/1.0 (MDRRMO Rosario Batangas)',
          'Accept': 'application/json'
        },
        timeout: 5000
      };
      
      const req = https.request(options, (res) => {
        let data = '';
        
        // Check if request was successful
        if (res.statusCode !== 200) {
          console.error(`❌ Reverse geocoding failed with status: ${res.statusCode}`);
          resolve(null);
          return;
        }
        
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            
            // Check if we got a valid response
            if (result.error) {
              console.error('❌ Reverse geocoding error:', result.error);
              resolve(null);
              return;
            }
            
            // Try to get a readable address
            if (result.display_name) {
              // Clean up the address - remove redundant information
              let address = result.display_name;
              
              // If address contains Philippines, try to format it better
              if (address.includes('Philippines')) {
                // Extract relevant parts (barangay, city, province)
                const addressParts = result.address || {};
                const parts = [];
                
                if (addressParts.road) parts.push(addressParts.road);
                if (addressParts.village || addressParts.suburb) parts.push(addressParts.village || addressParts.suburb);
                if (addressParts.city || addressParts.town) parts.push(addressParts.city || addressParts.town);
                if (addressParts.state) parts.push(addressParts.state);
                
                if (parts.length > 0) {
                  address = parts.join(', ');
                }
              }
              
              resolve(address);
            } else if (result.address) {
              // Fallback: construct address from address parts
              const addr = result.address;
              const parts = [];
              
              if (addr.road) parts.push(addr.road);
              if (addr.village || addr.suburb) parts.push(addr.village || addr.suburb);
              if (addr.city || addr.town) parts.push(addr.city || addr.town);
              if (addr.state) parts.push(addr.state);
              if (addr.country && !addr.country.includes('Philippines')) parts.push(addr.country);
              
              resolve(parts.length > 0 ? parts.join(', ') : null);
            } else {
              resolve(null);
            }
          } catch (e) {
            console.error('❌ Error parsing reverse geocoding response:', e);
            resolve(null);
          }
        });
      });
      
      req.on('error', (e) => {
        console.error('❌ Reverse geocoding request error:', e.message);
        resolve(null);
      });
      
      req.on('timeout', () => {
        console.error('❌ Reverse geocoding request timeout');
        req.destroy();
        resolve(null);
      });
      
      req.setTimeout(5000);
      req.end();
      
    } catch (e) {
      console.error('❌ Error in reverseGeocode:', e);
      resolve(null);
    }
  });
}

module.exports = router;
