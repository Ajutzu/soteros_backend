const express = require('express');
const router = express.Router();
const pool = require('../config/conn');

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
    
    // Get total counts
    const [userStats] = await pool.execute(`
      SELECT
        COUNT(*) as total_users,
        SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as active_users,
        SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) as new_users_month
      FROM general_users
      WHERE status = 1
    `);

    const [staffStats] = await pool.execute(`
      SELECT
        COUNT(*) as total_staff,
        SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as active_staff
      FROM staff
      WHERE status = 1
    `);

    const [incidentStats] = await pool.execute(`
      SELECT
        COUNT(*) as total_incidents,
        SUM(CASE WHEN status = 'pending' OR status = 'in_progress' THEN 1 ELSE 0 END) as active_incidents,
        SUM(CASE WHEN priority_level = 'high' OR priority_level = 'critical' THEN 1 ELSE 0 END) as high_priority_incidents,
        SUM(CASE WHEN date_reported >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as incidents_this_week
      FROM incident_reports
    `);

    const [alertStats] = await pool.execute(`
      SELECT
        COUNT(*) as total_alerts,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_alerts,
        SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as alerts_this_week
      FROM alerts
    `);
    
    // Get recent activity (using incident reports as activity proxy)
    const [recentActivity] = await pool.execute(`
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

    // Get incident trends (last 7 days)
    const [incidentTrends] = await pool.execute(`
      SELECT
        DATE(date_reported) as date,
        COUNT(*) as count
      FROM incident_reports
      WHERE date_reported >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY DATE(date_reported)
      ORDER BY date ASC
    `);

    // Get user registration trends (last 30 days)
    const [userTrends] = await pool.execute(`
      SELECT
        DATE(created_at) as date,
        COUNT(*) as count
      FROM general_users
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      AND status = 1
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `);
    
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
    
    // Get user type distribution
    const [userTypeStats] = await pool.execute(`
      SELECT user_type, COUNT(*) as user_count
      FROM general_users
      WHERE status = 1
      GROUP BY user_type
      ORDER BY user_count DESC
    `);

    // Get incident types distribution
    const [incidentTypes] = await pool.execute(`
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
    
    // Get incident trends for last 30 days
    const [incidentTrends30Days] = await pool.execute(`
      SELECT
        DATE(date_reported) as date,
        COUNT(*) as count
      FROM incident_reports
      WHERE date_reported >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY DATE(date_reported)
      ORDER BY date ASC
    `);

    // Get user registration trends for last 90 days
    const [userTrends90Days] = await pool.execute(`
      SELECT
        DATE(created_at) as date,
        COUNT(*) as count
      FROM general_users
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
      AND status = 1
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `);

    // Get incident status distribution
    const [incidentStatus] = await pool.execute(`
      SELECT 
        status,
        COUNT(*) as count
      FROM incident_reports
      GROUP BY status
      ORDER BY count DESC
    `);

    // Get incident priority distribution
    const [incidentPriority] = await pool.execute(`
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

    // Get monthly incident summary for last 12 months
    const [monthlyIncidents] = await pool.execute(`
      SELECT
        DATE_FORMAT(date_reported, '%Y-%m') as month,
        COUNT(*) as total_incidents,
        SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved_incidents,
        SUM(CASE WHEN priority_level = 'high' OR priority_level = 'critical' THEN 1 ELSE 0 END) as high_priority_incidents
      FROM incident_reports
      WHERE date_reported >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
      GROUP BY DATE_FORMAT(date_reported, '%Y-%m')
      ORDER BY month ASC
    `);

    // Get peak hours analysis (incidents by hour of day) with consecutive dates and times
    // Note: MIN/MAX should already match the hour bucket since we group by HOUR(date_reported)
    // If there's a mismatch, it's likely a timezone conversion issue in the frontend
    const [peakHoursData] = await pool.execute(`
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
    `);

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

    // Get all incidents with their descriptions to extract barangay information
    const [incidentData] = await pool.execute(`
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

    const { period = 'months', limit = 12 } = req.query;
    console.log(`Monthly trends request - Period: ${period}, Limit: ${limit}`);
    let dateFormat, groupBy, dateFilter;

    switch (period) {
      case 'days':
        dateFormat = '%Y-%m-%d';
        groupBy = 'DATE(date_reported)';
        dateFilter = `DATE_SUB(NOW(), INTERVAL ${Math.min(parseInt(limit), 30)} DAY)`;
        break;
      case 'weeks':
        dateFormat = '%Y-W%U';
        groupBy = 'YEARWEEK(date_reported, 1)';
        dateFilter = `DATE_SUB(NOW(), INTERVAL ${Math.min(parseInt(limit), 52)} WEEK)`;
        break;
      case 'months':
      default:
        dateFormat = '%Y-%m';
        groupBy = 'DATE_FORMAT(date_reported, "%Y-%m")';
        dateFilter = `DATE_SUB(NOW(), INTERVAL ${Math.min(parseInt(limit), 24)} MONTH)`;
        break;
    }

    const query = `
      SELECT
        ${groupBy} as period,
        COUNT(*) as total_incidents,
        SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved_incidents,
        SUM(CASE WHEN priority_level = 'high' OR priority_level = 'critical' THEN 1 ELSE 0 END) as high_priority_incidents
      FROM incident_reports
      WHERE date_reported >= ${dateFilter}
      GROUP BY ${groupBy}
      ORDER BY ${groupBy} ASC
    `;
    
    console.log(`Executing query: ${query}`);
    const [trendsData] = await pool.execute(query);
    console.log(`Raw trends data for ${period}:`, trendsData);

    // Format the response data with better period labels
    const formattedData = trendsData.map(row => {
      let formattedPeriod = row.period;
      
      // Format period labels for better readability
      if (period === 'days') {
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
      } else if (period === 'weeks') {
        // Convert YYYYWW to "Week X, YYYY" format
        const year = Math.floor(row.period / 100);
        const week = row.period % 100;
        formattedPeriod = `Week ${week}, ${year}`;
      } else if (period === 'months') {
        // Convert YYYY-MM to readable format
        const date = new Date(row.period + '-01');
        formattedPeriod = date.toLocaleDateString('en-US', { 
          month: 'long', 
          year: 'numeric'
        });
      }
      
      return {
        period: formattedPeriod,
        total_incidents: row.total_incidents,
        resolved_incidents: row.resolved_incidents,
        high_priority_incidents: row.high_priority_incidents
      };
    });
    
    console.log(`Formatted data for ${period}:`, formattedData);

    res.json({
      success: true,
      trendsData: formattedData,
      period: period,
      limit: parseInt(limit),
      note: `Incident trends for the last ${limit} ${period}. Data grouped by ${period === 'days' ? 'days' : period === 'weeks' ? 'weeks' : 'months'}.`
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

// GET - Emergency Response Activities Analytics
// Provides descriptive analytics for visualizing and assessing emergency response activities
router.get('/response-activities', async (req, res) => {
  try {
    console.log('Fetching emergency response activities analytics...');

    const { period = 'months', limit = 12 } = req.query;
    console.log(`Response activities request - Period: ${period}, Limit: ${limit}`);
    
    let responseTimeAnalysis = [];
    let avgResponseTimeByPriority = [];
    let resolutionTimeAnalysis = [];
    let responseActivityTrends = [];
    let teamPerformance = [];
    let responseRate = { total_incidents: 0, responded_incidents: 0, response_rate_percentage: 0 };
    let responseTimeDistribution = [];
    let monthlyResponseSummary = [];
    
    // Determine date filter based on period
    let dateFilter;
    switch (period) {
      case 'days':
        dateFilter = `DATE_SUB(NOW(), INTERVAL ${Math.min(parseInt(limit), 90)} DAY)`;
        break;
      case 'months':
      default:
        dateFilter = `DATE_SUB(NOW(), INTERVAL ${Math.min(parseInt(limit), 24)} MONTH)`;
        break;
    }

    // 1. Response Time Analysis - Time from incident report to team/staff assignment or status change
    // Treat any status change (from pending) or update as response activity
    try {
      const [result1] = await pool.execute(`
      SELECT
        ir.incident_id,
        ir.date_reported,
        ir.priority_level,
        ir.incident_type,
        ir.status,
        COALESCE(
          (SELECT MIN(ita2.assigned_at) FROM incident_team_assignments ita2 WHERE ita2.incident_id = ir.incident_id AND ita2.status = 'active'),
          CASE WHEN ir.status != 'pending' THEN ir.updated_at ELSE ir.date_reported END
        ) as first_assigned_at,
        TIMESTAMPDIFF(MINUTE, ir.date_reported, COALESCE(
          (SELECT MIN(ita2.assigned_at) FROM incident_team_assignments ita2 WHERE ita2.incident_id = ir.incident_id AND ita2.status = 'active'),
          CASE WHEN ir.status != 'pending' THEN ir.updated_at ELSE ir.date_reported END
        )) as response_time_minutes,
        CASE
          WHEN TIMESTAMPDIFF(MINUTE, ir.date_reported, COALESCE(
            (SELECT MIN(ita2.assigned_at) FROM incident_team_assignments ita2 WHERE ita2.incident_id = ir.incident_id AND ita2.status = 'active'),
            CASE WHEN ir.status != 'pending' THEN ir.updated_at ELSE ir.date_reported END
          )) <= 15 THEN '0-15 min'
          WHEN TIMESTAMPDIFF(MINUTE, ir.date_reported, COALESCE(
            (SELECT MIN(ita2.assigned_at) FROM incident_team_assignments ita2 WHERE ita2.incident_id = ir.incident_id AND ita2.status = 'active'),
            CASE WHEN ir.status != 'pending' THEN ir.updated_at ELSE ir.date_reported END
          )) <= 30 THEN '16-30 min'
          WHEN TIMESTAMPDIFF(MINUTE, ir.date_reported, COALESCE(
            (SELECT MIN(ita2.assigned_at) FROM incident_team_assignments ita2 WHERE ita2.incident_id = ir.incident_id AND ita2.status = 'active'),
            CASE WHEN ir.status != 'pending' THEN ir.updated_at ELSE ir.date_reported END
          )) <= 60 THEN '31-60 min'
          WHEN TIMESTAMPDIFF(MINUTE, ir.date_reported, COALESCE(
            (SELECT MIN(ita2.assigned_at) FROM incident_team_assignments ita2 WHERE ita2.incident_id = ir.incident_id AND ita2.status = 'active'),
            CASE WHEN ir.status != 'pending' THEN ir.updated_at ELSE ir.date_reported END
          )) <= 120 THEN '1-2 hours'
          ELSE '2+ hours'
        END as response_time_category
      FROM incident_reports ir
      WHERE ir.status != 'pending' 
        OR ir.assigned_staff_id IS NOT NULL 
        OR ir.assigned_team_id IS NOT NULL
        OR EXISTS(SELECT 1 FROM incident_team_assignments ita2 WHERE ita2.incident_id = ir.incident_id AND ita2.status = 'active')
        OR (ir.updated_at IS NOT NULL AND ir.updated_at > ir.date_reported)
      ORDER BY ir.date_reported DESC
      `);
      responseTimeAnalysis = result1 || [];
      console.log('✅ Query 1 (Response Time Analysis) completed');
    } catch (error) {
      console.error('❌ Error in Query 1 (Response Time Analysis):', error.message);
    }

    // 2. Average Response Times by Priority Level
    try {
      const [result2] = await pool.execute(`
      SELECT
        ir.priority_level,
        COUNT(*) as total_incidents,
        AVG(
          TIMESTAMPDIFF(MINUTE, ir.date_reported, COALESCE(
            (SELECT MIN(ita2.assigned_at) FROM incident_team_assignments ita2 WHERE ita2.incident_id = ir.incident_id AND ita2.status = 'active'),
            CASE WHEN ir.status != 'pending' THEN ir.updated_at ELSE ir.date_reported END
          ))
        ) as avg_response_time_minutes,
        MIN(
          TIMESTAMPDIFF(MINUTE, ir.date_reported, COALESCE(
            (SELECT MIN(ita2.assigned_at) FROM incident_team_assignments ita2 WHERE ita2.incident_id = ir.incident_id AND ita2.status = 'active'),
            CASE WHEN ir.status != 'pending' THEN ir.updated_at ELSE ir.date_reported END
          ))
        ) as min_response_time_minutes,
        MAX(
          TIMESTAMPDIFF(MINUTE, ir.date_reported, COALESCE(
            (SELECT MIN(ita2.assigned_at) FROM incident_team_assignments ita2 WHERE ita2.incident_id = ir.incident_id AND ita2.status = 'active'),
            CASE WHEN ir.status != 'pending' THEN ir.updated_at ELSE ir.date_reported END
          ))
        ) as max_response_time_minutes
      FROM incident_reports ir
      WHERE ir.status != 'pending' 
        OR ir.assigned_staff_id IS NOT NULL 
        OR ir.assigned_team_id IS NOT NULL
        OR EXISTS(SELECT 1 FROM incident_team_assignments ita2 WHERE ita2.incident_id = ir.incident_id AND ita2.status = 'active')
        OR (ir.updated_at IS NOT NULL AND ir.updated_at > ir.date_reported)
      GROUP BY ir.priority_level
      `);
      avgResponseTimeByPriority = result2 || [];
      console.log('✅ Query 2 (Average Response Times by Priority) completed');
    } catch (error) {
      console.error('❌ Error in Query 2 (Average Response Times by Priority):', error.message);
    }

    // 3. Average Resolution Times - Time from report to resolution
    try {
      const [result3] = await pool.execute(`
      SELECT
        ir.incident_type,
        ir.priority_level,
        COUNT(*) as resolved_count,
        AVG(TIMESTAMPDIFF(HOUR, ir.date_reported, ir.updated_at)) as avg_resolution_hours,
        MIN(TIMESTAMPDIFF(HOUR, ir.date_reported, ir.updated_at)) as min_resolution_hours,
        MAX(TIMESTAMPDIFF(HOUR, ir.date_reported, ir.updated_at)) as max_resolution_hours
      FROM incident_reports ir
      WHERE ir.status IN ('resolved', 'closed')
      AND ir.updated_at IS NOT NULL
      AND ir.updated_at > ir.date_reported
      GROUP BY ir.incident_type, ir.priority_level
      `);
      resolutionTimeAnalysis = result3 || [];
      console.log('✅ Query 3 (Resolution Time Analysis) completed');
    } catch (error) {
      console.error('❌ Error in Query 3 (Resolution Time Analysis):', error.message);
    }

    // 4. Response Activity Trends - Daily response activities (last 30 days)
    try {
      const [result4] = await pool.execute(`
      SELECT
        DATE(COALESCE(
          (SELECT MIN(ita2.assigned_at) FROM incident_team_assignments ita2 WHERE ita2.incident_id = ir.incident_id AND ita2.status = 'active'),
          CASE WHEN ir.status != 'pending' THEN ir.updated_at ELSE ir.date_reported END
        )) as activity_date,
        COUNT(DISTINCT ir.incident_id) as responses_count,
        SUM(CASE WHEN ir.priority_level = 'critical' THEN 1 ELSE 0 END) as critical_responses,
        SUM(CASE WHEN ir.priority_level = 'high' THEN 1 ELSE 0 END) as high_responses,
        AVG(TIMESTAMPDIFF(MINUTE, ir.date_reported, COALESCE(
          (SELECT MIN(ita2.assigned_at) FROM incident_team_assignments ita2 WHERE ita2.incident_id = ir.incident_id AND ita2.status = 'active'),
          CASE WHEN ir.status != 'pending' THEN ir.updated_at ELSE ir.date_reported END
        ))) as avg_response_time_minutes
      FROM incident_reports ir
      WHERE (ir.status != 'pending' 
        OR ir.assigned_staff_id IS NOT NULL 
        OR ir.assigned_team_id IS NOT NULL
        OR EXISTS(SELECT 1 FROM incident_team_assignments ita WHERE ita.incident_id = ir.incident_id AND ita.status = 'active')
        OR (ir.updated_at IS NOT NULL AND ir.updated_at > ir.date_reported))
      AND COALESCE(
        (SELECT MIN(ita2.assigned_at) FROM incident_team_assignments ita2 WHERE ita2.incident_id = ir.incident_id AND ita2.status = 'active'),
        CASE WHEN ir.status != 'pending' THEN ir.updated_at ELSE ir.date_reported END
      ) >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY DATE(COALESCE(
        (SELECT MIN(ita2.assigned_at) FROM incident_team_assignments ita2 WHERE ita2.incident_id = ir.incident_id AND ita2.status = 'active'),
        CASE WHEN ir.status != 'pending' THEN ir.updated_at ELSE ir.date_reported END
      ))
      ORDER BY activity_date ASC
      `);
      responseActivityTrends = result4 || [];
      console.log('✅ Query 4 (Response Activity Trends) completed');
    } catch (error) {
      console.error('❌ Error in Query 4 (Response Activity Trends):', error.message);
    }

    // 5. Team Performance Metrics - Which teams are most active and responsive
    try {
      const [result5] = await pool.execute(`
      SELECT
        t.id as team_id,
        t.name as team_name,
        COUNT(DISTINCT ir.incident_id) as total_incidents_handled,
        SUM(CASE WHEN ir.status = 'resolved' OR ir.status = 'closed' THEN 1 ELSE 0 END) as resolved_incidents,
        AVG(TIMESTAMPDIFF(MINUTE, ir.date_reported, COALESCE(ita.assigned_at, ir.updated_at))) as avg_response_time_minutes,
        AVG(CASE 
          WHEN ir.status IN ('resolved', 'closed') 
          THEN TIMESTAMPDIFF(HOUR, ir.date_reported, ir.updated_at) 
          ELSE NULL 
        END) as avg_resolution_hours
      FROM teams t
      INNER JOIN incident_team_assignments ita ON t.id = ita.team_id AND ita.status = 'active'
      INNER JOIN incident_reports ir ON ita.incident_id = ir.incident_id
      GROUP BY t.id, t.name
      HAVING COUNT(DISTINCT ir.incident_id) > 0
      ORDER BY total_incidents_handled DESC, avg_response_time_minutes ASC
      `);
      teamPerformance = result5 || [];
      console.log('✅ Query 5 (Team Performance) completed');
    } catch (error) {
      console.error('❌ Error in Query 5 (Team Performance):', error.message);
    }

    // 6. Response Rate Analysis - Percentage of incidents that received responses
    try {
      const [result6] = await pool.execute(`
      SELECT
        COUNT(*) as total_incidents,
        SUM(CASE 
          WHEN ir.status != 'pending' 
          OR ir.assigned_staff_id IS NOT NULL 
          OR ir.assigned_team_id IS NOT NULL
          OR EXISTS(SELECT 1 FROM incident_team_assignments ita WHERE ita.incident_id = ir.incident_id AND ita.status = 'active')
          THEN 1 ELSE 0 
        END) as responded_incidents,
        ROUND(
          (SUM(CASE 
            WHEN ir.status != 'pending' 
            OR ir.assigned_staff_id IS NOT NULL 
            OR ir.assigned_team_id IS NOT NULL
            OR EXISTS(SELECT 1 FROM incident_team_assignments ita WHERE ita.incident_id = ir.incident_id AND ita.status = 'active')
            THEN 1 ELSE 0 
          END) / COUNT(*)) * 100, 
          2
        ) as response_rate_percentage
      FROM incident_reports ir
      `);
      responseRate = result6[0] || { total_incidents: 0, responded_incidents: 0, response_rate_percentage: 0 };
      console.log('✅ Query 6 (Response Rate) completed');
    } catch (error) {
      console.error('❌ Error in Query 6 (Response Rate):', error.message);
    }

    // 7. Response Time Distribution (histogram data)
    try {
      const [result7] = await pool.execute(`
      SELECT
        CASE
          WHEN TIMESTAMPDIFF(MINUTE, ir.date_reported, COALESCE(
            (SELECT MIN(ita2.assigned_at) FROM incident_team_assignments ita2 WHERE ita2.incident_id = ir.incident_id AND ita2.status = 'active'),
            CASE WHEN ir.status != 'pending' THEN ir.updated_at ELSE ir.date_reported END
          )) <= 15 THEN '0-15 min'
          WHEN TIMESTAMPDIFF(MINUTE, ir.date_reported, COALESCE(
            (SELECT MIN(ita2.assigned_at) FROM incident_team_assignments ita2 WHERE ita2.incident_id = ir.incident_id AND ita2.status = 'active'),
            CASE WHEN ir.status != 'pending' THEN ir.updated_at ELSE ir.date_reported END
          )) <= 30 THEN '16-30 min'
          WHEN TIMESTAMPDIFF(MINUTE, ir.date_reported, COALESCE(
            (SELECT MIN(ita2.assigned_at) FROM incident_team_assignments ita2 WHERE ita2.incident_id = ir.incident_id AND ita2.status = 'active'),
            CASE WHEN ir.status != 'pending' THEN ir.updated_at ELSE ir.date_reported END
          )) <= 60 THEN '31-60 min'
          WHEN TIMESTAMPDIFF(MINUTE, ir.date_reported, COALESCE(
            (SELECT MIN(ita2.assigned_at) FROM incident_team_assignments ita2 WHERE ita2.incident_id = ir.incident_id AND ita2.status = 'active'),
            CASE WHEN ir.status != 'pending' THEN ir.updated_at ELSE ir.date_reported END
          )) <= 120 THEN '1-2 hours'
          WHEN TIMESTAMPDIFF(MINUTE, ir.date_reported, COALESCE(
            (SELECT MIN(ita2.assigned_at) FROM incident_team_assignments ita2 WHERE ita2.incident_id = ir.incident_id AND ita2.status = 'active'),
            CASE WHEN ir.status != 'pending' THEN ir.updated_at ELSE ir.date_reported END
          )) <= 240 THEN '2-4 hours'
          ELSE '4+ hours'
        END as time_category,
        COUNT(*) as count
      FROM incident_reports ir
      WHERE ir.status != 'pending' 
        OR ir.assigned_staff_id IS NOT NULL 
        OR ir.assigned_team_id IS NOT NULL
        OR EXISTS(SELECT 1 FROM incident_team_assignments ita2 WHERE ita2.incident_id = ir.incident_id AND ita2.status = 'active')
        OR (ir.updated_at IS NOT NULL AND ir.updated_at > ir.date_reported)
      GROUP BY time_category
      ORDER BY 
        CASE time_category
          WHEN '0-15 min' THEN 1
          WHEN '16-30 min' THEN 2
          WHEN '31-60 min' THEN 3
          WHEN '1-2 hours' THEN 4
          WHEN '2-4 hours' THEN 5
          WHEN '4+ hours' THEN 6
        END
      `);
      responseTimeDistribution = result7 || [];
      console.log('✅ Query 7 (Response Time Distribution) completed');
    } catch (error) {
      console.error('❌ Error in Query 7 (Response Time Distribution):', error.message);
    }

    // 8. Monthly Response Activities Summary (with period filter)
    try {
      let dateFormat, groupBy;
      
      switch (period) {
        case 'days':
          dateFormat = '%Y-%m-%d';
          groupBy = 'DATE(COALESCE(' +
            '(SELECT MIN(ita2.assigned_at) FROM incident_team_assignments ita2 WHERE ita2.incident_id = ir.incident_id AND ita2.status = \'active\'), ' +
            'CASE WHEN ir.status != \'pending\' THEN ir.updated_at ELSE ir.date_reported END))';
          break;
        case 'months':
        default:
          dateFormat = '%Y-%m';
          groupBy = 'DATE_FORMAT(COALESCE(' +
            '(SELECT MIN(ita2.assigned_at) FROM incident_team_assignments ita2 WHERE ita2.incident_id = ir.incident_id AND ita2.status = \'active\'), ' +
            'CASE WHEN ir.status != \'pending\' THEN ir.updated_at ELSE ir.date_reported END), \'%Y-%m\')';
          break;
      }
      
      const query = `
      SELECT
        ${groupBy} as period,
        COUNT(DISTINCT ir.incident_id) as total_responses,
        SUM(CASE WHEN ir.status = 'resolved' OR ir.status = 'closed' THEN 1 ELSE 0 END) as resolved_count,
        AVG(TIMESTAMPDIFF(MINUTE, ir.date_reported, COALESCE(
          (SELECT MIN(ita2.assigned_at) FROM incident_team_assignments ita2 WHERE ita2.incident_id = ir.incident_id AND ita2.status = 'active'),
          CASE WHEN ir.status != 'pending' THEN ir.updated_at ELSE ir.date_reported END
        ))) as avg_response_time_minutes,
        AVG(CASE 
          WHEN ir.status IN ('resolved', 'closed') 
          THEN TIMESTAMPDIFF(HOUR, ir.date_reported, ir.updated_at) 
          ELSE NULL 
        END) as avg_resolution_hours
      FROM incident_reports ir
      WHERE (ir.status != 'pending' 
        OR ir.assigned_staff_id IS NOT NULL 
        OR ir.assigned_team_id IS NOT NULL
        OR EXISTS(SELECT 1 FROM incident_team_assignments ita2 WHERE ita2.incident_id = ir.incident_id AND ita2.status = 'active')
        OR (ir.updated_at IS NOT NULL AND ir.updated_at > ir.date_reported))
      AND COALESCE(
        (SELECT MIN(ita2.assigned_at) FROM incident_team_assignments ita2 WHERE ita2.incident_id = ir.incident_id AND ita2.status = 'active'),
        CASE WHEN ir.status != 'pending' THEN ir.updated_at ELSE ir.date_reported END
      ) >= ${dateFilter}
      GROUP BY ${groupBy}
      ORDER BY ${groupBy} ASC
      `;
      
      const [result8] = await pool.execute(query);
      
      // Format the response data
      const formattedData = result8.map(row => {
        let formattedPeriod = row.period;
        
        if (period === 'days') {
          try {
            let dateStr = row.period;
            if (typeof dateStr === 'number') {
              dateStr = dateStr.toString();
              if (dateStr.length === 8) {
                dateStr = `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
              }
            }
            const date = new Date(dateStr);
            if (!isNaN(date.getTime())) {
              formattedPeriod = date.toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric'
              });
            }
          } catch (error) {
            formattedPeriod = row.period;
          }
        } else if (period === 'months') {
          const date = new Date(row.period + '-01');
          formattedPeriod = date.toLocaleDateString('en-US', { 
            month: 'short', 
            year: 'numeric'
          });
        }
        
        return {
          period: formattedPeriod,
          month: row.period, // Keep original for backward compatibility
          total_responses: row.total_responses,
          resolved_count: row.resolved_count,
          avg_response_time_minutes: row.avg_response_time_minutes,
          avg_resolution_hours: row.avg_resolution_hours
        };
      });
      
      monthlyResponseSummary = formattedData || [];
      console.log('✅ Query 8 (Monthly Response Summary) completed');
    } catch (error) {
      console.error('❌ Error in Query 8 (Monthly Response Summary):', error.message);
    }

    res.json({
      success: true,
      responseActivities: {
        responseTimeAnalysis: responseTimeAnalysis,
        avgResponseTimeByPriority: avgResponseTimeByPriority,
        resolutionTimeAnalysis: resolutionTimeAnalysis,
        responseActivityTrends: responseActivityTrends,
        teamPerformance: teamPerformance,
        responseRate: responseRate,
        responseTimeDistribution: responseTimeDistribution,
        monthlyResponseSummary: monthlyResponseSummary
      },
      note: 'Emergency response activities analytics include response times, resolution times, team performance, and activity trends.'
    });

  } catch (error) {
    console.error('Error fetching emergency response activities analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch emergency response activities analytics',
      error: error.message
    });
  }
});

module.exports = router;
