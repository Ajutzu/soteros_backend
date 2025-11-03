const express = require('express');
const router = express.Router();
const pool = require('../config/conn');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { uploadProfile } = require('../config/cloudinary');

// POST - Admin registration
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    
    console.log('Admin registration attempt:', { name, email });
    
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Name, email and password are required'
      });
    }
    
    // Check if admin already exists
    const [existingAdmins] = await pool.execute(
      'SELECT admin_id FROM admin WHERE email = ?',
      [email]
    );
    
    if (existingAdmins.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Email is already registered'
      });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Insert new admin
    const [result] = await pool.execute(
      'INSERT INTO admin (name, email, password, role, status) VALUES (?, ?, ?, "admin", "active")',
      [name, email, hashedPassword]
    );
    
    res.status(201).json({
      success: true,
      message: 'Admin registered successfully',
      admin: {
        id: result.insertId,
        name,
        email,
        role: 'admin',
        status: 'active'
      }
    });
    
  } catch (error) {
    console.error('Error during admin registration:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed',
      error: error.message
    });
  }
});

// POST - Admin login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    console.log('Admin login attempt:', { email });
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }
    
    // Find admin by email
    const [admins] = await pool.execute(
      'SELECT * FROM admin WHERE email = ? AND status = "active"',
      [email]
    );
    
    if (admins.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }
    
    const admin = admins[0];
    
    // Verify password
    const isValidPassword = await bcrypt.compare(password, admin.password);
    
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { 
        id: admin.admin_id, 
        email: admin.email, 
        role: admin.role,
        type: 'admin'
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );
    
    // Update last login (if column exists)
    try {
      await pool.execute(
        'UPDATE admin SET updated_at = NOW() WHERE admin_id = ?',
        [admin.admin_id]
      );
    } catch (updateError) {
      console.log('Could not update last login:', updateError.message);
    }
    
    // Log admin login activity
    try {
      const { created_by } = req.body;
      const finalCreatedBy = created_by !== null && created_by !== undefined
        ? created_by
        : (req.admin?.admin_id || admin.admin_id);

      const clientIP = req.headers['x-forwarded-for'] ||
                      req.headers['x-real-ip'] ||
                      req.connection.remoteAddress ||
                      req.socket.remoteAddress ||
                      req.ip ||
                      'unknown';
      await pool.execute(`
        INSERT INTO activity_logs (admin_id, action, details, ip_address, created_at)
        VALUES (?, 'admin_login', ?, ?, NOW())
      `, [finalCreatedBy, `Admin ${admin.email} logged in successfully`, clientIP]);
      console.log('✅ Activity logged: admin_login for admin ID:', finalCreatedBy);
    } catch (logError) {
      console.error('❌ Failed to log admin login activity:', logError.message);
      // Don't fail the main operation if logging fails
    }
    
    res.json({
      success: true,
      message: 'Login successful',
      token,
      admin: {
        id: admin.admin_id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        status: admin.status
      }
    });
    
  } catch (error) {
    console.error('Error during admin login:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: error.message
    });
  }
});

// POST - Admin logout (optional - mainly for logging)
router.post('/logout', async (req, res) => {
  try {
    // Get admin info from token for logging
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    let adminId = null;
    let adminEmail = 'unknown';

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        if (decoded.type === 'admin') {
          adminId = decoded.id;
          adminEmail = decoded.email;
        }
      } catch (tokenError) {
        console.log('Could not decode token for logout logging:', tokenError.message);
      }
    }

    // Log admin logout activity
    try {
      const { created_by } = req.body;
      const finalCreatedBy = created_by !== null && created_by !== undefined
        ? created_by
        : (req.admin?.admin_id || adminId);

      const clientIP = req.headers['x-forwarded-for'] ||
                      req.headers['x-real-ip'] ||
                      req.connection.remoteAddress ||
                      req.socket.remoteAddress ||
                      req.ip ||
                      'unknown';

      // Only log if we have a valid admin ID
      if (finalCreatedBy) {
        await pool.execute(`
          INSERT INTO activity_logs (admin_id, action, details, ip_address, created_at)
          VALUES (?, 'admin_logout', ?, ?, NOW())
        `, [finalCreatedBy, `Admin ${adminEmail} logged out successfully`, clientIP]);
        console.log('✅ Activity logged: admin_logout for admin ID:', finalCreatedBy);
      } else {
        console.log('⚠️ Could not log admin logout: admin ID not found');
      }
    } catch (logError) {
      console.error('❌ Failed to log admin logout activity:', logError.message);
      // Don't fail the main operation if logging fails
    }

    // In a real app, you might want to blacklist the token
    res.json({
      success: true,
      message: 'Logout successful'
    });
  } catch (error) {
    console.error('Error during admin logout:', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed',
      error: error.message
    });
  }
});

