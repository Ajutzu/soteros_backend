const express = require('express');
const router = express.Router();
const pool = require('../config/conn');

// Helper function to build date filter WHERE clause (year required, optional month and day)
// dateColumn defaults to 'date_reported' but can be overridden (e.g., 'created_at')
const buildDateFilter = (year, month, day, dateColumn = 'date_reported') => {
  const conditions = [];
  const params = [];
  
  if (year) {
    const yearNum = parseInt(year);
    if (!isNaN(yearNum) && yearNum > 0) {
      conditions.push(`YEAR(${dateColumn}) = ?`);
      params.push(yearNum);
    }
  }
  if (month !== undefined && month !== null) {
    const monthNum = parseInt(month);
    if (!isNaN(monthNum) && monthNum > 0 && monthNum <= 12) {
      conditions.push(`MONTH(${dateColumn}) = ?`);
      params.push(monthNum);
    }
  }
  if (day !== undefined && day !== null) {
    const dayNum = parseInt(day);
    if (!isNaN(dayNum) && dayNum > 0 && dayNum <= 31) {
      conditions.push(`DAY(${dateColumn}) = ?`);
      params.push(dayNum);
    }
  }
  
  return {
    whereClause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params
  };
};

// Test route
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Admin dashboard routes are working!'
  });
});

// GET - Dashboard statistics
router.get('/stats', async (req, res) => {
  try {
    console.log('Fetching dashboard statistics...');
    const { year, month, day } = req.query;
    
    // Build date filter for incidents (year required, month and day optional)
    const incidentDateFilter = buildDateFilter(year, month, day);
    const incidentWhere = incidentDateFilter.whereClause ? `WHERE ${incidentDateFilter.whereClause.replace('WHERE ', '')}` : '';
    
    // Get total counts with year filter
    const userStatsQuery = incidentDateFilter.params.length > 0
      ? `
          SELECT
            COUNT(*) as total_users,
            SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as active_users,
            SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) as new_users_month
          FROM general_users
          WHERE status = 1 AND YEAR(created_at) = ?
        `
      : `
          SELECT
            COUNT(*) as total_users,
            SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as active_users,
            SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) as new_users_month
          FROM general_users
          WHERE status = 1
        `;
    const [userStats] = incidentDateFilter.params.length > 0
      ? await pool.execute(userStatsQuery, incidentDateFilter.params)
      : await pool.execute(userStatsQuery);

    const staffStatsQuery = incidentDateFilter.params.length > 0
      ? `
          SELECT
            COUNT(*) as total_staff,
            SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as active_staff
          FROM staff
          WHERE status = 1 AND YEAR(created_at) = ?
        `
      : `
          SELECT
            COUNT(*) as total_staff,
            SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as active_staff
          FROM staff
          WHERE status = 1
        `;
    const [staffStats] = incidentDateFilter.params.length > 0
      ? await pool.execute(staffStatsQuery, incidentDateFilter.params)
      : await pool.execute(staffStatsQuery);

    const [incidentStats] = incidentDateFilter.params.length > 0
      ? await pool.execute(`
          SELECT
            COUNT(*) as total_incidents,
            SUM(CASE WHEN status = 'pending' OR status = 'in_progress' THEN 1 ELSE 0 END) as active_incidents,
            SUM(CASE WHEN priority_level = 'high' OR priority_level = 'critical' THEN 1 ELSE 0 END) as high_priority_incidents,
            SUM(CASE WHEN date_reported >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as incidents_this_week
          FROM incident_reports
          ${incidentDateFilter.whereClause}
        `, incidentDateFilter.params)
      : await pool.execute(`
          SELECT
            COUNT(*) as total_incidents,
            SUM(CASE WHEN status = 'pending' OR status = 'in_progress' THEN 1 ELSE 0 END) as active_incidents,
            SUM(CASE WHEN priority_level = 'high' OR priority_level = 'critical' THEN 1 ELSE 0 END) as high_priority_incidents,
            SUM(CASE WHEN date_reported >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as incidents_this_week
          FROM incident_reports
        `);

    const alertStatsQuery = incidentDateFilter.params.length > 0
      ? `
          SELECT
            COUNT(*) as total_alerts,
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_alerts,
            SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as alerts_this_week
          FROM alerts
          WHERE YEAR(created_at) = ?
        `
      : `
          SELECT
            COUNT(*) as total_alerts,
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_alerts,
            SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as alerts_this_week
          FROM alerts
        `;
    const [alertStats] = incidentDateFilter.params.length > 0
      ? await pool.execute(alertStatsQuery, incidentDateFilter.params)
      : await pool.execute(alertStatsQuery);
    
    // Get recent activity (using incident reports as activity proxy) with date filter
    const [recentActivity] = incidentDateFilter.params.length > 0
      ? await pool.execute(`
          SELECT
            'incident_report' as action,
            CONCAT('New incident: ', ir.incident_type) as details,
            ir.date_reported as created_at,
            'user' as user_type,
            ir.reported_by as user_id,
            CONCAT(gu.first_name, ' ', gu.last_name) as reporter_name
          FROM incident_reports ir
          LEFT JOIN general_users gu ON ir.reported_by = gu.user_id
          ${incidentDateFilter.whereClause.replace('date_reported', 'ir.date_reported')}
          ORDER BY ir.date_reported DESC
          LIMIT 10
        `, incidentDateFilter.params)
      : await pool.execute(`
          SELECT
            'incident_report' as action,
            CONCAT('New incident: ', ir.incident_type) as details,
            ir.date_reported as created_at,
            'user' as user_type,
            ir.reported_by as user_id,
            CONCAT(gu.first_name, ' ', gu.last_name) as reporter_name
          FROM incident_reports ir
          LEFT JOIN general_users gu ON ir.reported_by = gu.user_id
          ORDER BY ir.date_reported DESC
          LIMIT 10
        `);

    // Get incident trends with date filter
    const incidentTrendsQuery = incidentDateFilter.params.length > 0
      ? `
          SELECT
            DATE(date_reported) as date,
            COUNT(*) as count
          FROM incident_reports
          ${incidentDateFilter.whereClause}
          GROUP BY DATE(date_reported)
          ORDER BY date ASC
        `
      : `
          SELECT
            DATE(date_reported) as date,
            COUNT(*) as count
          FROM incident_reports
          WHERE date_reported >= DATE_SUB(NOW(), INTERVAL 7 DAY)
          GROUP BY DATE(date_reported)
          ORDER BY date ASC
        `;
    const [incidentTrends] = incidentDateFilter.params.length > 0
      ? await pool.execute(incidentTrendsQuery, incidentDateFilter.params)
      : await pool.execute(incidentTrendsQuery);

    // Get user registration trends with year filter
    const userTrendsQuery = incidentDateFilter.params.length > 0
      ? `
          SELECT
            DATE(created_at) as date,
            COUNT(*) as count
          FROM general_users
          WHERE YEAR(created_at) = ? AND status = 1
          GROUP BY DATE(created_at)
          ORDER BY date ASC
        `
      : `
          SELECT
            DATE(created_at) as date,
            COUNT(*) as count
          FROM general_users
          WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
          AND status = 1
          GROUP BY DATE(created_at)
          ORDER BY date ASC
        `;
    const [userTrends] = incidentDateFilter.params.length > 0
      ? await pool.execute(userTrendsQuery, incidentDateFilter.params)
      : await pool.execute(userTrendsQuery);
    
    res.json({
      success: true,
      stats: {
        users: userStats[0],
        staff: staffStats[0],
        incidents: incidentStats[0],
        alerts: alertStats[0]
      },
      recentActivity,
      trends: {
        incidents: incidentTrends,
        users: userTrends
      }
    });
    
  } catch (error) {
    console.error('Error fetching dashboard statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard statistics',
      error: error.message
    });
  }
});

