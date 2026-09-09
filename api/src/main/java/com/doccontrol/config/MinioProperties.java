package com.doccontrol.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "doccontrol.storage")
public record MinioProperties(String endpoint, String accessKey, String secretKey, String bucket) {
}
