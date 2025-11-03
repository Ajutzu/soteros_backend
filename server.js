const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const WebSocket = require('ws');
const http = require('http');
const helmet = require('helmet');
require('dotenv').config();

// Set NODE_ENV to development if not set (for debugging)
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'development';
}

const app = express();
const PORT = process.env.PORT || 5000;

// Security middleware - Helmet for security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Input sanitization middleware
const { sanitizeInput } = require('./middleware/inputSanitizer');
app.use(sanitizeInput);

// Middleware - Enhanced CORS configuration
app.use(cors({
  origin: function (origin, callback) {
    console.log('CORS request from origin:', origin);
    
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      console.log('CORS: Allowing request with no origin');
      return callback(null, true);
    }
    
    const allowedOrigins = [
      'http://localhost:5173', 
      'http://localhost:3000', 
      'https://soteros-client.vercel.app',
      'https://soteros-client-git-main.vercel.app',
      'https://soteros-client-git-develop.vercel.app'
    ];
    
    // Allow any Vercel preview URL
    if (origin.includes('.vercel.app')) {
      console.log('CORS: Allowing Vercel domain:', origin);
      return callback(null, true);
    }
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      console.log('CORS: Allowing known origin:', origin);
      callback(null, true);
    } else {
      console.log('CORS: Blocking unknown origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'Accept', 
    'Cache-Control', 
    'X-Requested-With',
    'Origin',
    'Access-Control-Request-Method',
    'Access-Control-Request-Headers'
  ],
  exposedHeaders: ['Content-Length', 'X-Foo', 'X-Bar'],
  optionsSuccessStatus: 200, // Some legacy browsers choke on 204
  preflightContinue: false
}));

// Handle preflight requests explicitly
app.options('*', (req, res) => {
  console.log('OPTIONS preflight request for:', req.url);
  console.log('Origin:', req.headers.origin);
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Cache-Control, X-Requested-With, Origin, Access-Control-Request-Method, Access-Control-Request-Headers');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Max-Age', '86400'); // 24 hours
  res.sendStatus(200);
});

// Increase payload size limit for multiple file attachments (Cloudinary URLs can be long)
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files from uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve incident attachments specifically
app.use('/uploads/incidents', express.static(path.join(__dirname, 'uploads', 'incidents')));

// Import routes
const authRoutes = require('./routes/authRoutes');
const adminAuthRoutes = require('./routes/adminAuthRoutes');
const adminDashboardRoutes = require('./routes/adminDashboardRoutes');
const alertsRoutes = require('./routes/alertsRoutes');
const evacuationCentersRoutes = require('./routes/evacuationCentersRoutes');
const evacuationRoutesRoutes = require('./routes/evacuationRoutesRoutes');
const incidentRoutes = require('./routes/incidentRoutes');
const profileRoutes = require('./routes/profileRoutes');
const reportsRoutes = require('./routes/reportsRoutes');
const safetyProtocolsRoutes = require('./routes/safetyProtocolsRoutes');
const staffManagementRoutes = require('./routes/staffManagementRoutes');
const systemSettingsRoutes = require('./routes/systemSettingsRoutes');
const teamsRoutes = require('./routes/teamsRoutes');
const userManagementRoutes = require('./routes/userManagementRoutes');
const activityLogsRoutes = require('./routes/activityLogsRoutes');
const publicRoutes = require('./routes/publicRoutes');
const feedbackRoutes = require('./routes/feedbackRoutes');
const staffDashboardRoutes = require('./routes/staffDashboardRoutes');
const welfareRoutes = require('./routes/welfareRoutes');
const adminWelfareRoutes = require('./routes/adminWelfareRoutes');
const notificationsRoutes = require('./routes/notificationsRoutes');
const adminNotificationsRoutes = require('./routes/adminNotificationsRoutes');

// Routing service proxy
const routingRoutes = require('./routes/routingRoutes');
const geocodingRoutes = require('./routes/geocodingRoutes');

// Rate limiting middleware
const { loginLimiter, passwordResetLimiter, registrationLimiter, apiLimiter } = require('./middleware/rateLimiter');