// GET - System overview
router.get('/overview', async (req, res) => {
  try {
    console.log('Fetching system overview...');
    const { year, month, day } = req.query;
    const incidentDateFilter = buildDateFilter(year, month, day);
    
    // Get user type distribution
    const [userTypeStats] = await pool.execute(`
      SELECT user_type, COUNT(*) as user_count
      FROM general_users
      WHERE status = 1
      GROUP BY user_type
      ORDER BY user_count DESC
    `);

    // Get incident types distribution with date filter
    const [incidentTypes] = incidentDateFilter.params.length > 0
      ? await pool.execute(`
          SELECT incident_type, COUNT(*) as count
          FROM incident_reports
          ${incidentDateFilter.whereClause}
          GROUP BY incident_type
          ORDER BY count DESC
        `, incidentDateFilter.params)
      : await pool.execute(`
          SELECT incident_type, COUNT(*) as count
          FROM incident_reports
          GROUP BY incident_type
          ORDER BY count DESC
        `);

    // Get alert types distribution
    const [alertTypes] = await pool.execute(`
      SELECT alert_type, COUNT(*) as count
      FROM alerts
      GROUP BY alert_type
      ORDER BY count DESC
    `);

    // Get evacuation centers status
    const [evacuationCenters] = await pool.execute(`
      SELECT
        COUNT(*) as total_centers,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_centers,
        SUM(CASE WHEN status = 'full' THEN 1 ELSE 0 END) as full_centers,
        SUM(capacity) as total_capacity,
        SUM(current_occupancy) as total_occupancy
      FROM evacuation_centers
    `);
    
    res.json({
      success: true,
      overview: {
        userTypeDistribution: userTypeStats,
        incidentTypes,
        alertTypes,
        evacuationCenters: evacuationCenters[0]
      }
    });
    
  } catch (error) {
    console.error('Error fetching system overview:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch system overview',
      error: error.message
    });
  }
});

