const express = require('express');
const router = express.Router();
const db = require('../config/conn');
const { authenticateAny } = require('../middleware/authMiddleware');
const NotificationService = require('../services/notificationService');

// Get notifications for authenticated user
router.get('/', authenticateAny, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const userId = req.user.user_id || req.user.id;
    const dateFilter = req.query.date; // Optional date parameter (YYYY-MM-DD format)

    // Try to get notifications, if table doesn't exist, return empty
    try {
      // First check if notifications table exists
      const [tableCheck] = await db.execute(
        "SELECT 1 FROM notifications LIMIT 1"
      );
      
      // Get user's account creation date from general_users table
      let userCreatedAt = null;
      try {
        const [userResult] = await db.execute(
          'SELECT created_at FROM general_users WHERE user_id = ?',
          [userId]
        );
        
        if (userResult.length > 0) {
          userCreatedAt = userResult[0].created_at;
        }
      } catch (userError) {
        console.error('Error fetching user created_at:', userError);
        // Continue without user date filter if table doesn't exist
      }
      
      // Build WHERE clause with user creation date filter and optional date filter
      let whereClause = '(n.user_id = ? OR n.user_id IS NULL)';
      const queryParams = [userId];
      
      // Filter notifications to only show those created on or after user's account creation date
      if (userCreatedAt) {
        whereClause += ' AND n.created_at >= ?';
        queryParams.push(userCreatedAt);
      }
      
      if (dateFilter) {
        // Validate date format (YYYY-MM-DD)
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (dateRegex.test(dateFilter)) {
          whereClause += ' AND DATE(n.created_at) = ?';
          queryParams.push(dateFilter);
        } else {
          return res.status(400).json({
            success: false,
            message: 'Invalid date format. Please use YYYY-MM-DD format.'
          });
        }
      }
      
      // Get notifications for the user
      // Convert timezone from UTC to Asia/Manila (UTC+8) for display
      // Using DATE_ADD as fallback if CONVERT_TZ timezone tables are not loaded
      const [notifications] = await db.execute(
        `SELECT n.*, n.title, n.message,
         DATE_FORMAT(DATE_ADD(n.created_at, INTERVAL 8 HOUR), '%Y-%m-%d %H:%i:%s') as created_at,
         DATE_FORMAT(DATE_ADD(n.updated_at, INTERVAL 8 HOUR), '%Y-%m-%d %H:%i:%s') as updated_at
         FROM notifications n
         WHERE ${whereClause}
         ORDER BY n.created_at DESC
         LIMIT ? OFFSET ?`,
        [...queryParams, limit, offset]
      );

      // Get total count
      let countWhereClause = '(user_id = ? OR user_id IS NULL)';
      const countParams = [userId];
      
      if (userCreatedAt) {
        countWhereClause += ' AND created_at >= ?';
        countParams.push(userCreatedAt);
      }
      
      if (dateFilter && /^\d{4}-\d{2}-\d{2}$/.test(dateFilter)) {
        countWhereClause += ' AND DATE(created_at) = ?';
        countParams.push(dateFilter);
      }
      
      const [countResult] = await db.execute(
        `SELECT COUNT(*) as total FROM notifications WHERE ${countWhereClause}`,
        countParams
      );

      // Get unread count
      let unreadWhereClause = '(user_id = ? OR user_id IS NULL) AND is_read = 0';
      const unreadParams = [userId];
      
      if (userCreatedAt) {
        unreadWhereClause += ' AND created_at >= ?';
        unreadParams.push(userCreatedAt);
      }
      
      if (dateFilter && /^\d{4}-\d{2}-\d{2}$/.test(dateFilter)) {
        unreadWhereClause += ' AND DATE(created_at) = ?';
        unreadParams.push(dateFilter);
      }
      
      const [unreadResult] = await db.execute(
        `SELECT COUNT(*) as unread FROM notifications WHERE ${unreadWhereClause}`,
        unreadParams
      );

      res.json({
        success: true,
        notifications,
        total: countResult[0].total,
        unreadCount: unreadResult[0].unread,
        dateFilter: dateFilter || null,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(countResult[0].total / limit),
          totalItems: countResult[0].total,
          itemsPerPage: limit
        }
      });
    } catch (tableError) {
      if (tableError.code === 'ER_NO_SUCH_TABLE') {
        // Table doesn't exist yet, return empty results
        res.json({
          success: true,
          notifications: [],
          total: 0,
          unreadCount: 0,
          pagination: {
            currentPage: page,
            totalPages: 0,
            totalItems: 0,
            itemsPerPage: limit
          }
        });
      } else {
        throw tableError;
      }
    }

  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications',
      error: error.message
    });
  }
});

// Mark notification as read
router.put('/:id/read', authenticateAny, async (req, res) => {
  try {
    const notificationId = req.params.id;
    const userId = req.user.user_id || req.user.id;

    try {
      const [result] = await db.execute(
        'UPDATE notifications SET is_read = 1 WHERE id = ? AND (user_id = ? OR user_id IS NULL)',
        [notificationId, userId]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: 'Notification not found'
        });
      }

      res.json({
        success: true,
        message: 'Notification marked as read'
      });
    } catch (tableError) {
      if (tableError.code === 'ER_NO_SUCH_TABLE') {
        // Table doesn't exist yet, return success
        res.json({
          success: true,
          message: 'Notification marked as read'
        });
      } else {
        throw tableError;
      }
    }

  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read',
      error: error.message
    });
  }
});

