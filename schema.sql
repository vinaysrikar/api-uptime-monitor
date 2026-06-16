-- MySQL Schema for API Uptime Monitor
-- This schema initializes the necessary tables for authentication, monitor definitions, check logs, and incident tracking.

CREATE DATABASE IF NOT EXISTS `uptime_monitor`;
USE `uptime_monitor`;

-- 1. Users Table
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(255) NOT NULL,
  `email` VARCHAR(255) NOT NULL UNIQUE,
  `password_hash` VARCHAR(255) NOT NULL,
  `is_verified` TINYINT(1) DEFAULT 0,
  `verification_code` VARCHAR(6) DEFAULT NULL,
  `verification_expires` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Monitors Table
CREATE TABLE IF NOT EXISTS `monitors` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `url` VARCHAR(2048) NOT NULL,
  `status` VARCHAR(50) DEFAULT 'PENDING', -- UP, DOWN, PENDING
  `is_active` TINYINT(1) DEFAULT 1,       -- 1 = Active, 0 = Paused
  `last_checked` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  INDEX (`user_id`),
  INDEX (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Checks Table (Stores individual ping results, capped or rotated in production)
CREATE TABLE IF NOT EXISTS `checks` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `monitor_id` INT NOT NULL,
  `status` VARCHAR(50) NOT NULL,          -- UP, DOWN
  `status_code` INT DEFAULT NULL,
  `response_time_ms` INT DEFAULT NULL,
  `error_message` TEXT DEFAULT NULL,
  `timestamp` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`monitor_id`) REFERENCES `monitors`(`id`) ON DELETE CASCADE,
  INDEX (`monitor_id`),
  INDEX (`timestamp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Incidents Table (Downtime records)
CREATE TABLE IF NOT EXISTS `incidents` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `monitor_id` INT NOT NULL,
  `down_time` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `up_time` TIMESTAMP NULL DEFAULT NULL,
  `error_message` TEXT DEFAULT NULL,
  `duration_minutes` INT DEFAULT NULL,
  FOREIGN KEY (`monitor_id`) REFERENCES `monitors`(`id`) ON DELETE CASCADE,
  INDEX (`monitor_id`),
  INDEX (`down_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