// GET - Analytics data for charts
router.get('/analytics', async (req, res) => {
  try {
    console.log('Fetching analytics data for charts...');
    const { year, month, day } = req.query;
    const incidentDateFilter = buildDateFilter(year, month, day);
    
    // Get incident trends with date filter
    const incidentTrendsQuery = incidentDateFilter.params.length > 0
      ? `
          SELECT
            DATE(date_reported) as date,
            COUNT(*) as count
          FROM incident_reports
          ${incidentDateFilter.whereClause}
          GROUP BY DATE(date_reported)
          ORDER BY date ASC
        `
      : `
          SELECT
            DATE(date_reported) as date,
            COUNT(*) as count
          FROM incident_reports
          WHERE date_reported >= DATE_SUB(NOW(), INTERVAL 30 DAY)
          GROUP BY DATE(date_reported)
          ORDER BY date ASC
        `;
    const [incidentTrends30Days] = incidentDateFilter.params.length > 0
      ? await pool.execute(incidentTrendsQuery, incidentDateFilter.params)
      : await pool.execute(incidentTrendsQuery);

    // Get user registration trends with year filter
    const userTrends90DaysQuery = incidentDateFilter.params.length > 0
      ? `
          SELECT
            DATE(created_at) as date,
            COUNT(*) as count
          FROM general_users
          WHERE YEAR(created_at) = ? AND status = 1
          GROUP BY DATE(created_at)
          ORDER BY date ASC
        `
      : `
          SELECT
            DATE(created_at) as date,
            COUNT(*) as count
          FROM general_users
          WHERE created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
          AND status = 1
          GROUP BY DATE(created_at)
          ORDER BY date ASC
        `;
    const [userTrends90Days] = incidentDateFilter.params.length > 0
      ? await pool.execute(userTrends90DaysQuery, incidentDateFilter.params)
      : await pool.execute(userTrends90DaysQuery);

    // Get incident status distribution with date filter
    const [incidentStatus] = incidentDateFilter.params.length > 0
      ? await pool.execute(`
          SELECT 
            status,
            COUNT(*) as count
          FROM incident_reports
          ${incidentDateFilter.whereClause}
          GROUP BY status
          ORDER BY count DESC
        `, incidentDateFilter.params)
      : await pool.execute(`
          SELECT 
            status,
            COUNT(*) as count
          FROM incident_reports
          GROUP BY status
          ORDER BY count DESC
        `);

    // Get incident priority distribution with date filter
    const [incidentPriority] = incidentDateFilter.params.length > 0
      ? await pool.execute(`
          SELECT 
            priority_level as priority,
            COUNT(*) as count
          FROM incident_reports
          ${incidentDateFilter.whereClause}
          GROUP BY priority_level
          ORDER BY count DESC
        `, incidentDateFilter.params)
      : await pool.execute(`
          SELECT 
            priority_level as priority,
            COUNT(*) as count
          FROM incident_reports
          GROUP BY priority_level
          ORDER BY count DESC
        `);

    // Get evacuation center occupancy rates
    const [evacuationOccupancy] = await pool.execute(`
      SELECT 
        name,
        capacity,
        current_occupancy,
        ROUND((current_occupancy / capacity) * 100, 2) as occupancy_rate
      FROM evacuation_centers
      WHERE status = 'open'
      ORDER BY occupancy_rate DESC
      LIMIT 10
    `);

    // Get monthly incident summary with date filter
    const monthlyIncidentsQuery = incidentDateFilter.params.length > 0
      ? `
          SELECT
            DATE_FORMAT(date_reported, '%Y-%m') as month,
            COUNT(*) as total_incidents,
            SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved_incidents,
            SUM(CASE WHEN priority_level = 'high' OR priority_level = 'critical' THEN 1 ELSE 0 END) as high_priority_incidents
          FROM incident_reports
          ${incidentDateFilter.whereClause}
          GROUP BY DATE_FORMAT(date_reported, '%Y-%m')
          ORDER BY month ASC
        `
      : `
          SELECT
            DATE_FORMAT(date_reported, '%Y-%m') as month,
            COUNT(*) as total_incidents,
            SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved_incidents,
            SUM(CASE WHEN priority_level = 'high' OR priority_level = 'critical' THEN 1 ELSE 0 END) as high_priority_incidents
          FROM incident_reports
          WHERE date_reported >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
          GROUP BY DATE_FORMAT(date_reported, '%Y-%m')
          ORDER BY month ASC
        `;
    const [monthlyIncidents] = incidentDateFilter.params.length > 0
      ? await pool.execute(monthlyIncidentsQuery, incidentDateFilter.params)
      : await pool.execute(monthlyIncidentsQuery);

    // Get peak hours analysis with date filter
    const peakHoursQuery = incidentDateFilter.params.length > 0
      ? `
          SELECT
            HOUR(date_reported) as hour,
            COUNT(*) as incident_count,
            MIN(date_reported) as earliest_datetime,
            MAX(date_reported) as latest_datetime,
            GROUP_CONCAT(
              DISTINCT CONCAT(DATE(date_reported), ' ', TIME_FORMAT(date_reported, '%h:%i %p')) 
              ORDER BY date_reported DESC 
              LIMIT 5
            ) as sample_datetimes,
            GROUP_CONCAT(
              DISTINCT DATE(date_reported) 
              ORDER BY DATE(date_reported) ASC
            ) as consecutive_dates
          FROM incident_reports
          ${incidentDateFilter.whereClause}
          GROUP BY HOUR(date_reported)
          ORDER BY hour ASC
        `
      : `
          SELECT
            HOUR(date_reported) as hour,
            COUNT(*) as incident_count,
            MIN(date_reported) as earliest_datetime,
            MAX(date_reported) as latest_datetime,
            GROUP_CONCAT(
              DISTINCT CONCAT(DATE(date_reported), ' ', TIME_FORMAT(date_reported, '%h:%i %p')) 
              ORDER BY date_reported DESC 
              LIMIT 5
            ) as sample_datetimes,
            GROUP_CONCAT(
              DISTINCT DATE(date_reported) 
              ORDER BY DATE(date_reported) ASC
            ) as consecutive_dates
          FROM incident_reports
          WHERE date_reported >= DATE_SUB(NOW(), INTERVAL 30 DAY)
          GROUP BY HOUR(date_reported)
          ORDER BY hour ASC
        `;
    const [peakHoursData] = incidentDateFilter.params.length > 0
      ? await pool.execute(peakHoursQuery, incidentDateFilter.params)
      : await pool.execute(peakHoursQuery);

    res.json({
      success: true,
      analytics: {
        incidentTrends30Days,
        userTrends90Days,
        incidentStatus,
        incidentPriority,
        evacuationOccupancy,
        monthlyIncidents,
        peakHours: peakHoursData
      }
    });
    
  } catch (error) {
    console.error('Error fetching analytics data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch analytics data',
      error: error.message
    });
  }
});

