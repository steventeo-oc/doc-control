package com.doccontrol;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class DocControlApplication {

    public static void main(String[] args) {
        SpringApplication.run(DocControlApplication.class, args);
    }
}