// Apply general API rate limiting (but exclude auth routes as they have specific rate limiters)
// DISABLED: API rate limiting removed per user request
// app.use('/api', (req, res, next) => {
//   // Skip rate limiting for auth endpoints - they have their own rate limiters
//   if (req.path.startsWith('/auth') || req.path.startsWith('/admin/auth')) {
//     return next();
//   }
//   // Apply general API rate limiting to other routes
//   return apiLimiter(req, res, next);
// });

// Use routes with rate limiting on specific endpoints
app.use('/api/auth', authRoutes);
app.use('/api/admin/auth', adminAuthRoutes);
app.use('/api/admin/dashboard', adminDashboardRoutes);
app.use('/api/alerts', alertsRoutes);
app.use('/api/evacuation-centers', evacuationCentersRoutes);
app.use('/api/evacuation-routes', evacuationRoutesRoutes);
app.use('/api/incidents', incidentRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/safety-protocols', safetyProtocolsRoutes);
app.use('/api/staff', staffManagementRoutes);
app.use('/api/system-settings', systemSettingsRoutes);
app.use('/api/teams', teamsRoutes);
app.use('/api/users', userManagementRoutes);
app.use('/api/activity-logs', activityLogsRoutes);
// Enable public routes (testimonials and stats for frontend)
app.use('/api/public', publicRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/staff/dashboard', staffDashboardRoutes);
app.use('/api/welfare', welfareRoutes);
app.use('/api/admin/welfare', adminWelfareRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/admin/notifications', adminNotificationsRoutes);
app.use('/api/routing', routingRoutes);
app.use('/api/geocoding', geocodingRoutes);

// Health check route
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'MDRRMO Backend API is running',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        cors: 'enabled'
    });
});

// Diagnostic/test endpoints gated by env flag
if (process.env.ENABLE_DIAGNOSTICS === 'true') {
    app.get('/api/test', (req, res) => {
        res.json({
            success: true,
            message: 'Frontend connection test successful',
            timestamp: new Date().toISOString(),
            origin: req.headers.origin || 'unknown',
            userAgent: req.headers['user-agent'] || 'unknown'
        });
    });

    app.get('/api/cors-test', (req, res) => {
        res.json({
            success: true,
            message: 'CORS test successful',
            timestamp: new Date().toISOString(),
            origin: req.headers.origin || 'unknown',
            corsEnabled: true
        });
    });

    // Email configuration test endpoint
    app.get('/api/email-config-test', (req, res) => {
        const emailConfig = {
            EMAIL_HOST: process.env.EMAIL_HOST || process.env.SMTP_HOST || 'smtp.gmail.com',
            EMAIL_PORT: process.env.EMAIL_PORT || process.env.SMTP_PORT || 587,
            EMAIL_USER: process.env.EMAIL_USER || process.env.SMTP_USER ? '***configured***' : 'MISSING',
            EMAIL_PASS: process.env.EMAIL_PASS || process.env.SMTP_PASS ? '***configured***' : 'MISSING',
            EMAIL_FROM_NAME: process.env.EMAIL_FROM_NAME || 'MISSING',
            EMAIL_FROM_ADDRESS: process.env.EMAIL_FROM_ADDRESS || 'MISSING',
            NODE_ENV: process.env.NODE_ENV || 'development'
        };
        
        res.json({
            success: true,
            message: 'Email configuration status',
            config: emailConfig,
            timestamp: new Date().toISOString()
        });
    });

    // SMTP connection test endpoint
    app.get('/api/smtp-test', async (req, res) => {
        try {
            const nodemailer = require('nodemailer');
            
            const transporter = nodemailer.createTransporter({
                host: process.env.EMAIL_HOST || process.env.SMTP_HOST || 'smtp.gmail.com',
                port: parseInt(process.env.EMAIL_PORT || process.env.SMTP_PORT || 587),
                secure: false,
                auth: {
                    user: process.env.EMAIL_USER || process.env.SMTP_USER,
                    pass: process.env.EMAIL_PASS || process.env.SMTP_PASS,
                },
                tls: {
                    rejectUnauthorized: false,
                },
                connectionTimeout: 10000, // 10 seconds
                greetingTimeout: 5000,    // 5 seconds
                socketTimeout: 10000,     // 10 seconds
            });

            await transporter.verify();
            
            res.json({
                success: true,
                message: 'SMTP connection successful!',
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('SMTP test failed:', error);
            res.status(500).json({
                success: false,
                message: 'SMTP connection failed',
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    });
}

// Root route
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'Welcome to MDRRMO Backend API',
        version: '1.0.0'
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        success: false,
        message: 'Something went wrong!'
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found'
    });
});

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Store connected clients with their user info
const connectedClients = new Map();

// WebSocket connection handling
wss.on('connection', (ws, req) => {
    console.log('New WebSocket connection');

    // Parse token from URL query parameters
    const url = new URL(req.url, 'ws://localhost');
    const token = url.searchParams.get('token');

    if (!token) {
        ws.close(1008, 'Token required');
        return;
    }

    // Verify token and get user info
    try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        
        // Store client info
        const clientInfo = {
            ws: ws,
            userId: decoded.user_id || decoded.id,
            userType: decoded.user_type || decoded.userType,
            email: decoded.email,
            name: decoded.name || decoded.first_name
        };
        
        connectedClients.set(ws, clientInfo);
        console.log(`WebSocket client connected: ${clientInfo.userType} - ${clientInfo.email}`);

        // Send initial connection success message
        ws.send(JSON.stringify({ 
            type: 'connection', 
            status: 'connected',
            userType: clientInfo.userType,
            timestamp: new Date().toISOString()
        }));

    } catch (error) {
        console.error('Invalid token:', error.message);
        ws.close(1008, 'Invalid token');
        return;
    }

    // Handle incoming messages
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Received WebSocket message:', data);
            
            // Handle different message types
            switch (data.type) {
                case 'ping':
                    ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
                    break;
                case 'subscribe':
                    // Handle subscription to specific notification types
                    console.log(`Client subscribed to: ${data.channels}`);
                    break;
                default:
                    console.log('Unknown message type:', data.type);
            }
        } catch (error) {
            console.error('Error processing WebSocket message:', error);
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
        }
    });

    // Handle client disconnection
    ws.on('close', () => {
        const clientInfo = connectedClients.get(ws);
        if (clientInfo) {
            console.log(`WebSocket client disconnected: ${clientInfo.userType} - ${clientInfo.email}`);
            connectedClients.delete(ws);
        }
    });

    // Handle errors
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        connectedClients.delete(ws);
    });
});

