const db = require('../config/conn');

class NotificationService {
  // Create notification for all users (like admin activity logs)
  static async createNotificationForAllUsers(notificationData) {
    try {
      const { type, title, message, severity = 'info', relatedId = null } = notificationData;
      
      // Try to create notification, if table doesn't exist, create it
      try {
        const [result] = await db.execute(
          'INSERT INTO notifications (user_id, type, title, message, severity, related_id) VALUES (NULL, ?, ?, ?, ?, ?)',
          [type, title, message, severity, relatedId]
        );
        
        console.log(`Notification created for all users: ${title}`);
        return result.insertId;
      } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') {
          // Create the table if it doesn't exist
          await this.createNotificationsTable();
          
          // Try again
          const [result] = await db.execute(
            'INSERT INTO notifications (user_id, type, title, message, severity, related_id) VALUES (NULL, ?, ?, ?, ?, ?)',
            [type, title, message, severity, relatedId]
          );
          
          console.log(`Notification created for all users: ${title}`);
          return result.insertId;
        } else {
          throw error;
        }
      }
    } catch (error) {
      console.error('Error creating notification for all users:', error);
      // Don't throw error, just log it like admin system
    }
  }

  // Create notifications table (like admin tables)
  static async createNotificationsTable() {
    try {
      console.log('Creating notifications table...');
      
      await db.execute(`
        CREATE TABLE \`notifications\` (
          \`id\` int(11) NOT NULL AUTO_INCREMENT,
          \`user_id\` int(11) DEFAULT NULL,
          \`type\` enum('alert','safety_protocol','welfare','system') NOT NULL,
          \`title\` varchar(255) NOT NULL,
          \`message\` text NOT NULL,
          \`severity\` enum('info','warning','emergency') NOT NULL DEFAULT 'info',
          \`is_read\` tinyint(1) NOT NULL DEFAULT 0,
          \`related_id\` int(11) DEFAULT NULL,
          \`created_at\` timestamp NOT NULL DEFAULT current_timestamp(),
          \`updated_at\` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
          PRIMARY KEY (\`id\`),
          KEY \`user_id\` (\`user_id\`),
          KEY \`type\` (\`type\`),
          KEY \`is_read\` (\`is_read\`),
          KEY \`created_at\` (\`created_at\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
      `);

      console.log('Notifications table created successfully');
    } catch (error) {
      console.error('Error creating notifications table:', error);
    }
  }

  // Create notification for specific user
  static async createNotificationForUser(userId, notificationData) {
    try {
      const { type, title, message, severity = 'info', relatedId = null } = notificationData;
      
      const [result] = await db.execute(
        'INSERT INTO notifications (user_id, type, title, message, severity, related_id) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, type, title, message, severity, relatedId]
      );
      
      console.log(`Notification created for user ${userId}: ${title}`);
      return result.insertId;
    } catch (error) {
      console.error('Error creating notification for user:', error);
      // Don't throw error, just log it like admin system
    }
  }

  // Create alert notification for specific recipients
  static async createAlertNotification(alertData) {
    const { id, title, description, alert_severity, alert_type, recipients } = alertData;
    
    const severityMap = {
      'emergency': 'emergency',
      'warning': 'warning',
      'info': 'info'
    };

    const notificationData = {
      type: 'alert',
      title: `🚨 ${title}`,
      message: description,
      severity: severityMap[alert_severity] || 'info',
      relatedId: id
    };

    // If recipients are specified, send only to those users
    if (recipients && recipients.length > 0) {
      try {
        const userIds = await this.getUserIdsFromRecipients(recipients);
        console.log(`📬 Creating alert notifications for ${userIds.length} users based on recipients:`, recipients);
        
        if (userIds.length === 0) {
          console.warn('⚠️ No users found for specified recipients, notification not created');
          return null;
        }

        // Create notification for each user
        const notificationIds = [];
        for (const userId of userIds) {
          try {
            const notifId = await this.createNotificationForUser(userId, notificationData);
            if (notifId) notificationIds.push(notifId);
          } catch (error) {
            console.error(`Error creating notification for user ${userId}:`, error);
          }
        }
        
        console.log(`✅ Created ${notificationIds.length} alert notifications for recipients`);
        return notificationIds;
      } catch (error) {
        console.error('Error creating notifications for recipients:', error);
        // Fallback to all users if recipient processing fails
        console.log('⚠️ Falling back to all users notification');
        return await this.createNotificationForAllUsers(notificationData);
      }
    } else {
      // No recipients specified, send to all users
      console.log('📬 Creating alert notification for all users (no recipients specified)');
      return await this.createNotificationForAllUsers(notificationData);
    }
  }

  // Get user IDs based on recipient groups (similar to email recipient logic)
  static async getUserIdsFromRecipients(recipients) {
    const userIds = new Set(); // Use Set to avoid duplicates
    
    for (const recipient of recipients) {
      try {
        if (recipient === 'all_users') {
          // Get all active user IDs from general_users table
          const [users] = await db.execute('SELECT user_id FROM general_users WHERE status = 1');
          users.forEach(user => userIds.add(user.user_id));
        } else if (recipient === 'all_students') {
          // Get all student user IDs
          const [students] = await db.execute('SELECT user_id FROM general_users WHERE user_type = "STUDENT" AND status = 1');
          students.forEach(user => userIds.add(user.user_id));
        } else if (recipient === 'all_faculty') {
          // Get all faculty user IDs
          const [faculty] = await db.execute('SELECT user_id FROM general_users WHERE user_type = "FACULTY" AND status = 1');
          faculty.forEach(user => userIds.add(user.user_id));
        } else if (recipient === 'all_employees') {
          // Get all university employee user IDs
          const [employees] = await db.execute('SELECT user_id FROM general_users WHERE user_type = "UNIVERSITY_EMPLOYEE" AND status = 1');
          employees.forEach(user => userIds.add(user.user_id));
        } else if (recipient === 'emergency_responders' || recipient === 'all_staff') {
          // Get all available staff user IDs
          const [staff] = await db.execute('SELECT staff_id as user_id FROM staff WHERE status = 1 AND availability = "available"');
          staff.forEach(member => userIds.add(member.user_id));
        } else if (recipient === 'all_admins') {
          // Get all admin user IDs
          const [admins] = await db.execute('SELECT admin_id as user_id FROM admin WHERE status = "active"');
          admins.forEach(admin => userIds.add(admin.user_id));
        } else if (recipient.startsWith('department_')) {
          // Get users from specific department
          const department = recipient.replace('department_', '').replace('_', ' ');
          const [users] = await db.execute('SELECT user_id FROM general_users WHERE department = ? AND status = 1', [department]);
          users.forEach(user => userIds.add(user.user_id));
        } else if (recipient === 'nearby_users') {
          // Handle nearby users - would need coordinates for this
          // For now, skip as it requires geographic queries
          console.log('⚠️ Nearby users recipient detected but not implemented for notifications');
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
            const [users] = await db.execute(`
              SELECT user_id FROM general_users
              WHERE (address LIKE ? OR city LIKE ? OR state LIKE ? OR zip_code LIKE ?)
              AND status = 1
            `, [
              `%${recipient}%`,
              `%${recipient}%`,
              `%${recipient}%`,
              `%${recipient}%`
            ]);
            users.forEach(user => userIds.add(user.user_id));
          } else if (recipient.includes('@')) {
            // If recipient is an email address, find user by email
            const [users] = await db.execute('SELECT user_id FROM general_users WHERE email = ? AND status = 1', [recipient]);
            users.forEach(user => userIds.add(user.user_id));
            
            // Also check staff table
            const [staff] = await db.execute('SELECT staff_id as user_id FROM staff WHERE email = ? AND status = 1', [recipient]);
            staff.forEach(member => userIds.add(member.user_id));
            
            // Also check admin table
            const [admins] = await db.execute('SELECT admin_id as user_id FROM admin WHERE email = ? AND status = "active"', [recipient]);
            admins.forEach(admin => userIds.add(admin.user_id));
          } else {
            console.log(`⚠️ Unknown recipient type for notifications: ${recipient}`);
          }
        }
      } catch (error) {
        console.error(`❌ Error processing recipient ${recipient} for notifications:`, error);
      }
    }

    return Array.from(userIds);
  }

  // Create safety protocol notification
  static async createSafetyProtocolNotification(protocolData) {
    const { id, title, description, type } = protocolData;
    
    const typeEmoji = {
      'fire': '🔥',
      'earthquake': '🌍',
      'medical': '🏥',
      'intrusion': '🚨',
      'general': '🛡️'
    };

    return await this.createNotificationForAllUsers({
      type: 'safety_protocol',
      title: `${typeEmoji[type] || '🛡️'} New Safety Protocol: ${title}`,
      message: description,
      severity: 'warning',
      relatedId: id
    });
  }

  // Create welfare check settings notification
  static async createWelfareSettingsNotification(settingsData) {
    const { isActive, title, description } = settingsData;
    
    const statusEmoji = isActive ? '✅' : '❌';
    const statusText = isActive ? 'Enabled' : 'Disabled';
    
    return await this.createNotificationForAllUsers({
      type: 'welfare',
      title: `${statusEmoji} Welfare Check System ${statusText}`,
      message: isActive 
        ? `The welfare check system is now active. ${description || 'You can now report your welfare status.'}`
        : `The welfare check system has been disabled. ${description || 'Please contact emergency services directly if needed.'}`,
      severity: isActive ? 'info' : 'warning',
      relatedId: null
    });
  }

  // Create system notification
  static async createSystemNotification(title, message, severity = 'info') {
    return await this.createNotificationForAllUsers({
      type: 'system',
      title: `🔧 ${title}`,
      message: message,
      severity: severity
    });
  }

  // Create incident report validation notification
  static async createIncidentValidationNotification(incidentData, validationStatus, userId) {
    const { incident_id, incident_type, description, priority_level } = incidentData;
    
    const statusEmoji = validationStatus === 'validated' ? '✅' : '❌';
    const statusText = validationStatus === 'validated' ? 'Validated' : 'Rejected';
    const severity = validationStatus === 'validated' ? 'info' : 'warning';
    
    const title = `${statusEmoji} Report ${statusText}: ${incident_type}`;
    const message = `Your incident report "${incident_type}" has been ${validationStatus} by the admin team. ${validationStatus === 'validated' ? 'The response team has been notified.' : 'Please review and resubmit if needed.'}`;
    
    return await this.createNotificationForUser(userId, {
      type: 'system',
      title: title,
      message: message,
      severity: severity,
      relatedId: incident_id
    });
  }

  // Create incident status update notification
  static async createIncidentStatusNotification(incidentData, status, userId) {
    const { incident_id, incident_type, description, priority_level } = incidentData;
    
    const statusEmoji = status === 'resolved' ? '🎉' : '🔒';
    const statusText = status === 'resolved' ? 'Resolved' : 'Closed';
    const severity = 'info';
    
    const title = `${statusEmoji} Report ${statusText}: ${incident_type}`;
    const message = `Your incident report "${incident_type}" has been ${status}. ${status === 'resolved' ? 'Thank you for your report. The issue has been successfully resolved.' : 'Your incident report has been closed.'}`;
    
    return await this.createNotificationForUser(userId, {
      type: 'system',
      title: title,
      message: message,
      severity: severity,
      relatedId: incident_id
    });
  }

  // Get user's notification preferences (simplified like admin system)
  static async getUserNotificationSettings(userId) {
    // Return default settings for now (like admin system)
    return {
      enableAlerts: true,
      enableSafetyProtocols: true,
      enableWelfare: true,
      enableSystem: true
    };
  }
}

module.exports = NotificationService;
