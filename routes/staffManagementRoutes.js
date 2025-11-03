const express = require('express');
const router = express.Router();
const pool = require('../config/conn');
const bcrypt = require('bcryptjs');
const { sendStaffAccountCreationEmail } = require('../services/emailService');
const { authenticateAdmin, authenticateStaff, authenticateAny } = require('../middleware/authMiddleware');
const { uploadProfile } = require('../config/cloudinary');

// GET - Get all staff members (admin and staff can access, but staff only see active members)
router.get('/', authenticateAny, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      search = '', 
      status = 'all',
      availability = 'all',
      department = 'all',
      team_id = 'all'
    } = req.query;
    
    console.log('Fetching staff with filters:', { page, limit, search, status, availability, department, team_id, userType: req.userType });
    
    // Staff users can only see active staff members
    const isStaff = req.userType === 'staff';
    let whereClause = 'WHERE 1=1'; // Start with flexible where clause
    let queryParams = [];
    
    // Staff always sees active members only, admin can filter
    if (isStaff) {
      whereClause += ' AND s.status = 1';
    } else if (status !== 'all') {
      // Admin filtering by specific status
      const statusValue = status === 'active' ? 1 : 0;
      whereClause += ' AND s.status = ?';
      queryParams.push(statusValue);
    }
    
    // Add search filter
    if (search) {
      whereClause += ' AND (s.name LIKE ? OR s.email LIKE ? OR s.position LIKE ? OR s.department LIKE ?)';
      queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    // Add availability filter
    if (availability !== 'all') {
      whereClause += ' AND s.availability = ?';
      queryParams.push(availability);
    }

    // Add department filter
    if (department !== 'all') {
      whereClause += ' AND s.department = ?';
      queryParams.push(department);
    }

    // Add team filter
    if (team_id !== 'all') {
      whereClause += ' AND s.assigned_team_id = ?';
      queryParams.push(team_id);
    }
    
    // Get total count
    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM staff s ${whereClause}`,
      queryParams
    );
    const total = countResult[0].total;
    
    // Get paginated results
    const offset = (page - 1) * limit;
    const [staff] = await pool.execute(`
      SELECT s.id, s.name, s.email, s.phone, s.position, s.department, s.status, s.availability,
             s.last_login, s.created_at, s.updated_at, t.id as team_id, t.name as team_name, t.member_no as team_member_no
      FROM staff s
      LEFT JOIN teams t ON s.assigned_team_id = t.id
      ${whereClause}
      ORDER BY s.created_at DESC
      LIMIT ? OFFSET ?
    `, [...queryParams, parseInt(limit), parseInt(offset)]);
    
    // Map status values to strings and keep availability as is
    const mappedStaff = staff.map(member => ({
      ...member,
      status: member.status === 1 ? 'active' : 'inactive',
      availability: member.availability || 'available'
    }));
    
    res.json({
      success: true,
      data: {
        users: mappedStaff,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          total,
          hasNext: parseInt(page) < Math.ceil(total / limit),
          hasPrev: parseInt(page) > 1
        }
      },
      // Also include legacy format for backward compatibility
      staff: mappedStaff,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
    
  } catch (error) {
    console.error('Error fetching staff:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch staff',
      error: error.message
    });
  }
});

// GET - Get staff member by ID
// Allow staff to access their own profile, or admin to access any staff profile
router.get('/:id', authenticateAny, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('Fetching staff member with ID:', id, 'User type:', req.userType, 'User ID:', req.user?.id || req.user?.admin_id || req.user?.staff_id);
    
    // Authorization check: Staff can only access their own profile, admin can access any
    const isAdmin = req.userType === 'admin';
    const isStaff = req.userType === 'staff';
    // For staff, the id field should match the staff member's id
    const isAccessingSelf = isStaff && parseInt(req.user.id) === parseInt(id);
    
    if (!isAdmin && !isAccessingSelf) {
      return res.status(403).json({
        success: false,
        message: 'You can only access your own profile'
      });
    }
    
    const [staff] = await pool.execute(
      `SELECT s.id, s.name, s.email, s.phone, s.position, s.department, s.status, s.availability,
              s.last_login, s.created_at, s.updated_at, s.profile_picture, t.id as team_id, t.name as team_name
       FROM staff s
       LEFT JOIN teams t ON s.assigned_team_id = t.id
       WHERE s.id = ?`,
      [id]
    );
    
    if (staff.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Staff member not found'
      });
    }
    
    res.json({
      success: true,
      staff: staff[0]
    });
    
  } catch (error) {
    console.error('Error fetching staff member:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch staff member',
      error: error.message
    });
  }
});

// POST - Create new staff member
router.post('/', authenticateAdmin, async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      position,
      department,
      team_id,
      password = 'defaultpass123' // Default password, should be changed on first login
    } = req.body;
    
    console.log('Creating new staff member:', { name, email, position, department });
    
    if (!name || !email || !position || !department) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, position, and department are required'
      });
    }
    
    // Check if email already exists
    const [existingStaff] = await pool.execute(
      'SELECT id FROM staff WHERE email = ?',
      [email]
    );
    
    if (existingStaff.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Email is already registered'
      });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Insert new staff member
    const [result] = await pool.execute(`
      INSERT INTO staff (name, email, phone, position, department, assigned_team_id, password, status, availability, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'available', NOW(), NOW())
    `, [name, email, phone, position, department, team_id || null, hashedPassword]);
    
    const staffId = result.insertId;
    
    // Log the creation (optional - don't fail if logging fails)
    try {
      const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip || 'unknown';
      await pool.execute(`
        INSERT INTO activity_logs (admin_id, action, details, ip_address, created_at)
        VALUES (?, 'staff_create', ?, ?, NOW())
      `, [req.user?.id || 1, `Created new staff member: ${name} (${email})`, clientIP]);
      console.log('✅ Activity logged: staff_create');
    } catch (logError) {
      console.error('❌ Failed to log staff creation activity:', logError.message);
      // Don't fail the main operation if logging fails
    }

    // Send account creation email (optional - don't fail if email fails)
    try {
      const staffData = {
        name,
        email,
        position,
        department
      };
      await sendStaffAccountCreationEmail(staffData, password);
      console.log('✅ Account creation email sent to:', email);
    } catch (emailError) {
      console.error('❌ Failed to send account creation email:', emailError.message);
      // Don't fail the main operation if email fails
    }

    res.status(201).json({
      success: true,
      message: 'Staff member created successfully',
      staffId
    });
    
  } catch (error) {
    console.error('Error creating staff member:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create staff member',
      error: error.message
    });
  }
});

// PUT - Update staff member
// Allow staff to update their own profile, or admin to update any staff
router.put('/:id', authenticateAny, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, phone, position, department, team_id } = req.body;
    
    console.log('Updating staff member:', { id, name, email, team_id, userType: req.userType, userId: req.user?.id || req.user?.admin_id || req.user?.staff_id });
    console.log('Request body:', req.body);
    
    // Check if staff member exists first
    const [existingStaff] = await pool.execute(
      'SELECT * FROM staff WHERE id = ?',
      [id]
    );
    
    if (existingStaff.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Staff member not found'
      });
    }
    
    const currentStaff = existingStaff[0];
    
    // Authorization check: Staff can only update their own profile, admin can update any
    const isAdmin = req.userType === 'admin';
    const isStaff = req.userType === 'staff';
    // For staff, the id field should match the staff member's id
    const isUpdatingSelf = isStaff && parseInt(req.user.id) === parseInt(id);
    
    if (!isAdmin && !isUpdatingSelf) {
      return res.status(403).json({
        success: false,
        message: 'You can only update your own profile'
      });
    }
    
    // Staff cannot update team_id, only admin can
    if (!isAdmin && team_id !== undefined) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update team assignment'
      });
    }
    
    // Use provided values or fall back to existing values
    const updateData = {
      name: name || currentStaff.name,
      email: email || currentStaff.email,
      phone: phone !== undefined ? phone : currentStaff.phone,
      position: position || currentStaff.position,
      department: department || currentStaff.department,
      team_id: team_id !== undefined ? team_id : currentStaff.assigned_team_id
    };
    
    // Validate required fields
    if (!updateData.name || !updateData.email || !updateData.position || !updateData.department) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, position, and department are required'
      });
    }
    
    // Check if email is already taken by another staff member (only if email is being changed)
    if (email && email !== currentStaff.email) {
      const [emailCheck] = await pool.execute(
        'SELECT id FROM staff WHERE email = ? AND id != ?',
        [email, id]
      );
      
      if (emailCheck.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Email is already taken by another staff member'
        });
      }
    }
    
    // Update staff member
    console.log('Executing UPDATE query with params:', [updateData.name, updateData.email, updateData.phone, updateData.position, updateData.department, updateData.team_id || null, id]);
    
    const [updateResult] = await pool.execute(`
      UPDATE staff 
      SET name = ?, email = ?, phone = ?, position = ?, department = ?, assigned_team_id = ?, updated_at = NOW()
      WHERE id = ?
    `, [updateData.name, updateData.email, updateData.phone, updateData.position, updateData.department, updateData.team_id || null, id]);
    
    console.log('Update result:', updateResult);
    
    // Log the update (optional - don't fail if logging fails)
    try {
      const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip || 'unknown';
      if (isAdmin) {
        await pool.execute(`
          INSERT INTO activity_logs (admin_id, action, details, ip_address, created_at)
          VALUES (?, 'staff_update', ?, ?, NOW())
        `, [req.user.admin_id || req.user.id, `Updated staff member ${currentStaff.name} information`, clientIP]);
      } else {
        await pool.execute(`
          INSERT INTO activity_logs (staff_id, action, details, ip_address, created_at)
          VALUES (?, 'staff_update', ?, ?, NOW())
        `, [id, `Updated own profile information`, clientIP]);
      }
      console.log('✅ Activity logged: staff_update');
    } catch (logError) {
      console.error('❌ Failed to log staff update activity:', logError.message);
      // Don't fail the main operation if logging fails
    }
    
    res.json({
      success: true,
      message: 'Staff member updated successfully'
    });
    
  } catch (error) {
    console.error('Error updating staff member:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update staff member',
      error: error.message
    });
  }
});

// PUT - Update staff status
router.put('/:id/status', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    console.log('Updating staff status:', { id, status });
    
    if (!status || !['active', 'inactive'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Valid status is required (active, inactive)'
      });
    }
    
    // Check if staff member exists
    const [existingStaff] = await pool.execute(
      'SELECT id FROM staff WHERE id = ?',
      [id]
    );
    
    if (existingStaff.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Staff member not found'
      });
    }
    
    // Map status to database values
    const statusValue = status === 'active' ? 1 : 0;
    
    // Update staff status
    await pool.execute(
      'UPDATE staff SET status = ?, updated_at = NOW() WHERE id = ?',
      [statusValue, id]
    );
    
    // Log the status change
    await pool.execute(`
      INSERT INTO activity_logs (admin_id, action, details, created_at)
      VALUES (?, 'staff_status_update', ?, NOW())
    `, [req.user?.id || 1, `Updated staff ${id} status to ${status}`]);
    
    res.json({
      success: true,
      message: 'Staff status updated successfully'
    });
    
  } catch (error) {
    console.error('Error updating staff status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update staff status',
      error: error.message
    });
  }
});

// PUT - Update staff availability
// Allow staff to update their own availability, or admin to update any staff
router.put('/:id/availability', authenticateAny, async (req, res) => {
  try {
    const { id } = req.params;
    const { availability } = req.body;
    
    console.log('Updating staff availability:', { id, availability, userType: req.userType, userId: req.user?.id || req.user?.admin_id || req.user?.staff_id });
    
    if (!availability || !['available', 'busy', 'off-duty'].includes(availability)) {
      return res.status(400).json({
        success: false,
        message: 'Valid availability is required (available, busy, off-duty)'
      });
    }

    // Check if staff member exists
    const [existingStaff] = await pool.execute(
      'SELECT id, name FROM staff WHERE id = ?',
      [id]
    );
    
    if (existingStaff.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Staff member not found'
      });
    }
    
    // Authorization check: Staff can only update their own availability, admin can update any
    const isAdmin = req.userType === 'admin';
    const isStaff = req.userType === 'staff';
    // For staff, the id field should match the staff member's id
    const isUpdatingSelf = isStaff && parseInt(req.user.id) === parseInt(id);
    
    if (!isAdmin && !isUpdatingSelf) {
      return res.status(403).json({
        success: false,
        message: 'You can only update your own availability'
      });
    }
    
    // Update staff availability
    await pool.execute(
      'UPDATE staff SET availability = ?, updated_at = NOW() WHERE id = ?',
      [availability, id]
    );
    
    // Log the availability change with correct user type
    if (isAdmin) {
      await pool.execute(`
        INSERT INTO activity_logs (admin_id, action, details, created_at)
        VALUES (?, 'staff_availability_update', ?, NOW())
      `, [req.user.admin_id || req.user.id, `Updated staff ${existingStaff[0].name} availability to ${availability}`]);
    } else {
      await pool.execute(`
        INSERT INTO activity_logs (staff_id, action, details, created_at)
        VALUES (?, 'staff_availability_update', ?, NOW())
      `, [id, `Updated own availability to ${availability}`]);
    }
    
    res.json({
      success: true,
      message: 'Staff availability updated successfully'
    });
    
  } catch (error) {
    console.error('Error updating staff availability:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update staff availability',
      error: error.message
    });
  }
});

// DELETE - Delete staff member (soft delete)
router.delete('/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('Deleting staff member:', id);
    
    // Check if staff member exists
    const [existingStaff] = await pool.execute(
      'SELECT staff_id, name FROM staff WHERE staff_id = ?',
      [id]
    );
    
    if (existingStaff.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Staff member not found'
      });
    }
    
    const staff = existingStaff[0];
    
    // Soft delete - update status to deleted
    await pool.execute(
      'UPDATE staff SET status = "deleted", updated_at = NOW() WHERE staff_id = ?',
      [id]
    );
    
    // Log the deletion
    await pool.execute(`
      INSERT INTO activity_logs (admin_id, action, details, created_at)
      VALUES (?, 'staff_delete', ?, NOW())
    `, [req.user?.id || 1, `Deleted staff member ${id} (${staff.name})`]);
    
    res.json({
      success: true,
      message: 'Staff member deleted successfully'
    });
    
  } catch (error) {
    console.error('Error deleting staff member:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete staff member',
      error: error.message
    });
  }
});

// GET - Get staff statistics
router.get('/stats/overview', authenticateAdmin, async (req, res) => {
  try {
    console.log('Fetching staff statistics...');
    
    // Get total staff count
    const [totalResult] = await pool.execute(
      'SELECT COUNT(*) as total FROM staff WHERE status != "deleted"'
    );
    
    // Get active staff count
    const [activeResult] = await pool.execute(
      'SELECT COUNT(*) as active FROM staff WHERE status = 1'
    );
    
    // Get inactive staff count
    const [inactiveResult] = await pool.execute(
      'SELECT COUNT(*) as inactive FROM staff WHERE status = 0'
    );
    
    // Get available staff count
    const [availableResult] = await pool.execute(
      'SELECT COUNT(*) as available FROM staff WHERE availability = "available"'
    );
    
    // Get busy staff count
    const [busyResult] = await pool.execute(
      'SELECT COUNT(*) as busy FROM staff WHERE availability = "busy"'
    );
    
    // Get off-duty staff count
    const [offDutyResult] = await pool.execute(
      'SELECT COUNT(*) as off_duty FROM staff WHERE availability = "off-duty"'
    );
    
    // Get staff by department
    const [departmentStats] = await pool.execute(`
      SELECT department, COUNT(*) as count 
      FROM staff 
      WHERE status != "deleted" 
      GROUP BY department 
      ORDER BY count DESC
    `);
    
    res.json({
      success: true,
      stats: {
        total: totalResult[0].total,
        active: activeResult[0].active,
        inactive: inactiveResult[0].inactive,
        available: availableResult[0].available,
        busy: busyResult[0].busy,
        offDuty: offDutyResult[0].off_duty,
        departmentDistribution: departmentStats
      }
    });
    
  } catch (error) {
    console.error('Error fetching staff statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch staff statistics',
      error: error.message
    });
  }
});

// POST - Upload staff profile picture (Using Cloudinary)
// Allow staff to upload their own picture, or admin to upload for any staff
router.post('/:id/upload-picture', authenticateAny, uploadProfile.single('profilePicture'), async (req, res) => {
  try {
    const { id } = req.params;
    const staffId = parseInt(id);

    console.log('📤 Staff profile picture upload request received');
    console.log('Staff ID:', staffId);
    console.log('File received:', req.file ? 'Yes' : 'No');

    // Authorization check: Staff can only upload their own picture, admin can upload for any staff
    const isAdmin = req.userType === 'admin';
    const isStaff = req.userType === 'staff';
    const isUpdatingSelf = isStaff && parseInt(req.user.id) === parseInt(id);

    if (!isAdmin && !isUpdatingSelf) {
      return res.status(403).json({
        success: false,
        message: 'You can only upload your own profile picture'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    console.log('✅ Cloudinary upload successful:', {
      url: req.file.path,
      filename: req.file.filename
    });

    // Get current profile picture
    const [currentStaff] = await pool.execute(
      'SELECT profile_picture FROM staff WHERE id = ?',
      [staffId]
    );

    if (currentStaff.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Staff member not found'
      });
    }

    // Note: Old Cloudinary images can be cleaned up via Cloudinary dashboard or API
    // For now, we just replace the URL in the database
    if (currentStaff[0].profile_picture) {
      console.log('Replacing old profile picture URL:', currentStaff[0].profile_picture);
    }

    // Store the full Cloudinary URL
    const cloudinaryUrl = req.file.path;

    // Update staff profile with new Cloudinary URL
    await pool.execute(
      'UPDATE staff SET profile_picture = ?, updated_at = NOW() WHERE id = ?',
      [cloudinaryUrl, staffId]
    );

    console.log('✅ Profile picture updated for staff ID:', staffId);

    // Log profile picture update
    try {
      const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip || 'unknown';
      if (isAdmin) {
        await pool.execute(`
          INSERT INTO activity_logs (admin_id, action, details, ip_address, created_at)
          VALUES (?, 'staff_profile_picture_update', ?, ?, NOW())
        `, [req.user.id || req.user.admin_id, `Staff profile picture uploaded to Cloudinary for staff ID: ${staffId}`, clientIP]);
      } else {
        await pool.execute(`
          INSERT INTO activity_logs (staff_id, action, details, ip_address, created_at)
          VALUES (?, 'staff_profile_picture_update', ?, ?, NOW())
        `, [staffId, `Staff profile picture uploaded to Cloudinary`, clientIP]);
      }
      console.log('✅ Activity logged: staff_profile_picture_update');
    } catch (logError) {
      console.error('❌ Failed to log profile picture update activity:', logError.message);
    }

    // Get updated staff data
    const [updatedStaff] = await pool.execute(
      `SELECT s.id, s.name, s.email, s.phone, s.position, s.department, s.status, s.availability,
              s.last_login, s.created_at, s.updated_at, s.profile_picture, t.id as team_id, t.name as team_name
       FROM staff s
       LEFT JOIN teams t ON s.assigned_team_id = t.id
       WHERE s.id = ?`,
      [staffId]
    );

    res.json({
      success: true,
      message: 'Profile picture updated successfully',
      staff: updatedStaff[0],
      profilePicture: cloudinaryUrl
    });

  } catch (error) {
    console.error('❌ Error uploading staff profile picture:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload profile picture. Please try again.'
    });
  }
});

// DELETE - Delete staff profile picture
// Allow staff to delete their own picture, or admin to delete for any staff
router.delete('/:id/delete-picture', authenticateAny, async (req, res) => {
  try {
    const { id } = req.params;
    const staffId = parseInt(id);

    // Authorization check: Staff can only delete their own picture, admin can delete for any staff
    const isAdmin = req.userType === 'admin';
    const isStaff = req.userType === 'staff';
    const isUpdatingSelf = isStaff && parseInt(req.user.id) === parseInt(id);

    if (!isAdmin && !isUpdatingSelf) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own profile picture'
      });
    }

    // Get current profile picture
    const [currentStaff] = await pool.execute(
      'SELECT profile_picture FROM staff WHERE id = ?',
      [staffId]
    );

    if (currentStaff.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Staff member not found'
      });
    }

    if (!currentStaff[0].profile_picture) {
      return res.status(400).json({
        success: false,
        message: 'No profile picture to delete'
      });
    }

    // Note: Old Cloudinary images can be cleaned up via Cloudinary dashboard or API
    // For now, we just remove the URL from the database
    console.log('Removing profile picture URL:', currentStaff[0].profile_picture);

    // Update staff profile to remove profile picture
    await pool.execute(
      'UPDATE staff SET profile_picture = NULL, updated_at = NOW() WHERE id = ?',
      [staffId]
    );

    console.log('✅ Profile picture deleted for staff ID:', staffId);

    // Log profile picture deletion
    try {
      const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip || 'unknown';
      if (isAdmin) {
        await pool.execute(`
          INSERT INTO activity_logs (admin_id, action, details, ip_address, created_at)
          VALUES (?, 'staff_profile_picture_delete', ?, ?, NOW())
        `, [req.user.id || req.user.admin_id, `Staff profile picture deleted for staff ID: ${staffId}`, clientIP]);
      } else {
        await pool.execute(`
          INSERT INTO activity_logs (staff_id, action, details, ip_address, created_at)
          VALUES (?, 'staff_profile_picture_delete', ?, ?, NOW())
        `, [staffId, `Staff profile picture deleted`, clientIP]);
      }
      console.log('✅ Activity logged: staff_profile_picture_delete');
    } catch (logError) {
      console.error('❌ Failed to log profile picture deletion activity:', logError.message);
    }

    // Get updated staff data
    const [updatedStaff] = await pool.execute(
      `SELECT s.id, s.name, s.email, s.phone, s.position, s.department, s.status, s.availability,
              s.last_login, s.created_at, s.updated_at, s.profile_picture, t.id as team_id, t.name as team_name
       FROM staff s
       LEFT JOIN teams t ON s.assigned_team_id = t.id
       WHERE s.id = ?`,
      [staffId]
    );

    res.json({
      success: true,
      message: 'Profile picture deleted successfully',
      staff: updatedStaff[0]
    });

  } catch (error) {
    console.error('❌ Error deleting staff profile picture:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete profile picture. Please try again.'
    });
  }
});

module.exports = router;