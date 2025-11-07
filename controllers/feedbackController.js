const pool = require('../config/conn');
const jwt = require('jsonwebtoken');
const { getClientIP } = require('../utils/ipUtils');

// Submit feedback
const submitFeedback = async (req, res) => {
    try {
        const { message, rating } = req.body;

        if (!message || !message.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Feedback message is required'
            });
        }

        // Validate rating if provided
        if (rating !== undefined && rating !== null) {
            const ratingNum = parseInt(rating);
            if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
                return res.status(400).json({
                    success: false,
                    message: 'Rating must be a number between 1 and 5'
                });
            }
        }

        // Get user info from token
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Authentication token required'
            });
        }

        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        } catch (tokenError) {
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired token'
            });
        }

        // Determine user type and ID
        let generalUserId = null;
        let staffId = null;

        // Fix: get userType from decoded token instead of req.userType
        const userType = decoded.type || req.userType;

        if (userType === 'user') {
            generalUserId = decoded.user_id || decoded.id || null;
        } else if (userType === 'staff') {
            staffId = decoded.id || null;
        } else {
            return res.status(400).json({
                success: false,
                message: 'Invalid user type'
            });
        }

        // Insert feedback into database
        const [result] = await pool.execute(
            `INSERT INTO feedback (general_user_id, staff_id, message, rating, created_at)
             VALUES (?, ?, ?, ?, NOW())`,
            [generalUserId, staffId, message.trim(), rating || null]
        );

        // Log feedback submission activity
        try {
            const clientIP = getClientIP(req);
            const userType = decoded.type;
            const userId = userType === 'user' ? (decoded.user_id || decoded.id) : decoded.id;
            const userEmail = decoded.email;

            if (userType === 'user') {
                await pool.execute(`
                    INSERT INTO activity_logs (general_user_id, action, details, ip_address, created_at)
                    VALUES (?, 'feedback_submit', ?, ?, NOW())
                `, [userId, `User ${userEmail} submitted feedback`, clientIP]);
            } else if (userType === 'staff') {
                await pool.execute(`
                    INSERT INTO activity_logs (staff_id, action, details, ip_address, created_at)
                    VALUES (?, 'feedback_submit', ?, ?, NOW())
                `, [userId, `Staff ${userEmail} submitted feedback`, clientIP]);
            }
            console.log('✅ Activity logged: feedback_submit');
        } catch (logError) {
            console.error('❌ Failed to log feedback submission activity:', logError.message);
            // Don't fail the main operation if logging fails
        }

        console.log('Feedback submitted successfully, ID:', result.insertId);
        res.status(201).json({
            success: true,
            message: 'Feedback submitted successfully',
            feedbackId: result.insertId
        });

    } catch (error) {
        console.error('Submit feedback error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

const getFeedback = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        // Get feedback with user information
        const [feedbackRows] = await pool.execute(`
            SELECT
                f.id,
                f.message,
                f.rating,
                f.created_at,
                f.updated_at,
                CASE
                    WHEN f.general_user_id IS NOT NULL THEN JSON_OBJECT(
                        'id', gu.user_id,
                        'name', CONCAT(gu.first_name, ' ', gu.last_name),
                        'email', gu.email,
                        'type', 'user'
                    )
                    WHEN f.staff_id IS NOT NULL THEN JSON_OBJECT(
                        'id', s.id,
                        'name', s.name,
                        'email', s.email,
                        'type', 'staff',
                        'position', s.position,
                        'department', s.department
                    )
                    ELSE NULL
                END as user_info
            FROM feedback f
            LEFT JOIN general_users gu ON f.general_user_id = gu.user_id
            LEFT JOIN staff s ON f.staff_id = s.id
            ORDER BY f.created_at DESC
            LIMIT ? OFFSET ?
        `, [parseInt(limit), offset]);

        // Parse user_info JSON strings to objects
        const feedback = feedbackRows.map(row => ({
            ...row,
            user_info: JSON.parse(row.user_info)
        }));

        // Get total count
        const [countResult] = await pool.execute(`
            SELECT COUNT(*) as total FROM feedback f
        `);

        const total = countResult[0].total;
        const totalPages = Math.ceil(total / limit);

        res.status(200).json({
            success: true,
            feedback,
            pagination: {
                currentPage: parseInt(page),
                totalPages,
                totalItems: total,
                itemsPerPage: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('Get feedback error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};



module.exports = {
    submitFeedback,
    getFeedback
};