// Function to broadcast notifications to specific user types
function broadcastToUserType(userType, message) {
    let sentCount = 0;
    connectedClients.forEach((clientInfo, ws) => {
        if (clientInfo.userType === userType && ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify(message));
                sentCount++;
            } catch (error) {
                console.error('Error sending WebSocket message:', error);
                connectedClients.delete(ws);
            }
        }
    });
    console.log(`Broadcasted to ${sentCount} ${userType} clients`);
}

// Function to broadcast to all connected clients
function broadcastToAll(message) {
    let sentCount = 0;
    connectedClients.forEach((clientInfo, ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify(message));
                sentCount++;
            } catch (error) {
                console.error('Error sending WebSocket message:', error);
                connectedClients.delete(ws);
            }
        }
    });
    console.log(`Broadcasted to ${sentCount} clients`);
}

// Function to broadcast incident notifications
function broadcastIncidentNotification(incidentData, type = 'new_incident') {
    const message = {
        type: type,
        data: incidentData,
        timestamp: new Date().toISOString()
    };
    
    // Broadcast to admin users
    broadcastToUserType('admin', message);
    
    // Also broadcast to staff if it's a new incident
    if (type === 'new_incident') {
        broadcastToUserType('staff', message);
    }
}

// Function to broadcast welfare notifications
function broadcastWelfareNotification(welfareData, type = 'new_welfare_report') {
    const message = {
        type: type,
        data: welfareData,
        timestamp: new Date().toISOString()
    };
    
    // Broadcast to admin users
    broadcastToUserType('admin', message);
}

// Export functions for use in other modules
global.broadcastIncidentNotification = broadcastIncidentNotification;
global.broadcastWelfareNotification = broadcastWelfareNotification;
global.broadcastToUserType = broadcastToUserType;
global.broadcastToAll = broadcastToAll;

// Start server
server.listen(PORT, () => {
    console.log(`MDRRMO Backend server is running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
    console.log(`WebSocket server is running on ws://localhost:${PORT}`);
});

module.exports = app;
