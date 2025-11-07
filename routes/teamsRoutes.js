const express = require('express');
const router = express.Router();
const pool = require('../config/conn');
const { authenticateAdmin, authenticateAny } = require('../middleware/authMiddleware');

// GET - Get all teams (admin and staff can access)
router.get('/', authenticateAny, async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    
    console.log('Fetching teams with pagination:', { page, limit });
    
    // Get total count
    const [countResult] = await pool.execute(`SELECT COUNT(*) as total FROM teams`);
    const total = countResult[0].total;
    
    // Get paginated results
    const offset = (page - 1) * limit;
    const [teams] = await pool.execute(`
      SELECT 
        t.id, 
        t.member_no, 
        t.name, 
        t.description, 
        t.created_at, 
        t.updated_at,
        COALESCE(staff_counts.member_count, 0) as member_count
      FROM teams t
      LEFT JOIN (
        SELECT 
          s.assigned_team_id,
          COUNT(*) as member_count
        FROM staff s
        WHERE (s.status = "active" OR s.status = 1) AND s.availability = 'available'
        GROUP BY s.assigned_team_id
      ) staff_counts ON t.id = staff_counts.assigned_team_id
      ORDER BY t.name ASC
      LIMIT ? OFFSET ?
    `, [parseInt(limit), parseInt(offset)]);
    
    console.log('Teams with member counts:', teams.length, 'teams fetched');
    
    res.json({
      success: true,
      teams,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
    
  } catch (error) {
    console.error('Error fetching teams:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch teams',
      error: error.message
    });
  }
});

