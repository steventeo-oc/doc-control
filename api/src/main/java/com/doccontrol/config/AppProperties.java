package com.doccontrol.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

@ConfigurationProperties(prefix = "app")
public record AppProperties(@DefaultValue("http://localhost:3000") String baseUrl) {
}
