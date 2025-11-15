const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    debug: false,  // shows query logs / false if deployment
    trace: false   // traces connection calls / false if deployment
  });
  

// Add connection error handling
pool.on('error', (err) => {
    // Only log errors in development mode
    if (process.env.NODE_ENV === 'development') {
        console.error('MySQL Pool Error:', err);
    }
});

module.exports = pool; 