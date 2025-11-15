
const pool = require('../config/conn');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sendPasswordResetOTP, sendEmailVerificationOTP } = require('../services/emailService');
const { generateOTP, storeOTP, verifyOTP: verifyOTPFromStore, deleteOTP } = require('../utils/otpStore');
const { checkAccountLockout, recordFailedAttempt, clearFailedAttempts, getClientIP } = require('../middleware/accountLockout');
const { validatePasswordStrength, validateEmail } = require('../middleware/inputSanitizer');
const NotificationService = require('../services/notificationService');

// Note: getClientIP is now imported from accountLockout middleware

// Login for general users
const loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validate input
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email and password are required'
            });
        }

        // Validate email format
        if (!validateEmail(email)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid email format'
            });
        }

        const clientIP = getClientIP(req);

        // Check account lockout status
        const lockoutStatus = await checkAccountLockout(email, clientIP);
        if (lockoutStatus.locked) {
            const lockoutMinutes = Math.ceil((lockoutStatus.lockoutUntil.getTime() - Date.now()) / 60000);
            return res.status(429).json({
                success: false,
                message: `Account locked due to too many failed login attempts. Please try again after ${lockoutMinutes} minute(s).`,
                lockoutUntil: lockoutStatus.lockoutUntil
            });
        }

        // Check if user exists in general_users table
        const [users] = await pool.execute(
            'SELECT * FROM general_users WHERE email = ?',
            [email]
        );

        if (users.length === 0) {
            // Record failed attempt
            await recordFailedAttempt(email, clientIP);
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }

        const user = users[0];

        // Check if email is verified (status = 0 means unverified)
        if (user.status === 0) {
            return res.status(403).json({
                success: false,
                message: 'Please verify your email address before logging in. Check your inbox for the verification code.',
                requiresVerification: true
            });
        }

        // Check if account is active (status = 1 means active/verified)
        if (user.status !== 1) {
            await recordFailedAttempt(email, clientIP);
            
            // Provide specific message based on status
            let message = 'Account is inactive. Please contact support.';
            if (user.status === 2) {
                message = 'Your account has been deactivated by an administrator. Please contact support.';
            } else if (user.status === -1) {
                message = 'Your account has been suspended. Please contact support.';
            }
            
            return res.status(401).json({
                success: false,
                message: message,
                remainingAttempts: lockoutStatus.remainingAttempts - 1
            });
        }

        // SECURITY: Reject plain text passwords - only accept bcrypt hashed passwords
        if (!user.password.startsWith('$2y$') && !user.password.startsWith('$2b$') && !user.password.startsWith('$2a$')) {
            // This is a security issue - password must be hashed
            if (process.env.NODE_ENV !== 'development') {
                await recordFailedAttempt(email, clientIP);
                return res.status(401).json({
                    success: false,
                    message: 'Invalid email or password',
                    remainingAttempts: lockoutStatus.remainingAttempts - 1
                });
            }
            // In development, warn but allow (remove this in production)
            console.warn('⚠️ SECURITY WARNING: User has plain text password. This should be migrated to bcrypt hash.');
        }

        // Convert PHP bcrypt format ($2y$) to Node.js format ($2b$) if needed
        const hashToCompare = user.password.replace(/^\$2y\$/, '$2b$');
        const isPasswordValid = await bcrypt.compare(password, hashToCompare);

        if (!isPasswordValid) {
            // Record failed attempt
            const attemptResult = await recordFailedAttempt(email, clientIP);
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password',
                remainingAttempts: attemptResult.remainingAttempts
            });
        }

        // Clear failed attempts on successful login
        await clearFailedAttempts(email, clientIP);

        // Log successful login activity
        try {
            await pool.execute(`
                INSERT INTO activity_logs (general_user_id, action, details, ip_address, created_at)
                VALUES (?, 'user_login', ?, ?, NOW())
            `, [user.user_id, `User ${email} logged in successfully`, clientIP]);
            console.log('✅ Activity logged: user_login');
        } catch (logError) {
            console.error('❌ Failed to log user login activity:', logError.message);
            // Don't fail the main operation if logging fails
        }

        // Remove password from response and map to camelCase
        const { password: _, ...userWithoutPassword } = user;

        // Map database fields to camelCase for frontend
        const mappedUser = {
            userId: userWithoutPassword.user_id,
            firstName: userWithoutPassword.first_name,
            lastName: userWithoutPassword.last_name,
            email: userWithoutPassword.email,
            userType: userWithoutPassword.user_type,
            department: userWithoutPassword.department,
            college: userWithoutPassword.college,
            profilePicture: userWithoutPassword.profile_picture,
            createdAt: userWithoutPassword.created_at,
            updatedAt: userWithoutPassword.updated_at,
            status: userWithoutPassword.status
        };

        // Generate JWT token
        if (!process.env.JWT_SECRET) {
            console.error('JWT_SECRET environment variable is not set');
            return res.status(500).json({
                success: false,
                message: 'Server configuration error'
            });
        }

        const token = jwt.sign(
            {
                id: user.user_id,
                email: user.email,
                role: user.user_type,
                type: 'user'
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        console.log('User login successful:', email);
        res.status(200).json({
            success: true,
            message: 'Login successful',
            token,
            user: mappedUser
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// Login for admin users
const loginAdmin = async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validate input
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email and password are required'
            });
        }

        // Validate email format
        if (!validateEmail(email)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid email format'
            });
        }

        const clientIP = getClientIP(req);

        // Check account lockout status
        const lockoutStatus = await checkAccountLockout(email, clientIP);
        if (lockoutStatus.locked) {
            const lockoutMinutes = Math.ceil((lockoutStatus.lockoutUntil.getTime() - Date.now()) / 60000);
            return res.status(429).json({
                success: false,
                message: `Account locked due to too many failed login attempts. Please try again after ${lockoutMinutes} minute(s).`,
                lockoutUntil: lockoutStatus.lockoutUntil
            });
        }

        // Check if admin exists
        const [admins] = await pool.execute(
            'SELECT * FROM admin WHERE email = ? AND status = "active"',
            [email]
        );

        if (admins.length === 0) {
            // Record failed attempt even if admin doesn't exist (to prevent user enumeration)
            await recordFailedAttempt(email, clientIP);
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password',
                remainingAttempts: lockoutStatus.remainingAttempts - 1
            });
        }

        const admin = admins[0];
        console.log('Admin found:', admin.email, 'Password hash starts with:', admin.password.substring(0, 10));

        // Handle both plain text and hashed passwords
        let isPasswordValid = false;

        if (admin.password.startsWith('$2y$') || admin.password.startsWith('$2b$') || admin.password.startsWith('$2a$')) {
            // Hashed password - use bcrypt compare
            // Convert PHP bcrypt format ($2y$) to Node.js format ($2b$) if needed
            const hashToCompare = admin.password.replace(/^\$2y\$/, '$2b$');
            isPasswordValid = await bcrypt.compare(password, hashToCompare);
            console.log('Admin bcrypt comparison result:', isPasswordValid);
        } else {
            // Plain text password (for backward compatibility)
            isPasswordValid = password === admin.password;
            console.log('Admin plain text comparison result:', isPasswordValid);
        }

        if (!isPasswordValid) {
            // Record failed attempt
            const attemptResult = await recordFailedAttempt(email, clientIP);
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password',
                remainingAttempts: attemptResult.remainingAttempts
            });
        }

        // Clear failed attempts on successful login
        await clearFailedAttempts(email, clientIP);

        // Log successful admin login activity
        try {
            await pool.execute(`
                INSERT INTO activity_logs (admin_id, action, details, ip_address, created_at)
                VALUES (?, 'admin_login', ?, ?, NOW())
            `, [admin.admin_id, `Admin ${email} logged in successfully`, clientIP]);
            console.log('✅ Activity logged: admin_login');
        } catch (logError) {
            console.error('❌ Failed to log admin login activity:', logError.message);
            // Don't fail the main operation if logging fails
        }

        // Remove password from response and map to camelCase
        const { password: _, ...adminWithoutPassword } = admin;

        // Map database fields to camelCase for frontend
        const mappedAdmin = {
            adminId: adminWithoutPassword.admin_id,
            firstName: adminWithoutPassword.first_name,
            lastName: adminWithoutPassword.last_name,
            email: adminWithoutPassword.email,
            department: adminWithoutPassword.department,
            position: adminWithoutPassword.position,
            profilePicture: adminWithoutPassword.profile_picture,
            createdAt: adminWithoutPassword.created_at,
            updatedAt: adminWithoutPassword.updated_at,
            status: adminWithoutPassword.status
        };

        // Generate JWT token
        if (!process.env.JWT_SECRET) {
            console.error('JWT_SECRET environment variable is not set');
            return res.status(500).json({
                success: false,
                message: 'Server configuration error'
            });
        }

        const token = jwt.sign(
            {
                id: admin.admin_id,
                email: admin.email,
                role: 'admin',
                type: 'admin'
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        console.log('Admin login successful:', email);
        res.status(200).json({
            success: true,
            message: 'Admin login successful',
            token,
            admin: mappedAdmin
        });

    } catch (error) {
        console.error('Admin login error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// Login for staff
const loginStaff = async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validate input
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email and password are required'
            });
        }

        // Validate email format
        if (!validateEmail(email)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid email format'
            });
        }

        const clientIP = getClientIP(req);

        // Check account lockout status
        const lockoutStatus = await checkAccountLockout(email, clientIP);
        if (lockoutStatus.locked) {
            const lockoutMinutes = Math.ceil((lockoutStatus.lockoutUntil.getTime() - Date.now()) / 60000);
            return res.status(429).json({
                success: false,
                message: `Account locked due to too many failed login attempts. Please try again after ${lockoutMinutes} minute(s).`,
                lockoutUntil: lockoutStatus.lockoutUntil
            });
        }

        // Check if staff exists
        const [staff] = await pool.execute(
            'SELECT * FROM staff WHERE email = ? AND status = 1 AND availability IN ("available", "busy")',
            [email]
        );

        if (staff.length === 0) {
            // Record failed attempt even if staff doesn't exist (to prevent user enumeration)
            await recordFailedAttempt(email, clientIP);
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password',
                remainingAttempts: lockoutStatus.remainingAttempts - 1
            });
        }

        const staffMember = staff[0];
        console.log('Staff found:', staffMember.email, 'Password hash starts with:', staffMember.password.substring(0, 10));

        // Handle both plain text and hashed passwords
        let isPasswordValid = false;

        if (staffMember.password.startsWith('$2y$') || staffMember.password.startsWith('$2b$') || staffMember.password.startsWith('$2a$')) {
            // Hashed password - use bcrypt compare
            // Convert PHP bcrypt format ($2y$) to Node.js format ($2b$) if needed
            const hashToCompare = staffMember.password.replace(/^\$2y\$/, '$2b$');
            isPasswordValid = await bcrypt.compare(password, hashToCompare);
            console.log('Staff bcrypt comparison result:', isPasswordValid);
        } else {
            // Plain text password (for backward compatibility)
            isPasswordValid = password === staffMember.password;
            console.log('Staff plain text comparison result:', isPasswordValid);
        }

        if (!isPasswordValid) {
            // Record failed attempt
            const attemptResult = await recordFailedAttempt(email, clientIP);
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password',
                remainingAttempts: attemptResult.remainingAttempts
            });
        }

        // Clear failed attempts on successful login
        await clearFailedAttempts(email, clientIP);

        // Log successful staff login activity
        try {
            const clientIP = getClientIP(req);
            await pool.execute(`
                INSERT INTO activity_logs (staff_id, action, details, ip_address, created_at)
                VALUES (?, 'staff_login', ?, ?, NOW())
            `, [staffMember.id, `Staff ${email} logged in successfully`, clientIP]);
            console.log('✅ Activity logged: staff_login');
        } catch (logError) {
            console.error('❌ Failed to log staff login activity:', logError.message);
            // Don't fail the main operation if logging fails
        }

        // Remove password from response and map to camelCase
        const { password: _, ...staffWithoutPassword } = staffMember;

        // Map database fields to camelCase for frontend
        const mappedStaff = {
            id: staffWithoutPassword.id,
            name: staffWithoutPassword.name,
            email: staffWithoutPassword.email,
            phone: staffWithoutPassword.phone,
            department: staffWithoutPassword.department,
            position: staffWithoutPassword.position,
            assignedTeamId: staffWithoutPassword.assigned_team_id,
            availability: staffWithoutPassword.availability,
            status: staffWithoutPassword.status,
            lastLogin: staffWithoutPassword.last_login,
            createdAt: staffWithoutPassword.created_at,
            updatedAt: staffWithoutPassword.updated_at
        };

        // Generate JWT token
        if (!process.env.JWT_SECRET) {
            console.error('JWT_SECRET environment variable is not set');
            return res.status(500).json({
                success: false,
                message: 'Server configuration error'
            });
        }

        const token = jwt.sign(
            {
                id: staffMember.id,
                email: staffMember.email,
                role: 'staff',
                type: 'staff'
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        console.log('Staff login successful:', email);
        res.status(200).json({
            success: true,
            message: 'Staff login successful',
            token,
            staff: mappedStaff
        });

    } catch (error) {
        console.error('Staff login error:', error);
        // Log more details about the error
        console.error('Error details:', error.message, error.stack);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// Register new user
const registerUser = async (req, res) => {
    try {
        const {
            firstName,
            lastName,
            email,
            phoneNumber,
            address,
            password,
            userType,
            department,
            college
        } = req.body;

        console.log('User registration attempt for:', email);

        // Validate required fields
        if (!firstName || !lastName || !email || !phoneNumber || !address || !password || !userType) {
            return res.status(400).json({
                success: false,
                message: 'First name, last name, email, phone number, address, password, and user type are required'
            });
        }

        // Validate user type
        const validUserTypes = ['CITIZEN'];
        if (!validUserTypes.includes(userType)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid user type. Must be CITIZEN'
            });
        }

        // Validate email format
        if (!validateEmail(email)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid email format'
            });
        }

        // Validate password strength
        const passwordValidation = validatePasswordStrength(password);
        if (!passwordValidation.valid) {
            return res.status(400).json({
                success: false,
                message: 'Password does not meet requirements',
                errors: passwordValidation.errors
            });
        }

        // Check if user already exists
        const [existingUsers] = await pool.execute(
            'SELECT user_id, status FROM general_users WHERE email = ?',
            [email.toLowerCase()]
        );

        if (existingUsers.length > 0) {
            const existingUser = existingUsers[0];
            
            // If user is already verified, reject registration
            if (existingUser.status === 1) {
                return res.status(409).json({
                    success: false,
                    message: 'User with this email already exists. Please log in instead.',
                    accountExists: true,
                    isVerified: true
                });
            }
            
            // If user is unverified, allow resending verification code
            // Update the account with new information and resend verification
            const saltRounds = 10;
            const hashedPassword = await bcrypt.hash(password, saltRounds);
            const completeAddress = `${address}, Rosario, Batangas 4225`;
            
            // Update existing unverified account
            await pool.execute(
                `UPDATE general_users 
                SET first_name = ?, last_name = ?, phone = ?, address = ?, password = ?, user_type = ?, updated_at = NOW()
                WHERE user_id = ?`,
                [firstName, lastName, phoneNumber, completeAddress, hashedPassword, userType, existingUser.user_id]
            );
            
            // Generate and send new verification OTP
            const verificationOTP = generateOTP();
            storeOTP(email.toLowerCase(), verificationOTP);
            
            try {
                await sendEmailVerificationOTP(email, verificationOTP, firstName);
                console.log('✅ Verification OTP resent to unverified account:', email);
            } catch (emailError) {
                console.error('❌ Failed to resend verification email:', emailError.message);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to send verification email. Please try again.'
                });
            }
            
            // Get the updated user
            const [updatedUser] = await pool.execute(
                'SELECT user_id, first_name, last_name, email, phone, address, user_type, status, created_at FROM general_users WHERE user_id = ?',
                [existingUser.user_id]
            );
            
            // Map database fields to camelCase for frontend
            const mappedUser = {
                userId: updatedUser[0].user_id,
                firstName: updatedUser[0].first_name,
                lastName: updatedUser[0].last_name,
                email: updatedUser[0].email,
                phoneNumber: updatedUser[0].phone,
                address: updatedUser[0].address,
                userType: updatedUser[0].user_type,
                status: updatedUser[0].status,
                createdAt: updatedUser[0].created_at
            };
            
            return res.status(200).json({
                success: true,
                message: 'Account information updated. A new verification code has been sent to your email.',
                user: mappedUser,
                requiresVerification: true,
                isResend: true
            });
        }

        // Hash the password
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Set default values for department and college based on user type
        let finalDepartment = department;
        let finalCollege = college;

        // Set default values for department based on user type
        if (userType === 'BARANGAY_STAFF' || userType === 'EMERGENCY_RESPONDER') {
            finalDepartment = finalDepartment || 'N/A';
        }

        // Create complete address with state, city, and zip code
        const completeAddress = `${address}, Rosario, Batangas 4225`;

        // Insert new user with status=0 (unverified)
        const [result] = await pool.execute(
            `INSERT INTO general_users
            (first_name, last_name, email, phone, address, password, user_type, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
            [firstName, lastName, email, phoneNumber, completeAddress, hashedPassword, userType]
        );

        // Generate and send verification OTP
        const verificationOTP = generateOTP();
        storeOTP(email.toLowerCase(), verificationOTP);

        try {
            await sendEmailVerificationOTP(email, verificationOTP, firstName);
            console.log('✅ Email verification OTP sent to:', email);
        } catch (emailError) {
            console.error('❌ Failed to send verification email:', emailError.message);
            // Delete the user if email sending fails
            await pool.execute('DELETE FROM general_users WHERE user_id = ?', [result.insertId]);
            return res.status(500).json({
                success: false,
                message: 'Failed to send verification email. Please try again.'
            });
        }

        // Get the created user (without password)
        const [newUser] = await pool.execute(
            'SELECT user_id, first_name, last_name, email, phone, address, user_type, status, created_at FROM general_users WHERE user_id = ?',
            [result.insertId]
        );

        // Log successful user registration activity
        try {
            const clientIP = getClientIP(req);
            await pool.execute(`
                INSERT INTO activity_logs (general_user_id, action, details, ip_address, created_at)
                VALUES (?, 'user_register', ?, ?, NOW())
            `, [result.insertId, `New user registered: ${email} (${firstName} ${lastName}) - Pending verification`, clientIP]);
            console.log('✅ Activity logged: user_register');
        } catch (logError) {
            console.error('❌ Failed to log user registration activity:', logError.message);
            // Don't fail the main operation if logging fails
        }

        // Map database fields to camelCase for frontend
        const mappedUser = {
            userId: newUser[0].user_id,
            firstName: newUser[0].first_name,
            lastName: newUser[0].last_name,
            email: newUser[0].email,
            phoneNumber: newUser[0].phone,
            address: newUser[0].address,
            userType: newUser[0].user_type,
            status: newUser[0].status,
            createdAt: newUser[0].created_at
        };

        console.log('User registration successful (pending verification):', email);
        res.status(201).json({
            success: true,
            message: 'Registration successful! Please check your email to verify your account.',
            user: mappedUser,
            requiresVerification: true
        });

    } catch (error) {
        console.error('Registration error:', error);
        console.error('Error details:', error.message);
        console.error('Error stack:', error.stack);
        console.error('Request body:', req.body);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// Forgot password
const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;

        console.log('Forgot password request for:', email);

        if (!email) {
            return res.status(400).json({
                success: false,
                message: 'Email is required'
            });
        }

        // Check if user exists in any of the user tables
        let user = null;
        let userType = null;

        // Check general_users table
        const [generalUsers] = await pool.execute(
            'SELECT user_id, email, first_name, last_name FROM general_users WHERE email = ? AND status = 1',
            [email]
        );

        if (generalUsers.length > 0) {
            user = generalUsers[0];
            userType = 'user';
        } else {
            // Check staff table
            const [staff] = await pool.execute(
                'SELECT id, email, name FROM staff WHERE email = ? AND status = 1 AND availability IN ("available", "busy")',
                [email]
            );

            if (staff.length > 0) {
                user = staff[0];
                userType = 'staff';
            } else {
                // Check admin table
                const [admins] = await pool.execute(
                    'SELECT admin_id, email, first_name, last_name FROM admin WHERE email = ? AND status = "active"',
                    [email]
                );

                if (admins.length > 0) {
                    user = admins[0];
                    userType = 'admin';
                }
            }
        }

        if (!user) {
            // Don't reveal if email exists or not for security
            return res.status(200).json({
                success: true,
                message: 'If an account with this email exists, a password reset link has been sent.'
            });
        }

        // Generate OTP
        const otp = generateOTP();
        storeOTP(user.email.toLowerCase(), otp);

        // Send password reset OTP email
        try {
            console.log('Attempting to send password reset OTP to:', user.email);
            await sendPasswordResetOTP(user.email, otp);
            console.log('Password reset OTP sent successfully to:', email);
        } catch (emailError) {
            console.error('Failed to send password reset OTP:', emailError);
            console.error('Email error details:', emailError.message);
            console.error('Email error stack:', emailError.stack);

            // For development/testing, return success even if email fails
            if (process.env.NODE_ENV === 'development' || process.env.ALLOW_EMAIL_FAILURE === 'true') {
                console.log('⚠️ Email failed but continuing in development mode');
                return res.status(200).json({
                    success: true,
                    message: 'Password reset code generated (email service unavailable)',
                    debug: {
                        otp: otp,
                        email: user.email,
                        note: 'Email service failed, but OTP was generated for testing'
                    }
                });
            }

            // Return specific error message based on the email error
            const errorMessage = emailError.message.includes('SMTP')
                ? emailError.message
                : 'Failed to send password reset code. Please try again later.';

            return res.status(500).json({
                success: false,
                message: errorMessage
            });
        }

        res.status(200).json({
            success: true,
            message: 'If an account with this email exists, a password reset code has been sent.'
        });

    } catch (error) {
        console.error('Forgot password error:', error);
        console.error('Error details:', error.message);
        console.error('Error stack:', error.stack);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// Reset password
const resetPassword = async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;

        console.log('Password reset attempt for:', email);

        if (!email || !otp || !newPassword) {
            return res.status(400).json({
                success: false,
                message: 'Email, OTP, and new password are required'
            });
        }

        // Verify OTP (don't delete on success, will delete after password reset)
        const otpVerification = verifyOTPFromStore(email.toLowerCase(), otp, false);
        if (!otpVerification.valid) {
            return res.status(400).json({
                success: false,
                message: otpVerification.message
            });
        }

        // Find user by email to get user details
        let user = null;
        let userType = null;

        // Check general_users table
        const [generalUsers] = await pool.execute(
            'SELECT user_id, email FROM general_users WHERE email = ? AND status = 1',
            [email]
        );

        if (generalUsers.length > 0) {
            user = generalUsers[0];
            userType = 'user';
        } else {
            // Check staff table
            const [staff] = await pool.execute(
                'SELECT id, email FROM staff WHERE email = ? AND status = 1 AND availability IN ("available", "busy")',
                [email]
            );

            if (staff.length > 0) {
                user = staff[0];
                userType = 'staff';
            } else {
                // Check admin table
                const [admins] = await pool.execute(
                    'SELECT admin_id, email FROM admin WHERE email = ? AND status = "active"',
                    [email]
                );

                if (admins.length > 0) {
                    user = admins[0];
                    userType = 'admin';
                }
            }
        }

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const userId = userType === 'user' ? user.user_id : userType === 'staff' ? user.id : user.admin_id;

        // Hash the new password
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

        // Update password based on user type
        let updateResult;
        if (userType === 'user') {
            [updateResult] = await pool.execute(
                'UPDATE general_users SET password = ? WHERE user_id = ? AND status = 1',
                [hashedPassword, userId]
            );
        } else if (userType === 'staff') {
            [updateResult] = await pool.execute(
                'UPDATE staff SET password = ? WHERE id = ? AND status = 1',
                [hashedPassword, userId]
            );
        } else if (userType === 'admin') {
            [updateResult] = await pool.execute(
                'UPDATE admin SET password = ? WHERE admin_id = ? AND status = "active"',
                [hashedPassword, userId]
            );
        } else {
            return res.status(400).json({
                success: false,
                message: 'Invalid user type'
            });
        }

        if (updateResult.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found or inactive'
            });
        }

        // Log password reset activity
        try {
            const clientIP = getClientIP(req);
            if (userType === 'user') {
                await pool.execute(`
                    INSERT INTO activity_logs (general_user_id, action, details, ip_address, created_at)
                    VALUES (?, 'password_reset', ?, ?, NOW())
                `, [userId, `Password reset for user: ${email}`, clientIP]);
            } else if (userType === 'staff') {
                await pool.execute(`
                    INSERT INTO activity_logs (staff_id, action, details, ip_address, created_at)
                    VALUES (?, 'password_reset', ?, ?, NOW())
                `, [userId, `Password reset for staff: ${email}`, clientIP]);
            } else if (userType === 'admin') {
                await pool.execute(`
                    INSERT INTO activity_logs (admin_id, action, details, ip_address, created_at)
                    VALUES (?, 'password_reset', ?, ?, NOW())
                `, [userId, `Password reset for admin: ${email}`, clientIP]);
            }
            console.log('✅ Activity logged: password_reset');
        } catch (logError) {
            console.error('❌ Failed to log password reset activity:', logError.message);
        }

        // Delete OTP after successful password reset
        const { deleteOTP } = require('../utils/otpStore');
        deleteOTP(email.toLowerCase());

        console.log('Password reset successful for:', email);
        res.status(200).json({
            success: true,
            message: 'Password reset successful'
        });

    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// Verify OTP
const verifyOTP = async (req, res) => {
    try {
        const { email, otp } = req.body;

        console.log('OTP verification attempt for:', email);

        if (!email || !otp) {
            return res.status(400).json({
                success: false,
                message: 'Email and OTP are required'
            });
        }

        // Verify OTP (don't delete on success, will delete after password reset)
        const otpVerification = verifyOTPFromStore(email.toLowerCase(), otp, false);
        if (!otpVerification.valid) {
            return res.status(400).json({
                success: false,
                message: otpVerification.message
            });
        }

        console.log('OTP verification successful for:', email);
        res.status(200).json({
            success: true,
            message: 'OTP verified successfully'
        });

    } catch (error) {
        console.error('OTP verification error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// Verify email and activate account
const verifyEmail = async (req, res) => {
    try {
        const { email, otp } = req.body;

        console.log('Email verification attempt for:', email);

        if (!email || !otp) {
            return res.status(400).json({
                success: false,
                message: 'Email and OTP are required'
            });
        }

        // Verify OTP
        const otpVerification = verifyOTPFromStore(email.toLowerCase(), otp, true);
        if (!otpVerification.valid) {
            return res.status(400).json({
                success: false,
                message: otpVerification.message
            });
        }

        // Check if user exists and is unverified
        const [users] = await pool.execute(
            'SELECT user_id, email, status, first_name FROM general_users WHERE email = ?',
            [email.toLowerCase()]
        );

        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const user = users[0];

        // Check if already verified
        if (user.status === 1) {
            return res.status(400).json({
                success: false,
                message: 'Email is already verified'
            });
        }

        // Activate the account (set status to 1)
        await pool.execute(
            'UPDATE general_users SET status = 1 WHERE user_id = ?',
            [user.user_id]
        );

        // Log email verification activity
        try {
            const clientIP = getClientIP(req);
            await pool.execute(`
                INSERT INTO activity_logs (general_user_id, action, details, ip_address, created_at)
                VALUES (?, 'email_verified', ?, ?, NOW())
            `, [user.user_id, `Email verified: ${email}`, clientIP]);
            console.log('✅ Activity logged: email_verified');
        } catch (logError) {
            console.error('❌ Failed to log email verification activity:', logError.message);
            // Don't fail the main operation if logging fails
        }

        // Create welcome notification for the new user
        try {
            const firstName = user.first_name || 'User';
            await NotificationService.createNotificationForUser(user.user_id, {
                type: 'system',
                title: '👋 Welcome to Soteros MDRRMO!',
                message: `Hello ${firstName}! Welcome to Soteros MDRRMO. Your account has been successfully verified. You can now report incidents, receive alerts, and access all features of the emergency management system. Stay safe!`,
                severity: 'info'
            });
            console.log('✅ Welcome notification created for user:', user.user_id);
        } catch (notificationError) {
            console.error('❌ Failed to create welcome notification:', notificationError.message);
            // Don't fail the main operation if notification creation fails
        }

        console.log('Email verification successful for:', email);
        res.status(200).json({
            success: true,
            message: 'Email verified successfully! Your account is now active.'
        });

    } catch (error) {
        console.error('Email verification error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// Resend email verification code
const resendVerificationCode = async (req, res) => {
    try {
        const { email } = req.body;

        console.log('Resend verification code request for:', email);

        if (!email) {
            return res.status(400).json({
                success: false,
                message: 'Email is required'
            });
        }

        // Validate email format
        if (!validateEmail(email)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid email format'
            });
        }

        // Check if user exists
        const [users] = await pool.execute(
            'SELECT user_id, email, status, first_name FROM general_users WHERE email = ?',
            [email.toLowerCase()]
        );

        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found. Please sign up first.'
            });
        }

        const user = users[0];

        // Check if already verified
        if (user.status === 1) {
            return res.status(400).json({
                success: false,
                message: 'Email is already verified. You can log in now.'
            });
        }

        // Generate and send new verification OTP
        const verificationOTP = generateOTP();
        storeOTP(email.toLowerCase(), verificationOTP);

        try {
            await sendEmailVerificationOTP(email, verificationOTP, user.first_name);
            console.log('✅ Verification OTP resent to:', email);
        } catch (emailError) {
            console.error('❌ Failed to resend verification email:', emailError.message);
            return res.status(500).json({
                success: false,
                message: 'Failed to send verification email. Please try again.'
            });
        }

        // Log resend verification activity
        try {
            const clientIP = getClientIP(req);
            await pool.execute(`
                INSERT INTO activity_logs (general_user_id, action, details, ip_address, created_at)
                VALUES (?, 'verification_code_resent', ?, ?, NOW())
            `, [user.user_id, `Verification code resent to: ${email}`, clientIP]);
            console.log('✅ Activity logged: verification_code_resent');
        } catch (logError) {
            console.error('❌ Failed to log resend verification activity:', logError.message);
            // Don't fail the main operation if logging fails
        }

        res.status(200).json({
            success: true,
            message: 'Verification code has been sent to your email. Please check your inbox.'
        });

    } catch (error) {
        console.error('Resend verification code error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// Logout for general users
const logoutUser = async (req, res) => {
    try {
        // Get user info from token for logging
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        let userId = null;
        let userEmail = 'unknown';

        if (token) {
            try {
                if (!process.env.JWT_SECRET) {
                    console.error('JWT_SECRET environment variable is not set');
                    return res.status(500).json({
                        success: false,
                        message: 'Server configuration error'
                    });
                }
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                if (decoded.type === 'user') {
                    userId = decoded.id;
                    userEmail = decoded.email;
                }
            } catch (tokenError) {
                console.log('Could not decode token for user logout logging:', tokenError.message);
            }
        }

        // Log user logout activity
        try {
            const clientIP = getClientIP(req);
            // Only log if we have a valid user ID
            if (userId) {
                await pool.execute(`
                    INSERT INTO activity_logs (general_user_id, action, details, ip_address, created_at)
                    VALUES (?, 'user_logout', ?, ?, NOW())
                `, [userId, `User ${userEmail} logged out successfully`, clientIP]);
                console.log('✅ Activity logged: user_logout for user ID:', userId);
            } else {
                console.log('⚠️ Could not log user logout: user ID not found in token');
            }
        } catch (logError) {
            console.error('❌ Failed to log user logout activity:', logError.message);
            // Don't fail the main operation if logging fails
        }

        res.status(200).json({
            success: true,
            message: 'User logout successful'
        });

    } catch (error) {
        console.error('User logout error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// Logout for admin
const logoutAdmin = async (req, res) => {
    try {
        // Get admin info from token for logging
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        let adminId = null;
        let adminEmail = 'unknown';

        if (token) {
            try {
                if (!process.env.JWT_SECRET) {
                    console.error('JWT_SECRET environment variable is not set');
                    return res.status(500).json({
                        success: false,
                        message: 'Server configuration error'
                    });
                }
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                if (decoded.type === 'admin') {
                    adminId = decoded.id;
                    adminEmail = decoded.email;
                }
            } catch (tokenError) {
                console.log('Could not decode token for admin logout logging:', tokenError.message);
            }
        }

        // Log admin logout activity
        try {
            const clientIP = getClientIP(req);
            // Only log if we have a valid admin ID
            if (adminId) {
                await pool.execute(`
                    INSERT INTO activity_logs (admin_id, action, details, ip_address, created_at)
                    VALUES (?, 'admin_logout', ?, ?, NOW())
                `, [adminId, `Admin ${adminEmail} logged out successfully`, clientIP]);
                console.log('✅ Activity logged: admin_logout for admin ID:', adminId);
            } else {
                console.log('⚠️ Could not log admin logout: admin ID not found in token');
            }
        } catch (logError) {
            console.error('❌ Failed to log admin logout activity:', logError.message);
            // Don't fail the main operation if logging fails
        }

        res.status(200).json({
            success: true,
            message: 'Admin logout successful'
        });

    } catch (error) {
        console.error('Admin logout error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// Logout for staff
const logoutStaff = async (req, res) => {
    try {
        // Get staff info from token for logging
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        let staffId = null;
        let staffEmail = 'unknown';

        if (token) {
            try {
                if (!process.env.JWT_SECRET) {
                    console.error('JWT_SECRET environment variable is not set');
                    return res.status(500).json({
                        success: false,
                        message: 'Server configuration error'
                    });
                }
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                if (decoded.type === 'staff') {
                    staffId = decoded.id;
                    staffEmail = decoded.email;
                }
            } catch (tokenError) {
                console.log('Could not decode token for staff logout logging:', tokenError.message);
            }
        }

        // Log staff logout activity
        try {
            const clientIP = getClientIP(req);
            // Only log if we have a valid staff ID
            if (staffId) {
                await pool.execute(`
                    INSERT INTO activity_logs (staff_id, action, details, ip_address, created_at)
                    VALUES (?, 'staff_logout', ?, ?, NOW())
                `, [staffId, `Staff ${staffEmail} logged out successfully`, clientIP]);
                console.log('✅ Activity logged: staff_logout for staff ID:', staffId);
            } else {
                console.log('⚠️ Could not log staff logout: staff ID not found in token');
            }
        } catch (logError) {
            console.error('❌ Failed to log staff logout activity:', logError.message);
            // Don't fail the main operation if logging fails
        }

        res.status(200).json({
            success: true,
            message: 'Staff logout successful'
        });

    } catch (error) {
        console.error('Staff logout error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

module.exports = {
    loginUser,
    loginAdmin,
    loginStaff,
    registerUser,
    forgotPassword,
    verifyOTP,
    verifyEmail,
    resendVerificationCode,
    resetPassword,
    logoutUser,
    logoutAdmin,
    logoutStaff
};
