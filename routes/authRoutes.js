const express = require('express');
const router = express.Router();
const { loginLimiter, passwordResetLimiter, registrationLimiter } = require('../middleware/rateLimiter');
const { loginUser, loginAdmin, loginStaff, registerUser, forgotPassword, resetPassword, verifyOTP, logoutUser, logoutAdmin, logoutStaff } = require('../controllers/authController');

// User login route with rate limiting
router.post('/login/user', loginLimiter, loginUser);

// Admin login route with rate limiting
router.post('/login/admin', loginLimiter, loginAdmin);

// Staff login route with rate limiting
router.post('/login/staff', loginLimiter, loginStaff);

// User registration route with rate limiting
router.post('/register', registrationLimiter, registerUser);

// Password reset routes with rate limiting
router.post('/forgot-password', passwordResetLimiter, forgotPassword);
router.post('/verify-otp', verifyOTP);
router.post('/reset-password', resetPassword);

// Logout routes
router.post('/logout/user', logoutUser);
router.post('/logout/admin', logoutAdmin);
router.post('/logout/staff', logoutStaff);

// Test route
router.get('/test', (req, res) => {
    res.json({
        success: true,
        message: 'Auth routes are working'
    });
});

module.exports = router;
