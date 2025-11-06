const db = require('../config/conn');

class AdminNotificationService {
  /**
   * Create notification for all admins
   * @param {Object} notificationData - Notification details
   * @returns {Promise<number>} - Notification ID
   */
  static async createNotificationForAllAdmins(notificationData) {
    try {
      const {
        type,
        title,
        message,
        severity = 'info',
        priority_level = 'medium',
        related_type = null,
        related_id = null,
        action_url = null,
        metadata = null
      } = notificationData;

      const [result] = await db.execute(
        `INSERT INTO admin_notifications 
        (admin_id, type, title, message, severity, priority_level, related_type, related_id, action_url, metadata) 
        VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          type,
          title,
          message,
          severity,
          priority_level,
          related_type,
          related_id,
          action_url,
          metadata ? JSON.stringify(metadata) : null
        ]
      );

      console.log(`✅ Admin notification created for all admins: ${title}`);
      return result.insertId;
    } catch (error) {
      console.error('❌ Error creating admin notification:', error);
      throw error;
    }
  }

  /**
   * Create notification for specific admin
   * @param {number} adminId - Admin ID
   * @param {Object} notificationData - Notification details
   * @returns {Promise<number>} - Notification ID
   */
  static async createNotificationForAdmin(adminId, notificationData) {
    try {
      const {
        type,
        title,
        message,
        severity = 'info',
        priority_level = 'medium',
        related_type = null,
        related_id = null,
        action_url = null,
        metadata = null
      } = notificationData;

      const [result] = await db.execute(
        `INSERT INTO admin_notifications 
        (admin_id, type, title, message, severity, priority_level, related_type, related_id, action_url, metadata) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          adminId,
          type,
          title,
          message,
          severity,
          priority_level,
          related_type,
          related_id,
          action_url,
          metadata ? JSON.stringify(metadata) : null
        ]
      );

      console.log(`✅ Admin notification created for admin ${adminId}: ${title}`);
      return result.insertId;
    } catch (error) {
      console.error('❌ Error creating admin notification:', error);
      throw error;
    }
  }

  /**
   * Create notification when new incident is reported
   */
  static async createIncidentNotification(incidentData) {
    const {
      incident_id,
      incident_type,
      description,
      priority_level,
      latitude,
      longitude,
      reported_by,
      location
    } = incidentData;

    const severityMap = {
      'critical': 'critical',
      'high': 'high',
      'moderate': 'warning',
      'low': 'info'
    };

    const priorityEmoji = {
      'critical': '🚨',
      'high': '⚠️',
      'moderate': '⚡',
      'low': 'ℹ️'
    };

    return await this.createNotificationForAllAdmins({
      type: 'incident',
      title: `${priorityEmoji[priority_level] || '🚨'} New Incident: ${incident_type}`,
      message: description || `New ${incident_type} incident reported at ${location || 'unknown location'}`,
      severity: severityMap[priority_level] || 'warning',
      priority_level: priority_level || 'medium',
      related_type: 'incident',
      related_id: incident_id,
      action_url: `/admin/incidents/view`,
      metadata: {
        incident_id,
        incident_type,
        latitude,
        longitude,
        location,
        reported_by
      }
    });
  }

  /**
   * Create notification when welfare report is submitted
   */
  static async createWelfareNotification(welfareData) {
    const {
      report_id,
      user_id,
      first_name,
      last_name,
      status,
      additional_info,
      submitted_at
    } = welfareData;

    const userName = `${first_name || ''} ${last_name || ''}`.trim() || `User #${user_id}`;

    return await this.createNotificationForAllAdmins({
      type: 'welfare',
      title: `❤️ Welfare Check - ${status === 'needs_help' ? 'NEEDS HELP' : status.toUpperCase()}`,
      message: `${userName} reported ${status}. ${additional_info || 'Immediate attention may be required.'}`,
      severity: status === 'needs_help' ? 'critical' : 'warning',
      priority_level: status === 'needs_help' ? 'high' : 'medium',
      related_type: 'welfare',
      related_id: report_id,
      action_url: `/admin/welfare`,
      metadata: {
        report_id,
        user_id,
        user_name: userName,
        status,
        submitted_at
      }
    });
  }

  /**
   * Create notification when alert is issued
   */
  static async createAlertNotification(alertData) {
    const { id, title, description, alert_severity, alert_type } = alertData;

    const severityMap = {
      'emergency': 'critical',
      'warning': 'warning',
      'info': 'info'
    };

    const severityEmoji = {
      'emergency': '🚨',
      'warning': '⚠️',
      'info': 'ℹ️'
    };

    return await this.createNotificationForAllAdmins({
      type: 'alert',
      title: `${severityEmoji[alert_severity] || '🚨'} Alert Issued: ${title}`,
      message: description,
      severity: severityMap[alert_severity] || 'warning',
      priority_level: alert_severity === 'emergency' ? 'critical' : 'high',
      related_type: 'alert',
      related_id: id,
      action_url: `/admin/alerts`,
      metadata: {
        alert_id: id,
        alert_type,
        alert_severity
      }
    });
  }

  /**
   * Create notification when safety protocol is added/updated
   */
  static async createSafetyProtocolNotification(protocolData) {
    const { protocol_id, title, description, type } = protocolData;

    const typeEmoji = {
      'fire': '🔥',
      'earthquake': '🌍',
      'medical': '🏥',
      'intrusion': '🚨',
      'general': '🛡️'
    };

    return await this.createNotificationForAllAdmins({
      type: 'safety_protocol',
      title: `${typeEmoji[type] || '🛡️'} New Safety Protocol: ${title}`,
      message: description,
      severity: 'warning',
      priority_level: 'medium',
      related_type: 'protocol',
      related_id: protocol_id,
      action_url: `/admin/safety-protocols`,
      metadata: {
        protocol_id,
        protocol_type: type
      }
    });
  }

  /**
   * Create system notification
   */
  static async createSystemNotification(title, message, severity = 'info', priority = 'low') {
    return await this.createNotificationForAllAdmins({
      type: 'system',
      title: `🔧 ${title}`,
      message: message,
      severity: severity,
      priority_level: priority,
      related_type: null,
      related_id: null,
      action_url: null,
      metadata: null
    });
  }

  /**
   * Get notifications for admin (with pagination)
   */
  static async getAdminNotifications(adminId, options = {}) {
    const {
      page = 1,
      limit = 20,
      unreadOnly = false,
      type = null,
      severity = null
    } = options;

    // Validate adminId
    if (!adminId || adminId === null || adminId === undefined) {
      throw new Error('Admin ID is required');
    }

    const offset = (page - 1) * limit;
    let whereConditions = ['(admin_id = ? OR admin_id IS NULL)'];
    let params = [adminId];

    if (unreadOnly) {
      whereConditions.push('is_read = 0');
    }

    if (type) {
      whereConditions.push('type = ?');
      params.push(type);
    }

    if (severity) {
      whereConditions.push('severity = ?');
      params.push(severity);
    }

    const whereClause = whereConditions.join(' AND ');

    // Get notifications
    const [notifications] = await db.execute(
      `SELECT 
        id,
        admin_id,
        type,
        title,
        message,
        severity,
        priority_level,
        is_read,
        related_type,
        related_id,
        action_url,
        metadata,
        created_at,
        updated_at
      FROM admin_notifications
      WHERE ${whereClause}
      ORDER BY 
        CASE priority_level
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
        END,
        created_at DESC
      LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // Get total count
    const [countResult] = await db.execute(
      `SELECT COUNT(*) as total FROM admin_notifications WHERE ${whereClause}`,
      params
    );

    // Get unread count
    const [unreadResult] = await db.execute(
      `SELECT COUNT(*) as unread FROM admin_notifications 
       WHERE (admin_id = ? OR admin_id IS NULL) AND is_read = 0`,
      [adminId]
    );

    return {
      notifications: notifications.map(n => {
        let parsedMetadata = null;
        if (n.metadata) {
          try {
            // Handle both string and object metadata
            if (typeof n.metadata === 'string') {
              parsedMetadata = JSON.parse(n.metadata);
            } else if (typeof n.metadata === 'object') {
              parsedMetadata = n.metadata;
            }
          } catch (parseError) {
            console.warn('⚠️ Failed to parse notification metadata:', parseError);
            // If parsing fails, return null instead of crashing
            parsedMetadata = null;
          }
        }
        // Convert Date objects to ISO strings for proper timezone handling
        let created_at = null;
        if (n.created_at) {
          if (n.created_at instanceof Date) {
            created_at = n.created_at.toISOString();
          } else {
            const date = new Date(n.created_at);
            created_at = !isNaN(date.getTime()) ? date.toISOString() : null;
          }
        }
        
        let updated_at = null;
        if (n.updated_at) {
          if (n.updated_at instanceof Date) {
            updated_at = n.updated_at.toISOString();
          } else {
            const date = new Date(n.updated_at);
            updated_at = !isNaN(date.getTime()) ? date.toISOString() : null;
          }
        }

        return {
          ...n,
          created_at,
          updated_at,
          metadata: parsedMetadata
        };
      }),
      total: countResult[0]?.total || 0,
      unreadCount: unreadResult[0]?.unread || 0,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil((countResult[0]?.total || 0) / limit),
        totalItems: countResult[0]?.total || 0,
        itemsPerPage: limit
      }
    };
  }

  /**
   * Mark notification as read
   */
  static async markAsRead(notificationId, adminId) {
    const [result] = await db.execute(
      `UPDATE admin_notifications 
       SET is_read = 1 
       WHERE id = ? AND (admin_id = ? OR admin_id IS NULL)`,
      [notificationId, adminId]
    );

    return result.affectedRows > 0;
  }

  /**
   * Mark all notifications as read for admin
   */
  static async markAllAsRead(adminId) {
    const [result] = await db.execute(
      `UPDATE admin_notifications 
       SET is_read = 1 
       WHERE (admin_id = ? OR admin_id IS NULL) AND is_read = 0`,
      [adminId]
    );

    return result.affectedRows;
  }

  /**
   * Delete notification
   */
  static async deleteNotification(notificationId, adminId) {
    const [result] = await db.execute(
      `DELETE FROM admin_notifications 
       WHERE id = ? AND (admin_id = ? OR admin_id IS NULL)`,
      [notificationId, adminId]
    );

    return result.affectedRows > 0;
  }

  /**
   * Get unread count for admin
   */
  static async getUnreadCount(adminId) {
    const [result] = await db.execute(
      `SELECT COUNT(*) as count 
       FROM admin_notifications 
       WHERE (admin_id = ? OR admin_id IS NULL) AND is_read = 0`,
      [adminId]
    );

    return result[0].count;
  }

  /**
   * Get priority notifications (high and critical)
   */
  static async getPriorityNotifications(adminId) {
    const [notifications] = await db.execute(
      `SELECT COUNT(*) as count 
       FROM admin_notifications 
       WHERE (admin_id = ? OR admin_id IS NULL) 
       AND priority_level IN ('high', 'critical')
       AND is_read = 0`,
      [adminId]
    );

    return notifications[0].count;
  }
}

module.exports = AdminNotificationService;
