package com.doccontrol.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Settings for the one-time initial admin account created at first startup
 * (see AdminBootstrap). The password default is for local development only —
 * real deployments must override it via DOCCONTROL_BOOTSTRAP_ADMIN_PASSWORD.
 */
@ConfigurationProperties(prefix = "doccontrol.bootstrap")
public record BootstrapProperties(String adminEmail, String adminPassword, String adminDepartment) {
}