// GET - Get team by ID
router.get('/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const [team] = await pool.execute(`
      SELECT 
        t.id, 
        t.member_no, 
        t.name, 
        t.description, 
        t.created_at, 
        t.updated_at,
        COALESCE(staff_counts.member_count, 0) as member_count
      FROM teams t
      LEFT JOIN (
        SELECT 
          s.assigned_team_id,
          COUNT(*) as member_count
        FROM staff s
        WHERE (s.status = "active" OR s.status = 1) AND s.availability = 'available'
        GROUP BY s.assigned_team_id
      ) staff_counts ON t.id = staff_counts.assigned_team_id
      WHERE t.id = ?
    `, [id]);
    
    if (team.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Team not found'
      });
    }
    
    res.json({
      success: true,
      team: team[0]
    });
    
  } catch (error) {
    console.error('Error fetching team:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch team',
      error: error.message
    });
  }
});

// POST - Create new team
router.post('/', authenticateAdmin, async (req, res) => {
  try {
    const { member_no, name, description } = req.body;
    
    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Team name is required'
      });
    }
    
    const [result] = await pool.execute(`
      INSERT INTO teams (member_no, name, description)
      VALUES (?, ?, ?)
    `, [member_no || null, name, description || null]);
    
    res.status(201).json({
      success: true,
      message: 'Team created successfully',
      teamId: result.insertId
    });
    
  } catch (error) {
    console.error('Error creating team:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create team',
      error: error.message
    });
  }
});

// PUT - Update team
router.put('/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { member_no, name, description } = req.body;
    
    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Team name is required'
      });
    }
    
    const [result] = await pool.execute(`
      UPDATE teams
      SET member_no = ?, name = ?, description = ?, updated_at = NOW()
      WHERE id = ?
    `, [member_no || null, name, description || null, id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Team not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Team updated successfully'
    });
    
  } catch (error) {
    console.error('Error updating team:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update team',
      error: error.message
    });
  }
});

// PUT - Update team member count
router.put('/:id/member-count', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { member_count } = req.body;
    
    if (member_count === undefined || member_count < 0) {
      return res.status(400).json({
        success: false,
        message: 'Member count must be a non-negative number'
      });
    }
    
    // Update the member count in the database
    // Note: This is a manual override of the member count
    // In a real application, you might want to validate this against actual staff assignments
    await pool.execute(`
      UPDATE teams 
      SET member_count = ?, updated_at = NOW() 
      WHERE id = ?
    `, [member_count, id]);
    
    // Get the updated team
    const [updatedTeam] = await pool.execute(`
      SELECT t.id, t.member_no, t.name, t.description, t.member_count, t.created_at, t.updated_at
      FROM teams t
      WHERE t.id = ?
    `, [id]);
    
    res.json({
      success: true,
      message: 'Member count updated successfully',
      team: updatedTeam[0]
    });
    
  } catch (error) {
    console.error('Error updating member count:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update member count',
      error: error.message
    });
  }
});

// DELETE - Delete team
router.delete('/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get team details before deletion for logging
    const [existingTeams] = await pool.execute(
      'SELECT name FROM teams WHERE id = ?',
      [id]
    );
    
    const [result] = await pool.execute('DELETE FROM teams WHERE id = ?', [id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Team not found'
      });
    }
    
    // Log the team deletion
    try {
      const teamName = existingTeams[0]?.name || `ID: ${id}`;
      await pool.execute(`
        INSERT INTO activity_logs (admin_id, action, details, created_at)
        VALUES (?, 'team_delete', ?, NOW())
      `, [req.user?.id || 1, `Deleted team: ${teamName} (ID: ${id})`]);
    } catch (logError) {
      console.warn('Failed to log team deletion activity:', logError.message);
    }
    
    res.json({
      success: true,
      message: 'Team deleted successfully'
    });
    
  } catch (error) {
    console.error('Error deleting team:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete team',
      error: error.message
    });
  }
});

// GET - Get staff by team
router.get('/:id/staff', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const [staff] = await pool.execute(`
      SELECT s.id, s.name, s.email, s.phone, s.position, s.department, s.status, s.availability
      FROM staff s
      WHERE s.assigned_team_id = ? AND (s.status = "active" OR s.status = 1)
      ORDER BY s.name ASC
    `, [id]);
    
    res.json({
      success: true,
      staff
    });
    
  } catch (error) {
    console.error('Error fetching team staff:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch team staff',
      error: error.message
    });
  }
});

// POST - Assign staff to team
router.post('/:id/staff/:staffId', authenticateAdmin, async (req, res) => {
  try {
    const { id, staffId } = req.params;
    
    // Check if staff exists
    const [staff] = await pool.execute(
      'SELECT id, name FROM staff WHERE id = ?',
      [staffId]
    );
    
    if (staff.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Staff member not found'
      });
    }
    
    // Check if team exists
    const [teams] = await pool.execute(
      'SELECT id, name FROM teams WHERE id = ?',
      [id]
    );
    
    if (teams.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Team not found'
      });
    }
    
    // Update staff's assigned team
    await pool.execute(`
      UPDATE staff 
      SET assigned_team_id = ?, updated_at = NOW()
      WHERE id = ?
    `, [id, staffId]);
    
    // Log the staff assignment
    try {
      await pool.execute(`
        INSERT INTO activity_logs (admin_id, action, details, created_at)
        VALUES (?, 'team_staff_assign', ?, NOW())
      `, [req.user?.id || 1, `Assigned staff ${staff[0].name} (ID: ${staffId}) to team ${teams[0].name} (ID: ${id})`]);
    } catch (logError) {
      console.warn('Failed to log staff assignment activity:', logError.message);
    }
    
    res.json({
      success: true,
      message: 'Staff assigned to team successfully'
    });
    
  } catch (error) {
    console.error('Error assigning staff to team:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to assign staff to team',
      error: error.message
    });
  }
});

// DELETE - Remove staff from team
router.delete('/:id/staff/:staffId', authenticateAdmin, async (req, res) => {
  try {
    const { id, staffId } = req.params;
    
    // Get staff and team details before removal for logging
    const [staffDetails] = await pool.execute(
      'SELECT name FROM staff WHERE id = ?',
      [staffId]
    );
    
    const [teamDetails] = await pool.execute(
      'SELECT name FROM teams WHERE id = ?',
      [id]
    );
    
    const [result] = await pool.execute(`
      UPDATE staff 
      SET assigned_team_id = NULL, updated_at = NOW()
      WHERE id = ? AND assigned_team_id = ?
    `, [staffId, id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Staff not found in team'
      });
    }
    
    // Log the staff removal
    try {
      const staffName = staffDetails[0]?.name || `ID: ${staffId}`;
      const teamName = teamDetails[0]?.name || `ID: ${id}`;
      await pool.execute(`
        INSERT INTO activity_logs (admin_id, action, details, created_at)
        VALUES (?, 'team_staff_remove', ?, NOW())
      `, [req.user?.id || 1, `Removed staff ${staffName} (ID: ${staffId}) from team ${teamName} (ID: ${id})`]);
    } catch (logError) {
      console.warn('Failed to log staff removal activity:', logError.message);
    }
    
    res.json({
      success: true,
      message: 'Staff removed from team successfully'
    });
    
  } catch (error) {
    console.error('Error removing staff from team:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove staff from team',
      error: error.message
    });
  }
});

module.exports = router;