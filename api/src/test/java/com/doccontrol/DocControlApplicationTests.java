package com.doccontrol;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * Boots the full context against a real PostgreSQL instance: runs Flyway
 * migrations and validates every entity mapping against the actual schema
 * (ddl-auto=validate). Requires the database to be reachable — see README.
 */
@SpringBootTest
class DocControlApplicationTests {

    @Test
    void contextLoads() {
    }
}
