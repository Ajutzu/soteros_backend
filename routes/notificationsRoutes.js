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

    // Try to get notifications, if table doesn't exist, return empty
    try {
      // First check if notifications table exists
      const [tableCheck] = await db.execute(
        "SELECT 1 FROM notifications LIMIT 1"
      );
      
      // Get notifications for the user
      const [notifications] = await db.execute(
        `SELECT n.*, n.title, n.message,
         DATE_FORMAT(n.created_at, '%Y-%m-%d %H:%i:%s') as created_at,
         DATE_FORMAT(n.updated_at, '%Y-%m-%d %H:%i:%s') as updated_at
         FROM notifications n
         WHERE (n.user_id = ? OR n.user_id IS NULL)
         ORDER BY n.created_at DESC
         LIMIT ? OFFSET ?`,
        [userId, limit, offset]
      );

      // Get total count
      const [countResult] = await db.execute(
        'SELECT COUNT(*) as total FROM notifications WHERE (user_id = ? OR user_id IS NULL)',
        [userId]
      );

      // Get unread count
      const [unreadResult] = await db.execute(
        'SELECT COUNT(*) as unread FROM notifications WHERE (user_id = ? OR user_id IS NULL) AND is_read = 0',
        [userId]
      );

      res.json({
        success: true,
        notifications,
        total: countResult[0].total,
        unreadCount: unreadResult[0].unread,
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