// Mark all notifications as read
router.put('/read-all', authenticateAny, async (req, res) => {
  try {
    const userId = req.user.user_id || req.user.id;

    try {
      await db.execute(
        'UPDATE notifications SET is_read = 1 WHERE user_id = ? OR user_id IS NULL',
        [userId]
      );

      res.json({
        success: true,
        message: 'All notifications marked as read'
      });
    } catch (tableError) {
      if (tableError.code === 'ER_NO_SUCH_TABLE') {
        // Table doesn't exist yet, return success
        res.json({
          success: true,
          message: 'All notifications marked as read'
        });
      } else {
        throw tableError;
      }
    }

  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark all notifications as read',
      error: error.message
    });
  }
});

// Delete notification
router.delete('/:id', authenticateAny, async (req, res) => {
  try {
    const notificationId = req.params.id;
    const userId = req.user.user_id || req.user.id;

    try {
      const [result] = await db.execute(
        'DELETE FROM notifications WHERE id = ? AND (user_id = ? OR user_id IS NULL)',
        [notificationId, userId]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: 'Notification not found'
        });
      }

      res.json({
        success: true,
        message: 'Notification deleted'
      });
    } catch (tableError) {
      if (tableError.code === 'ER_NO_SUCH_TABLE') {
        // Table doesn't exist yet, return success
        res.json({
          success: true,
          message: 'Notification deleted'
        });
      } else {
        throw tableError;
      }
    }

  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete notification',
      error: error.message
    });
  }
});

// Get notification settings
router.get('/settings', authenticateAny, async (req, res) => {
  try {
    const userId = req.user.user_id || req.user.id;

    try {
      // Get user's notification settings
      const [settings] = await db.execute(
        'SELECT * FROM notification_settings WHERE user_id = ?',
        [userId]
      );

      if (settings.length === 0) {
        // Return default settings
        res.json({
          success: true,
          settings: {
            enableAlerts: true,
            enableSafetyProtocols: true,
            enableWelfare: true,
            enableSystem: true
          }
        });
      } else {
        res.json({
          success: true,
          settings: settings[0]
        });
      }
    } catch (tableError) {
      if (tableError.code === 'ER_NO_SUCH_TABLE') {
        // Table doesn't exist yet, return default settings
        res.json({
          success: true,
          settings: {
            enableAlerts: true,
            enableSafetyProtocols: true,
            enableWelfare: true,
            enableSystem: true
          }
        });
      } else {
        throw tableError;
      }
    }

  } catch (error) {
    console.error('Error fetching notification settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notification settings',
      error: error.message
    });
  }
});

// Update notification settings
router.put('/settings', authenticateAny, async (req, res) => {
  try {
    const userId = req.user.user_id || req.user.id;
    const { enableAlerts, enableSafetyProtocols, enableWelfare, enableSystem } = req.body;

    try {
      // Check if settings exist
      const [existingSettings] = await db.execute(
        'SELECT id FROM notification_settings WHERE user_id = ?',
        [userId]
      );

      if (existingSettings.length > 0) {
        // Update existing settings
        await db.execute(
          'UPDATE notification_settings SET enable_alerts = ?, enable_safety_protocols = ?, enable_welfare = ?, enable_system = ? WHERE user_id = ?',
          [enableAlerts, enableSafetyProtocols, enableWelfare, enableSystem, userId]
        );
      } else {
        // Create new settings
        await db.execute(
          'INSERT INTO notification_settings (user_id, enable_alerts, enable_safety_protocols, enable_welfare, enable_system) VALUES (?, ?, ?, ?, ?)',
          [userId, enableAlerts, enableSafetyProtocols, enableWelfare, enableSystem]
        );
      }

      res.json({
        success: true,
        message: 'Notification settings updated successfully'
      });
    } catch (tableError) {
      if (tableError.code === 'ER_NO_SUCH_TABLE') {
        // Table doesn't exist yet, return success
        res.json({
          success: true,
          message: 'Notification settings updated successfully'
        });
      } else {
        throw tableError;
      }
    }

  } catch (error) {
    console.error('Error updating notification settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update notification settings',
      error: error.message
    });
  }
});

// Create notification for incident report validation
router.post('/incident-validation', authenticateAny, async (req, res) => {
  try {
    const { incidentData, validationStatus, userId } = req.body;

    if (!incidentData || !validationStatus || !userId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: incidentData, validationStatus, userId'
      });
    }

    if (!['validated', 'rejected'].includes(validationStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid validation status. Must be "validated" or "rejected"'
      });
    }

    try {
      const notificationId = await NotificationService.createIncidentValidationNotification(
        incidentData,
        validationStatus,
        userId
      );

      res.json({
        success: true,
        message: 'Notification created successfully',
        notificationId: notificationId
      });
    } catch (tableError) {
      if (tableError.code === 'ER_NO_SUCH_TABLE') {
        // Table doesn't exist yet, create it and try again
        await NotificationService.createNotificationsTable();
        
        const notificationId = await NotificationService.createIncidentValidationNotification(
          incidentData,
          validationStatus,
          userId
        );

        res.json({
          success: true,
          message: 'Notification created successfully',
          notificationId: notificationId
        });
      } else {
        throw tableError;
      }
    }

  } catch (error) {
    console.error('Error creating incident validation notification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create notification',
      error: error.message
    });
  }
});

module.exports = router;