// GET - Location-based incident data for stacked bar chart
// Updated to extract barangay information from incident descriptions
router.get('/location-incidents', async (req, res) => {
  try {
    console.log('Fetching location-based incident data...');
    const { year, month, day } = req.query;
    const incidentDateFilter = buildDateFilter(year, month, day);

    // Get all incidents with their descriptions to extract barangay information
    const baseWhere = "WHERE description IS NOT NULL AND description != ''";
    const dateWhere = incidentDateFilter.whereClause 
      ? `${baseWhere} AND ${incidentDateFilter.whereClause.replace('WHERE ', '')}`
      : baseWhere;
    
    const [incidentData] = incidentDateFilter.params.length > 0
      ? await pool.execute(`
          SELECT
            incident_id,
            incident_type,
            description,
            latitude,
            longitude,
            date_reported,
            status,
            priority_level
          FROM incident_reports
          ${dateWhere}
          ORDER BY date_reported DESC
        `, incidentDateFilter.params)
      : await pool.execute(`
          SELECT
            incident_id,
            incident_type,
            description,
            latitude,
            longitude,
            date_reported,
            status,
            priority_level
          FROM incident_reports
          WHERE description IS NOT NULL AND description != ''
          ORDER BY date_reported DESC
        `);

    // Function to extract barangay name from description
    const extractBarangay = (description) => {
      if (!description) return null;

      const desc = description.toLowerCase();

      // Common barangay patterns in descriptions
      const barangayPatterns = [
        /barangay\s+([a-zA-Z\s\d]+)(?:,|\.|$)/i,
        /brgy\.?\s+([a-zA-Z\s\d]+)(?:,|\.|$)/i,
        /bgy\.?\s+([a-zA-Z\s\d]+)(?:,|\.|$)/i,
        /in\s+([a-zA-Z\s\d]+)\s+barangay/i,
        /at\s+([a-zA-Z\s\d]+)\s+barangay/i,
        /([a-zA-Z\s\d]+)\s+barangay/i
      ];

      for (const pattern of barangayPatterns) {
        const match = desc.match(pattern);
        if (match && match[1]) {
          // Clean up the barangay name
          let barangayName = match[1].trim();
          // Remove common suffixes and clean up
          barangayName = barangayName.replace(/\s+(proper|district|area|poblacion)$/i, '');
          barangayName = barangayName.replace(/^the\s+/i, '');
          return barangayName.charAt(0).toUpperCase() + barangayName.slice(1).toLowerCase();
        }
      }

      return null;
    };

    // Process incidents and group by barangay
    const barangayMap = new Map();

    incidentData.forEach(incident => {
      let barangayName = null;

      // First try to extract barangay from description
      if (incident.description) {
        barangayName = extractBarangay(incident.description);
      }

      // If no barangay found in description, use coordinate-based fallback
      if (!barangayName) {
        // Use coordinate ranges as fallback (simplified version)
        if (incident.latitude >= 14.5 && incident.longitude >= 121.0) {
          barangayName = 'North Area';
        } else if (incident.latitude >= 14.4 && incident.longitude >= 121.0) {
          barangayName = 'Central Area';
        } else if (incident.latitude >= 14.3 && incident.longitude >= 121.0) {
          barangayName = 'South Area';
        } else {
          barangayName = 'Other Areas';
        }
      }

      const incidentType = incident.incident_type;

      if (!barangayMap.has(barangayName)) {
        barangayMap.set(barangayName, { name: barangayName });
      }

      // Count incidents by type for each barangay
      if (!barangayMap.get(barangayName)[incidentType]) {
        barangayMap.get(barangayName)[incidentType] = 0;
      }
      barangayMap.get(barangayName)[incidentType]++;
    });

    const stackedData = Array.from(barangayMap.values());

    // Sort by total incidents (descending)
    stackedData.sort((a, b) => {
      const totalA = Object.keys(a).filter(key => key !== 'name').reduce((sum, key) => sum + (a[key] || 0), 0);
      const totalB = Object.keys(b).filter(key => key !== 'name').reduce((sum, key) => sum + (b[key] || 0), 0);
      return totalB - totalA;
    });

    res.json({
      success: true,
      locationIncidents: stackedData,
      note: 'This data groups incidents by barangay extracted from descriptions. Falls back to area-based grouping if barangay not found in description.',
      totalIncidents: incidentData.length,
      barangaysFound: stackedData.length
    });

  } catch (error) {
    console.error('Error fetching location-based incident data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch location-based incident data',
      error: error.message
    });
  }
});

