const express = require('express');
const router = express.Router();
const pool = require('../config/conn');
const { authenticateAdmin } = require('../middleware/authMiddleware');

// Protect all user management routes - admin only
router.use(authenticateAdmin);

// GET - Get all users with pagination and filtering
router.get('/', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      search = '', 
      status = 'all',
      barangay = 'all'
    } = req.query;
    
    console.log('Fetching users with filters:', { page, limit, search, status, barangay });
    
    let whereClause = 'WHERE 1=1';
    let queryParams = [];
    
    // Add search filter
    if (search) {
      whereClause += ' AND (CONCAT(first_name, " ", last_name) LIKE ? OR email LIKE ? OR user_type LIKE ?)';
      queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    // Add status filter
    if (status !== 'all') {
      if (status === 'active') {
        whereClause += ' AND status = 1';
      } else if (status === 'inactive') {
        whereClause += ' AND status = 0';
      }
    }

    // Add user type filter (using barangay param for user_type)
    if (barangay !== 'all') {
      whereClause += ' AND user_type = ?';
      queryParams.push(barangay);
    }
    
    // Get total count
    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM general_users ${whereClause}`,
      queryParams
    );
    const total = countResult[0].total;

    // Get paginated results
    const offset = (page - 1) * limit;
    const [users] = await pool.execute(`
      SELECT
        user_id,
        first_name,
        last_name,
        CONCAT(first_name, ' ', last_name) as name,
        email,
        user_type,
        profile_picture,
        phone,
        address,
        city,
        state,
        zip_code,
        status,
        created_at,
        updated_at
      FROM general_users
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `, [...queryParams, parseInt(limit), parseInt(offset)]);
    
    res.json({
      success: true,
      data: {
        users,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          total,
          hasNext: parseInt(page) < Math.ceil(total / limit),
          hasPrev: parseInt(page) > 1
        }
      }
    });
    
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users',
      error: error.message
    });
  }
});

// GET - Get user by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log('Fetching user with ID:', id);
    
    const [users] = await pool.execute(
      'SELECT user_id, CONCAT(first_name, " ", last_name) as name, email, user_type, status, created_at, updated_at FROM general_users WHERE user_id = ?',
      [id]
    );
    
    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    res.json({
      success: true,
      user: users[0]
    });
    
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user',
      error: error.message
    });
  }
});

// PUT - Update user status
router.put('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    console.log('Updating user status:', { id, status });
    
    // Validate status value (allow 0, 1, 2, and -1)
    // status = 0: UNVERIFIED (cannot be set by admin - only by system)
    // status = 1: ACTIVE
    // status = 2: INACTIVE (admin deactivated verified user)
    // status = -1: SUSPENDED
    const statusValue = parseInt(status);
    if (statusValue !== 0 && statusValue !== 1 && statusValue !== 2 && statusValue !== -1) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status value. Must be 1 (active), 2 (inactive), or -1 (suspended). Status 0 (unverified) cannot be set manually.'
      });
    }
    
    // Prevent admin from setting status to 0 (unverified) - this is only for new registrations
    if (statusValue === 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot set status to UNVERIFIED. This status is only for users who have not verified their email. Use INACTIVE (2) to deactivate a verified user.'
      });
    }
    
    // Check if user exists and get current status and name
    const [existingUsers] = await pool.execute(
      'SELECT user_id, first_name, last_name, status FROM general_users WHERE user_id = ?',
      [id]
    );

    if (existingUsers.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = existingUsers[0];
    const oldStatus = user.status;
    const userName = `${user.first_name} ${user.last_name}`;

    // Function to get status text
    const getStatusText = (status) => {
      if (status === 1) return 'ACTIVE';
      if (status === 0) return 'UNVERIFIED';
      if (status === 2) return 'INACTIVE';
      if (status === -1) return 'SUSPENDED';
      return 'UNKNOWN';
    };

    // Update user status
    await pool.execute(
      'UPDATE general_users SET status = ? WHERE user_id = ?',
      [statusValue, id]
    );

    // Log the status change with detailed information
    const { created_by } = req.body;
    const finalCreatedBy = created_by !== null && created_by !== undefined
      ? created_by
      : (req.admin?.admin_id || null);

    console.log('Final created_by value to be inserted:', finalCreatedBy);

    const oldStatusText = getStatusText(oldStatus);
    const newStatusText = getStatusText(statusValue);

    await pool.execute(`
      INSERT INTO activity_logs (admin_id, action, details, created_at)
      VALUES (?, 'user_status_update', ?, NOW())
    `, [finalCreatedBy, `Updated user(${userName}) ${id} ${oldStatusText} status to ${newStatusText}`]);
    
    res.json({
      success: true,
      message: 'User status updated successfully'
    });
    
  } catch (error) {
    console.error('Error updating user status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user status',
      error: error.message
    });
  }
});

// PUT - Update user information
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { first_name, last_name, email, user_type } = req.body;
    
    console.log('Updating user information:', { id, first_name, last_name, email });
    
    if (!first_name || !last_name || !email) {
      return res.status(400).json({
        success: false,
        message: 'First name, last name, and email are required'
      });
    }
    
    // Check if user exists
    const [existingUsers] = await pool.execute(
      'SELECT user_id FROM general_users WHERE user_id = ?',
      [id]
    );
    
    if (existingUsers.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Check if email is already taken by another user
    const [emailCheck] = await pool.execute(
      'SELECT user_id FROM general_users WHERE email = ? AND user_id != ?',
      [email, id]
    );
    
    if (emailCheck.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Email is already taken by another user'
      });
    }
    
    // Update user information
    await pool.execute(`
      UPDATE general_users 
      SET 
        first_name = ?,
        last_name = ?,
        email = ?,
        user_type = 'CITIZEN'
      WHERE user_id = ?
    `, [first_name, last_name, email, id]);
    
    // Log the update
    const { created_by } = req.body;
    const finalCreatedBy = created_by !== null && created_by !== undefined
      ? created_by
      : (req.admin?.admin_id || null);

    console.log('Final created_by value to be inserted:', finalCreatedBy);

    await pool.execute(`
      INSERT INTO activity_logs (admin_id, action, details, created_at)
      VALUES (?, 'user_info_update', ?, NOW())
    `, [finalCreatedBy, `Updated user ${id} information`]);
    
    res.json({
      success: true,
      message: 'User information updated successfully'
    });
    
  } catch (error) {
    console.error('Error updating user information:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user information',
      error: error.message
    });
  }
});

// DELETE - Delete user (hard delete from database)
router.delete('/:id', async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const { id } = req.params;
    console.log('Deleting user:', id);
    
    // Check if user exists
    const [existingUsers] = await connection.execute(
      'SELECT user_id, CONCAT(first_name, " ", last_name) as name FROM general_users WHERE user_id = ?',
      [id]
    );
    
    if (existingUsers.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    const user = existingUsers[0];
    
    // Get admin_id for logging
    const { created_by } = req.body;
    const finalCreatedBy = created_by !== null && created_by !== undefined
      ? created_by
      : (req.admin?.admin_id || null);

    console.log('Final created_by value to be inserted:', finalCreatedBy);

    // Log the deletion BEFORE deleting (so we have the user info)
    await connection.execute(`
      INSERT INTO activity_logs (admin_id, action, details, created_at)
      VALUES (?, 'user_delete', ?, NOW())
    `, [finalCreatedBy, `Deleted user ${id} (${user.name})`]);
    
    // Hard delete - actually DELETE from database
    // Note: Foreign key constraint will CASCADE delete related incident_reports
    await connection.execute(
      'DELETE FROM general_users WHERE user_id = ?',
      [id]
    );
    
    await connection.commit();
    
    res.json({
      success: true,
      message: 'User deleted successfully from database'
    });
    
  } catch (error) {
    await connection.rollback();
    console.error('Error deleting user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete user',
      error: error.message
    });
  } finally {
    connection.release();
  }
});

// GET - Get user statistics
router.get('/stats/overview', async (req, res) => {
  try {
    console.log('Fetching user statistics...');
    
    // Get total users count
    const [totalResult] = await pool.execute(
      'SELECT COUNT(*) as total FROM general_users'
    );
    
    // Get active users count
    const [activeResult] = await pool.execute(
      'SELECT COUNT(*) as active FROM general_users WHERE status = 1'
    );
    
    // Get inactive users count
    const [inactiveResult] = await pool.execute(
      'SELECT COUNT(*) as inactive FROM general_users WHERE status = 0'
    );
    
    // Get users by type
    const [userTypeStats] = await pool.execute(`
      SELECT user_type, COUNT(*) as count 
      FROM general_users 
      GROUP BY user_type 
      ORDER BY count DESC
    `);
    
    // Get recent registrations (last 30 days)
    const [recentRegistrations] = await pool.execute(`
      SELECT COUNT(*) as recent 
      FROM users 
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) 
      AND status != "deleted"
    `);
    
    // Get user type distribution
    const [userTypeDistribution] = await pool.execute(`
      SELECT user_type, COUNT(*) as count 
      FROM general_users 
      GROUP BY user_type
    `);

    res.json({
      success: true,
      stats: {
        total: totalResult[0].total,
        active: activeResult[0].active,
        inactive: inactiveResult[0].inactive,
        recentRegistrations: recentRegistrations[0].recent,
        userTypeDistribution
      }
    });
    
  } catch (error) {
    console.error('Error fetching user statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user statistics',
      error: error.message
    });
  }
});

// GET - Export users data
router.get('/export/csv', async (req, res) => {
  try {
    console.log('Exporting users data...');
    
    const [users] = await pool.execute(`
      SELECT 
        user_id as id,
        CONCAT(first_name, ' ', last_name) as name,
        email,
        user_type,
        department,
        college,
        status,
        created_at,
        updated_at as last_login
      FROM general_users 
      WHERE status != 0
      ORDER BY created_at DESC
    `);
    
    // Convert to CSV format
    const csvHeader = 'ID,Name,Email,Phone,Barangay,Status,Registration Date,Last Login\n';
    const csvData = users.map(user => {
      return [
        user.id,
        `"${user.name}"`,
        user.email,
        user.phone || '',
        `"${user.barangay || ''}"`,
        user.status,
        user.created_at ? new Date(user.created_at).toISOString().split('T')[0] : '',
        user.last_login ? new Date(user.last_login).toISOString().split('T')[0] : 'Never'
      ].join(',');
    }).join('\n');
    
    const csv = csvHeader + csvData;
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=users_export.csv');
    res.send(csv);
    
  } catch (error) {
    console.error('Error exporting users data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export users data',
      error: error.message
    });
  }
});

module.exports = router;