// GET - Get current admin profile
router.get('/profile', authenticateAdmin, async (req, res) => {
  try {
    const adminId = req.admin.id;

    const [admins] = await pool.execute(
      'SELECT admin_id, name, email, role, status, profile_picture, created_at FROM admin WHERE admin_id = ?',
      [adminId]
    );

    if (admins.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    res.json({
      success: true,
      admin: admins[0]
    });

  } catch (error) {
    console.error('Error fetching admin profile:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch profile',
      error: error.message
    });
  }
});

// PUT - Update current admin profile
router.put('/profile', authenticateAdmin, async (req, res) => {
  try {
    const adminId = req.admin.id;
    const { name, email } = req.body;

    if (!name || !email) {
      return res.status(400).json({
        success: false,
        message: 'Name and email are required'
      });
    }

    // Check if email is already taken by another admin
    const [existingAdmins] = await pool.execute(
      'SELECT admin_id FROM admin WHERE email = ? AND admin_id != ?',
      [email, adminId]
    );

    if (existingAdmins.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Email is already taken by another admin'
      });
    }

    // Update admin profile
    await pool.execute(
      'UPDATE admin SET name = ?, email = ?, updated_at = NOW() WHERE admin_id = ?',
      [name, email, adminId]
    );

    // Get updated admin data
    const [updatedAdmins] = await pool.execute(
      'SELECT admin_id, name, email, role, status, profile_picture, created_at FROM admin WHERE admin_id = ?',
      [adminId]
    );

    // Log the profile update
    try {
      const clientIP = req.headers['x-forwarded-for'] ||
                      req.headers['x-real-ip'] ||
                      req.connection.remoteAddress ||
                      req.socket.remoteAddress ||
                      req.ip ||
                      'unknown';

      await pool.execute(`
        INSERT INTO activity_logs (admin_id, action, details, ip_address, created_at)
        VALUES (?, 'admin_profile_update', ?, ?, NOW())
      `, [adminId, `Admin updated profile: name=${name}, email=${email}`, clientIP]);
    } catch (logError) {
      console.warn('Failed to log admin profile update activity:', logError.message);
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      admin: updatedAdmins[0]
    });

  } catch (error) {
    console.error('Error updating admin profile:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile',
      error: error.message
    });
  }
});

// Middleware to authenticate admin
function authenticateAdmin(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access token required'
    });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    
    if (decoded.type !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }
    
    req.admin = decoded;
    next();
  } catch (error) {
    return res.status(403).json({
      success: false,
      message: 'Invalid or expired token'
    });
  }
}

// POST - Change admin password
router.post('/change-password', authenticateAdmin, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const adminId = req.admin.id;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required'
      });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long'
      });
    }
    
    // Get current admin
    const [admins] = await pool.execute(
      'SELECT password FROM admin WHERE admin_id = ?',
      [adminId]
    );
    
    if (admins.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }
    
    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, admins[0].password);
    
    if (!isValidPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }
    
    // Hash new password
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    
    // Update password
    await pool.execute(
      'UPDATE admin SET password = ?, updated_at = NOW() WHERE admin_id = ?',
      [hashedNewPassword, adminId]
    );
    
    // Log the password change
    try {
      const { created_by } = req.body;
      const finalCreatedBy = created_by !== null && created_by !== undefined
        ? created_by
        : (req.admin?.admin_id || adminId);

      await pool.execute(`
        INSERT INTO activity_logs (admin_id, action, details, created_at)
        VALUES (?, 'admin_password_change', ?, NOW())
      `, [finalCreatedBy, 'Admin changed password successfully']);
    } catch (logError) {
      console.warn('Failed to log admin password change activity:', logError.message);
    }
    
    res.json({
      success: true,
      message: 'Password changed successfully'
    });
    
  } catch (error) {
    console.error('Error changing admin password:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to change password',
      error: error.message
    });
  }
});

