-- Create login_attempts table for tracking failed login attempts
CREATE TABLE IF NOT EXISTS login_attempts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    identifier VARCHAR(255) NOT NULL COMMENT 'Email or username',
    ip_address VARCHAR(45) NOT NULL COMMENT 'IP address of the login attempt',
    attempt_count INT NOT NULL DEFAULT 0 COMMENT 'Number of failed attempts',
    last_attempt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Last failed attempt timestamp',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'First attempt timestamp',
    INDEX idx_identifier_ip (identifier, ip_address),
    UNIQUE KEY unique_identifier_ip (identifier, ip_address)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