// GET - Monthly incident trends with time period filter
router.get('/monthly-trends', async (req, res) => {
  try {
    console.log('Fetching monthly incident trends...');

    const { period = 'months', limit = 12, year, month, day } = req.query;
    console.log(`Monthly trends request - Period: ${period}, Limit: ${limit}, Year: ${year}, Month: ${month}, Day: ${day}`);
    console.log(`Month type: ${typeof month}, Month parsed: ${month ? parseInt(month) : 'null'}`);
    let dateFormat, groupBy, dateFilter;
    let whereClause = '';

    // Build date filter based on year (required), month and day (optional)
    let queryParams = [];
    if (year) {
      // Only include month and day in filter if they are provided and > 0
      const monthNum = month && parseInt(month) > 0 ? parseInt(month) : undefined;
      const dayNum = day && parseInt(day) > 0 ? parseInt(day) : undefined;
      const dateFilterObj = buildDateFilter(year, monthNum, dayNum);
      whereClause = dateFilterObj.whereClause;
      queryParams = dateFilterObj.params;
    } else {
      // Use relative date filter if no specific date is provided
      switch (period) {
        case 'days':
          dateFormat = '%Y-%m-%d';
          groupBy = 'DATE(date_reported)';
          dateFilter = `DATE_SUB(NOW(), INTERVAL ${Math.min(parseInt(limit), 30)} DAY)`;
          whereClause = `WHERE date_reported >= ${dateFilter}`;
          break;
        case 'weeks':
          dateFormat = '%Y-W%U';
          groupBy = 'YEARWEEK(date_reported, 1)';
          dateFilter = `DATE_SUB(NOW(), INTERVAL ${Math.min(parseInt(limit), 52)} WEEK)`;
          whereClause = `WHERE date_reported >= ${dateFilter}`;
          break;
        case 'months':
        default:
          dateFormat = '%Y-%m';
          groupBy = 'DATE_FORMAT(date_reported, "%Y-%m")';
          dateFilter = `DATE_SUB(NOW(), INTERVAL ${Math.min(parseInt(limit), 24)} MONTH)`;
          whereClause = `WHERE date_reported >= ${dateFilter}`;
          break;
      }
    }

    // Set groupBy based on period and date filters
    if (!year) {
      // No date filter - use period parameter
      switch (period) {
        case 'days':
          groupBy = 'DATE(date_reported)';
          break;
        case 'weeks':
          groupBy = 'YEARWEEK(date_reported, 1)';
          break;
        case 'months':
        default:
          groupBy = 'DATE_FORMAT(date_reported, "%Y-%m")';
          break;
      }
    } else {
      // Date filter is used - determine grouping based on month/day filters
      const monthNum = month && parseInt(month) > 0 ? parseInt(month) : null;
      const dayNum = day && parseInt(day) > 0 ? parseInt(day) : null;
      
      if (monthNum && monthNum > 0) {
        // If month is specified (and valid), group by day within that month
        groupBy = 'DATE(date_reported)';
      } else if (dayNum && dayNum > 0) {
        // If day is specified (without month), group by day (shouldn't happen, but handle it)
        groupBy = 'DATE(date_reported)';
      } else {
        // If only year is specified, group by month
        groupBy = 'DATE_FORMAT(date_reported, "%Y-%m")';
      }
    }

    // Check if we need to generate all days in a month (when month is selected)
    // Parse month and year for date generation
    // IMPORTANT: When month is selected, always generate all days (even if day = 0 or undefined for "All Days")
    const monthNumForDays = month ? parseInt(month) : null;
    const yearNumForDays = year ? parseInt(year) : null;
    const dayNumForDays = day ? parseInt(day) : null;
    
    let query;
    let finalQueryParams = [];
    
    // If month is selected (valid month 1-12), generate all days in that month
    // This works for both "All Days" (day = 0 or undefined) and specific day selection
    const hasValidMonth = monthNumForDays && monthNumForDays > 0 && monthNumForDays <= 12;
    const hasValidYear = yearNumForDays && !isNaN(yearNumForDays);
    const isAllDays = !dayNumForDays || dayNumForDays === 0 || dayNumForDays < 1;
    
    if (hasValidMonth && hasValidYear && isAllDays) {
      console.log(`✓ Month detected! Generating ALL days for month ${monthNumForDays}, year ${yearNumForDays} (All Days selected)`);
      // Generate all days in the selected month and LEFT JOIN with incidents
      // This ensures all days (1-30/31) appear in the chart, even with 0 incidents
      const daysInMonth = new Date(yearNumForDays, monthNumForDays, 0).getDate(); // Get last day of month
      console.log(`Days in month: ${daysInMonth}`);
      
      // Build date series using a simpler approach with a temporary table or subquery
      // Generate dates from 1 to daysInMonth using a numbers table approach
      let dateSelects = [];
      for (let day = 1; day <= daysInMonth; day++) {
        const monthStr = monthNumForDays.toString().padStart(2, '0');
        const dayStr = day.toString().padStart(2, '0');
        dateSelects.push(`SELECT '${yearNumForDays}-${monthStr}-${dayStr}' as period_date`);
      }
      
      query = `
        SELECT
          ds.period_date as period,
          COALESCE(COUNT(ir.incident_id), 0) as total_incidents,
          COALESCE(SUM(CASE WHEN ir.status = 'resolved' THEN 1 ELSE 0 END), 0) as resolved_incidents,
          COALESCE(SUM(CASE WHEN ir.priority_level = 'high' OR ir.priority_level = 'critical' THEN 1 ELSE 0 END), 0) as high_priority_incidents
        FROM (
          ${dateSelects.join(' UNION ALL ')}
        ) ds
        LEFT JOIN incident_reports ir ON DATE(ir.date_reported) = DATE(ds.period_date)
        GROUP BY ds.period_date
        ORDER BY ds.period_date ASC
      `;
      finalQueryParams = []; // No parameters needed since we're using string interpolation for dates
    } else if (monthNumForDays && monthNumForDays > 0 && monthNumForDays <= 12 && yearNumForDays && dayNumForDays && dayNumForDays > 0) {
      // Specific day selected - still generate all days but filter to that day
      console.log(`✓ Specific day selected: ${dayNumForDays} in month ${monthNumForDays}, year ${yearNumForDays}`);
      const daysInMonth = new Date(yearNumForDays, monthNumForDays, 0).getDate();
      let dateSelects = [];
      for (let d = 1; d <= daysInMonth; d++) {
        const monthStr = monthNumForDays.toString().padStart(2, '0');
        const dayStr = d.toString().padStart(2, '0');
        dateSelects.push(`SELECT '${yearNumForDays}-${monthStr}-${dayStr}' as period_date`);
      }
      
      query = `
        SELECT
          ds.period_date as period,
          COALESCE(COUNT(ir.incident_id), 0) as total_incidents,
          COALESCE(SUM(CASE WHEN ir.status = 'resolved' THEN 1 ELSE 0 END), 0) as resolved_incidents,
          COALESCE(SUM(CASE WHEN ir.priority_level = 'high' OR ir.priority_level = 'critical' THEN 1 ELSE 0 END), 0) as high_priority_incidents
        FROM (
          ${dateSelects.join(' UNION ALL ')}
        ) ds
        LEFT JOIN incident_reports ir ON DATE(ir.date_reported) = DATE(ds.period_date)
          AND YEAR(ir.date_reported) = ${yearNumForDays} AND MONTH(ir.date_reported) = ${monthNumForDays} AND DAY(ir.date_reported) = ${dayNumForDays}
        WHERE DAY(ds.period_date) = ${dayNumForDays}
        GROUP BY ds.period_date
        ORDER BY ds.period_date ASC
      `;
      finalQueryParams = [];
    } else {
      // Regular query for other cases (year only, or no date filter)
      console.log(`Using regular query - groupBy: ${groupBy}, whereClause: ${whereClause}, month: ${monthNumForDays}, day: ${dayNumForDays}`);
      query = `
        SELECT
          ${groupBy} as period,
          COUNT(*) as total_incidents,
          SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved_incidents,
          SUM(CASE WHEN priority_level = 'high' OR priority_level = 'critical' THEN 1 ELSE 0 END) as high_priority_incidents
        FROM incident_reports
        ${whereClause}
        GROUP BY ${groupBy}
        ORDER BY ${groupBy} ASC
      `;
      finalQueryParams = queryParams;
    }
    
    console.log(`Executing query: ${query}`);
    console.log(`Query params:`, finalQueryParams);
    const [trendsData] = finalQueryParams.length > 0 
      ? await pool.execute(query, finalQueryParams)
      : await pool.execute(query);
    console.log(`Raw trends data for ${period}:`, trendsData);
    console.log(`Total data points returned: ${trendsData.length}`);

    // Format the response data with better period labels
    const formattedData = trendsData.map(row => {
      let formattedPeriod = row.period;
      
      // Determine if we're showing daily data (based on month filter or period parameter)
      const monthNum = month ? parseInt(month) : null;
      const isDailyGrouping = (monthNum && monthNum > 0) || period === 'days';
      const isWeeklyGrouping = period === 'weeks';
      const isMonthlyGrouping = !isDailyGrouping && !isWeeklyGrouping;
      
      // Format period labels for better readability
      if (isDailyGrouping) {
        // Convert YYYY-MM-DD to readable format
        try {
          // Handle both YYYY-MM-DD and YYYYMMDD formats
          let dateStr = row.period;
          if (typeof dateStr === 'number') {
            // Convert YYYYMMDD to YYYY-MM-DD
            dateStr = dateStr.toString();
            if (dateStr.length === 8) {
              dateStr = `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
            }
          }
          
          const date = new Date(dateStr);
          if (isNaN(date.getTime())) {
            // Fallback if date parsing fails
            formattedPeriod = row.period;
          } else {
            formattedPeriod = date.toLocaleDateString('en-US', { 
              month: 'short', 
              day: 'numeric',
              year: 'numeric'
            });
          }
        } catch (error) {
          // Fallback if date parsing fails
          formattedPeriod = row.period;
        }
      } else if (isWeeklyGrouping) {
        // Convert YYYYWW to "Week X, YYYY" format
        const year = Math.floor(row.period / 100);
        const week = row.period % 100;
        formattedPeriod = `Week ${week}, ${year}`;
      } else if (isMonthlyGrouping) {
        // Convert YYYY-MM to readable format or handle if it's already a date string
        try {
          let periodStr = row.period.toString();
          // Check if it's already in YYYY-MM format
          if (periodStr.match(/^\d{4}-\d{2}$/)) {
            const date = new Date(periodStr + '-01');
            formattedPeriod = date.toLocaleDateString('en-US', { 
              month: 'short', 
              year: 'numeric'
            });
          } else {
            // Try parsing as date string
            const date = new Date(periodStr);
            if (!isNaN(date.getTime())) {
              formattedPeriod = date.toLocaleDateString('en-US', { 
                month: 'short', 
                year: 'numeric'
              });
            } else {
              formattedPeriod = periodStr;
            }
          }
        } catch (error) {
          formattedPeriod = row.period;
        }
      }
      
      return {
        period: formattedPeriod,
        total_incidents: row.total_incidents,
        resolved_incidents: row.resolved_incidents,
        high_priority_incidents: row.high_priority_incidents
      };
    });
    
    console.log(`Formatted data for ${period}:`, formattedData);

    // Add helpful info about the data
    let dataInfo = '';
    if (monthNumForDays && monthNumForDays > 0 && yearNumForDays && isAllDays) {
      const daysInMonth = new Date(yearNumForDays, monthNumForDays, 0).getDate();
      dataInfo = `Showing all ${daysInMonth} days in ${new Date(yearNumForDays, monthNumForDays - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}. Total data points: ${formattedData.length}`;
    } else if (monthNumForDays && monthNumForDays > 0 && yearNumForDays && dayNumForDays && dayNumForDays > 0) {
      dataInfo = `Showing specific day ${dayNumForDays} in ${new Date(yearNumForDays, monthNumForDays - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}.`;
    } else {
      dataInfo = `Incident trends for the last ${limit} ${period}. Data grouped by ${period === 'days' ? 'days' : period === 'weeks' ? 'weeks' : 'months'}. Total data points: ${formattedData.length}`;
    }
    
    res.json({
      success: true,
      trendsData: formattedData,
      period: period,
      limit: parseInt(limit),
      totalDataPoints: formattedData.length,
      note: dataInfo
    });

  } catch (error) {
    console.error('Error fetching monthly incident trends:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch monthly incident trends',
      error: error.message
    });
  }
});

// GET - Seasonal patterns data for clustered column chart
// Analyzes incident patterns across different seasons and time periods
router.get('/seasonal-patterns', async (req, res) => {
  try {
    console.log('Fetching seasonal patterns data...');

    // Define seasonal periods based on Philippine climate and holidays
    const seasonalData = await pool.execute(`
      SELECT
        incident_type,
        MONTH(date_reported) as month,
        YEAR(date_reported) as year,
        COUNT(*) as count
      FROM incident_reports
      WHERE date_reported >= DATE_SUB(NOW(), INTERVAL 2 YEAR)
      GROUP BY incident_type, YEAR(date_reported), MONTH(date_reported)
      ORDER BY year DESC, month DESC, incident_type
    `);

    const incidents = seasonalData[0];

    // Categorize incidents by season and type
    const seasonalAnalysis = {
      // Rainy season (June to November) - typically higher flood incidents
      rainySeason: {
        floods: 0,
        otherIncidents: 0,
        total: 0
      },
      // Summer season (March to May) - typically higher fire incidents
      summerSeason: {
        fires: 0,
        otherIncidents: 0,
        total: 0
      },
      // Holiday periods (December, Holy Week) - typically higher accident incidents
      holidayPeriods: {
        accidents: 0,
        otherIncidents: 0,
        total: 0
      },
      // Regular periods (baseline)
      regularPeriods: {
        allIncidents: 0,
        total: 0
      }
    };

    // Process incidents by month and categorize
    incidents.forEach(incident => {
      const month = incident.month;
      const type = incident.type || incident.incident_type;
      const count = incident.count;

      // Rainy season months (June to November)
      if ([6, 7, 8, 9, 10, 11].includes(month)) {
        seasonalAnalysis.rainySeason.total += count;
        if (type.toLowerCase().includes('flood')) {
          seasonalAnalysis.rainySeason.floods += count;
        } else {
          seasonalAnalysis.rainySeason.otherIncidents += count;
        }
      }
      // Summer months (March to May)
      else if ([3, 4, 5].includes(month)) {
        seasonalAnalysis.summerSeason.total += count;
        if (type.toLowerCase().includes('fire')) {
          seasonalAnalysis.summerSeason.fires += count;
        } else {
          seasonalAnalysis.summerSeason.otherIncidents += count;
        }
      }
      // Holiday periods (December, April for Holy Week)
      else if (month === 12 || month === 4) {
        seasonalAnalysis.holidayPeriods.total += count;
        if (type.toLowerCase().includes('accident') || type.toLowerCase().includes('traffic')) {
          seasonalAnalysis.holidayPeriods.accidents += count;
        } else {
          seasonalAnalysis.holidayPeriods.otherIncidents += count;
        }
      }
      // Regular periods (January, February)
      else {
        seasonalAnalysis.regularPeriods.total += count;
        seasonalAnalysis.regularPeriods.allIncidents += count;
      }
    });

    // Transform data for clustered column chart
    const chartData = [
      {
        period: 'Rainy Season',
        floods: seasonalAnalysis.rainySeason.floods,
        otherIncidents: seasonalAnalysis.rainySeason.otherIncidents,
        total: seasonalAnalysis.rainySeason.total
      },
      {
        period: 'Summer Season',
        fires: seasonalAnalysis.summerSeason.fires,
        otherIncidents: seasonalAnalysis.summerSeason.otherIncidents,
        total: seasonalAnalysis.summerSeason.total
      },
      {
        period: 'Holiday Periods',
        accidents: seasonalAnalysis.holidayPeriods.accidents,
        otherIncidents: seasonalAnalysis.holidayPeriods.otherIncidents,
        total: seasonalAnalysis.holidayPeriods.total
      },
      {
        period: 'Regular Periods',
        allIncidents: seasonalAnalysis.regularPeriods.allIncidents,
        total: seasonalAnalysis.regularPeriods.total
      }
    ];

    res.json({
      success: true,
      seasonalData: chartData,
      analysis: seasonalAnalysis,
      note: 'Seasonal analysis based on Philippine climate patterns and holiday periods. Data covers the last 2 years.',
      totalIncidentsAnalyzed: incidents.reduce((sum, inc) => sum + inc.count, 0)
    });

  } catch (error) {
    console.error('Error fetching seasonal patterns data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch seasonal patterns data',
      error: error.message
    });
  }
});

// GET - Individual incident response times
// Returns each incident with its response time
router.get('/response-time-individual', async (req, res) => {
  try {
    console.log('Fetching individual incident response times...');

    const { limit = 200, period = 'months', last = 12, year, month, day } = req.query;
    const incidentDateFilter = buildDateFilter(year, month, day);
    
    // Calculate date filter based on period and last
    const lastNum = parseInt(last) || (period === 'days' ? 7 : 12);
    const maxLimit = period === 'days' ? 30 : 24;
    const finalLastNum = Math.min(Math.max(lastNum, 1), maxLimit); // Ensure it's between 1 and max
    const intervalUnit = period === 'days' ? 'DAY' : 'MONTH';

    // Build WHERE clause
    let whereConditions = ["status != 'pending'", "updated_at > date_reported"];
    let queryParams = [];
    
    if (incidentDateFilter.params.length > 0) {
      // Use specific date filters if provided
      whereConditions.push(incidentDateFilter.whereClause.replace('WHERE ', ''));
      queryParams.push(...incidentDateFilter.params);
    } else {
      // Use relative date filter if no specific date provided
      whereConditions.push(`date_reported >= DATE_SUB(NOW(), INTERVAL ? ${intervalUnit})`);
      queryParams.push(finalLastNum);
    }
    
    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

    // Get individual incidents with their response times
    const query = `
      SELECT
        incident_id,
        incident_type,
        date_reported,
        updated_at,
        status,
        TIMESTAMPDIFF(MINUTE, date_reported, updated_at) as response_time_minutes,
        TIMESTAMPDIFF(HOUR, date_reported, updated_at) as response_time_hours,
        TIMESTAMPDIFF(DAY, date_reported, updated_at) as response_time_days
      FROM incident_reports
      ${whereClause}
      ORDER BY date_reported DESC
      LIMIT ?
    `;
    const [incidentData] = await pool.execute(query, [...queryParams, parseInt(limit)]);

    // Format the response data
    const formattedData = incidentData.map(row => {
      const minutes = Math.round(row.response_time_minutes || 0);
      const hours = row.response_time_hours ? parseFloat(row.response_time_hours.toFixed(2)) : 0;
      const days = row.response_time_days || 0;
      
      return {
        incident_id: row.incident_id,
        incident_type: row.incident_type,
        date_reported: row.date_reported,
        updated_at: row.updated_at,
        status: row.status,
        response_time_minutes: minutes,
        response_time_hours: hours,
        response_time_days: days,
        // For chart display: use days if >= 24 hours, otherwise use hours
        display_value: hours >= 24 ? parseFloat((hours / 24).toFixed(2)) : hours,
        display_unit: hours >= 24 ? 'days' : 'hours'
      };
    });

    res.json({
      success: true,
      incidents: formattedData,
      total: formattedData.length,
      note: 'Individual incident response times. Response time calculated as time from report submission to first status update. Only includes incidents responded to in the last 12 months.'
    });

  } catch (error) {
    console.error('Error fetching individual incident response times:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch individual incident response times',
      error: error.message
    });
  }
});

// GET - Response time per incident type
// Calculates average response time (in minutes) for each incident type
router.get('/response-time-by-type', async (req, res) => {
  try {
    console.log('Fetching response time per incident type...');

    const { period = 'months', last = 12, year, month, day } = req.query;
    const incidentDateFilter = buildDateFilter(year, month, day);
    
    // Calculate date filter based on period and last
    const lastNum = parseInt(last) || (period === 'days' ? 7 : 12);
    const maxLimit = period === 'days' ? 30 : 24;
    const finalLastNum = Math.min(Math.max(lastNum, 1), maxLimit); // Ensure it's between 1 and max
    const intervalUnit = period === 'days' ? 'DAY' : 'MONTH';

    // Build WHERE clause
    let whereConditions = ["status != 'pending'", "updated_at > date_reported"];
    let queryParams = [];
    
    if (incidentDateFilter.params.length > 0) {
      // Use year filter if provided
      whereConditions.push(incidentDateFilter.whereClause.replace('WHERE ', ''));
      queryParams.push(...incidentDateFilter.params);
    } else {
      // Use relative date filter if no year provided
      whereConditions.push(`date_reported >= DATE_SUB(NOW(), INTERVAL ? ${intervalUnit})`);
      queryParams.push(finalLastNum);
    }
    
    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

    // Calculate response time for incidents that have been responded to
    // Response time = time from date_reported to updated_at (when status changed from pending)
    // Only include incidents that are not in 'pending' status
    const query = `
      SELECT
        incident_type,
        COUNT(*) as incident_count,
        AVG(TIMESTAMPDIFF(MINUTE, date_reported, updated_at)) as avg_response_time_minutes,
        MIN(TIMESTAMPDIFF(MINUTE, date_reported, updated_at)) as min_response_time_minutes,
        MAX(TIMESTAMPDIFF(MINUTE, date_reported, updated_at)) as max_response_time_minutes,
        AVG(CASE 
          WHEN status = 'resolved' THEN TIMESTAMPDIFF(MINUTE, date_reported, updated_at)
          ELSE NULL
        END) as avg_resolution_time_minutes
      FROM incident_reports
      ${whereClause}
      GROUP BY incident_type
      ORDER BY avg_response_time_minutes DESC
    `;
    const [responseTimeData] = await pool.execute(query, queryParams);

    // Format the response data
    const formattedData = responseTimeData.map(row => {
      const avgMinutes = Math.round(row.avg_response_time_minutes || 0);
      const avgHours = avgMinutes ? parseFloat((avgMinutes / 60).toFixed(2)) : 0;
      const avgDays = avgHours >= 24 ? parseFloat((avgHours / 24).toFixed(2)) : 0;
      
      return {
        incident_type: row.incident_type,
        incident_count: row.incident_count,
        avg_response_time_minutes: avgMinutes,
        min_response_time_minutes: Math.round(row.min_response_time_minutes || 0),
        max_response_time_minutes: Math.round(row.max_response_time_minutes || 0),
        avg_resolution_time_minutes: row.avg_resolution_time_minutes ? Math.round(row.avg_resolution_time_minutes) : null,
        avg_response_time_hours: avgHours,
        avg_response_time_days: avgDays,
        // For chart display: use days if >= 24 hours, otherwise use hours
        display_value: avgHours >= 24 ? avgDays : avgHours,
        display_unit: avgHours >= 24 ? 'days' : 'hours'
      };
    });

    res.json({
      success: true,
      responseTimeData: formattedData,
      note: 'Response time calculated as time from report submission to first status update. Only includes incidents responded to in the last 12 months.',
      totalIncidents: formattedData.reduce((sum, item) => sum + item.incident_count, 0)
    });

  } catch (error) {
    console.error('Error fetching response time per incident type:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch response time per incident type',
      error: error.message
    });
  }
});

module.exports = router;