// POST - Upload admin profile picture (Using Cloudinary)
router.post('/upload-picture', authenticateAdmin, uploadProfile.single('profilePicture'), async (req, res) => {
  try {
    const adminId = req.admin.id;

    console.log('📤 Admin profile picture upload request received');
    console.log('Admin ID from token:', adminId);
    console.log('File received:', req.file ? 'Yes' : 'No');

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
    const [currentAdmins] = await pool.execute(
      'SELECT profile_picture FROM admin WHERE admin_id = ?',
      [adminId]
    );

    if (currentAdmins.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    const currentAdmin = currentAdmins[0];

    // Note: Old Cloudinary images can be cleaned up via Cloudinary dashboard or API
    // For now, we just replace the URL in the database
    if (currentAdmin.profile_picture) {
      console.log('Replacing old profile picture URL:', currentAdmin.profile_picture);
    }

    // Store the full Cloudinary URL
    const cloudinaryUrl = req.file.path;

    // Update admin profile with new Cloudinary URL
    await pool.execute(
      'UPDATE admin SET profile_picture = ?, updated_at = NOW() WHERE admin_id = ?',
      [cloudinaryUrl, adminId]
    );

    console.log('✅ Profile picture updated for admin ID:', adminId);

    // Log profile picture update
    try {
      const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip || 'unknown';
      await pool.execute(`
        INSERT INTO activity_logs (admin_id, action, details, ip_address, created_at)
        VALUES (?, 'admin_profile_picture_update', ?, ?, NOW())
      `, [adminId, `Admin profile picture uploaded to Cloudinary`, clientIP]);
      console.log('✅ Activity logged: admin_profile_picture_update');
    } catch (logError) {
      console.error('❌ Failed to log profile picture update activity:', logError.message);
    }

    // Get updated admin data
    const [updatedAdmins] = await pool.execute(
      'SELECT admin_id, name, email, role, status, profile_picture, created_at FROM admin WHERE admin_id = ?',
      [adminId]
    );

    res.json({
      success: true,
      message: 'Profile picture updated successfully',
      admin: updatedAdmins[0],
      profilePicture: cloudinaryUrl
    });

  } catch (error) {
    console.error('❌ Error uploading admin profile picture:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload profile picture. Please try again.'
    });
  }
});

// DELETE - Delete admin profile picture
router.delete('/delete-picture', authenticateAdmin, async (req, res) => {
  try {
    const adminId = req.admin.id;

    // Get current profile picture
    const [currentAdmins] = await pool.execute(
      'SELECT profile_picture FROM admin WHERE admin_id = ?',
      [adminId]
    );

    if (currentAdmins.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    const currentAdmin = currentAdmins[0];

    if (!currentAdmin.profile_picture) {
      return res.status(400).json({
        success: false,
        message: 'No profile picture to delete'
      });
    }

    // Note: Old Cloudinary images can be cleaned up via Cloudinary dashboard or API
    // For now, we just remove the URL from the database
    console.log('Removing profile picture URL:', currentAdmin.profile_picture);

    // Update admin profile to remove profile picture
    await pool.execute(
      'UPDATE admin SET profile_picture = NULL, updated_at = NOW() WHERE admin_id = ?',
      [adminId]
    );

    console.log('✅ Profile picture deleted for admin ID:', adminId);

    // Log profile picture deletion
    try {
      const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip || 'unknown';
      await pool.execute(`
        INSERT INTO activity_logs (admin_id, action, details, ip_address, created_at)
        VALUES (?, 'admin_profile_picture_delete', ?, ?, NOW())
      `, [adminId, `Admin profile picture deleted`, clientIP]);
      console.log('✅ Activity logged: admin_profile_picture_delete');
    } catch (logError) {
      console.error('❌ Failed to log profile picture deletion activity:', logError.message);
    }

    // Get updated admin data
    const [updatedAdmins] = await pool.execute(
      'SELECT admin_id, name, email, role, status, profile_picture, created_at FROM admin WHERE admin_id = ?',
      [adminId]
    );

    res.json({
      success: true,
      message: 'Profile picture deleted successfully',
      admin: updatedAdmins[0]
    });

  } catch (error) {
    console.error('❌ Error deleting admin profile picture:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete profile picture. Please try again.'
    });
  }
});

module.exports = router;
