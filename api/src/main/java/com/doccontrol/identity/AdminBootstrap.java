package com.doccontrol.identity;

import com.doccontrol.config.BootstrapProperties;
import com.doccontrol.lookup.Department;
import com.doccontrol.lookup.DepartmentRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.env.Environment;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.Arrays;

/**
 * Creates the initial admin account once, at first startup, when the user
 * table is empty. Credentials come from configuration (doccontrol.bootstrap.*,
 * overridable via DOCCONTROL_BOOTSTRAP_ADMIN_* env vars) — never hardcoded.
 * After this runs, the account is managed like any other user; later startups
 * never touch it.
 *
 * Guard: development default credentials always produce a loud warning, and
 * startup HARD FAILS when a prod-like profile is active with them — an
 * accidentally deployed default admin is exactly the failure mode this
 * prevents (see go-live checklist).
 */
@Component
public class AdminBootstrap implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(AdminBootstrap.class);

    static final String DEV_DEFAULT_EMAIL = "admin@doccontrol.local";
    static final String DEV_DEFAULT_PASSWORD = "changeme_admin";

    private final UserRepository userRepository;
    private final UserRoleRepository userRoleRepository;
    private final RoleRepository roleRepository;
    private final DepartmentRepository departmentRepository;
    private final PasswordEncoder passwordEncoder;
    private final BootstrapProperties properties;
    private final Environment environment;

    public AdminBootstrap(UserRepository userRepository, UserRoleRepository userRoleRepository,
                          RoleRepository roleRepository, DepartmentRepository departmentRepository,
                          PasswordEncoder passwordEncoder, BootstrapProperties properties,
                          Environment environment) {
        this.userRepository = userRepository;
        this.userRoleRepository = userRoleRepository;
        this.roleRepository = roleRepository;
        this.departmentRepository = departmentRepository;
        this.passwordEncoder = passwordEncoder;
        this.properties = properties;
        this.environment = environment;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        if (usesDevelopmentDefaults(properties.adminEmail(), properties.adminPassword())) {
            String[] profiles = environment.getActiveProfiles();
            if (isProdLikeProfile(profiles)) {
                throw new IllegalStateException(
                        "Refusing to start with development default administrator credentials under "
                                + "profile(s) " + Arrays.toString(profiles)
                                + ". Set DOCCONTROL_BOOTSTRAP_ADMIN_EMAIL and "
                                + "DOCCONTROL_BOOTSTRAP_ADMIN_PASSWORD.");
            }
            log.warn("Bootstrap admin uses DEVELOPMENT DEFAULT credentials ({} / {}). Acceptable for "
                    + "local development only - override DOCCONTROL_BOOTSTRAP_ADMIN_EMAIL and "
                    + "DOCCONTROL_BOOTSTRAP_ADMIN_PASSWORD before any real deployment.",
                    DEV_DEFAULT_EMAIL, DEV_DEFAULT_PASSWORD);
        }

        if (userRepository.count() > 0) {
            return;
        }

        Department department = departmentRepository.findByCode(properties.adminDepartment())
                .orElseThrow(() -> new IllegalStateException(
                        "Bootstrap department '" + properties.adminDepartment() + "' does not exist — seed data missing?"));
        Role adminRole = roleRepository.findByName("Admin")
                .orElseThrow(() -> new IllegalStateException("Role 'Admin' does not exist — seed data missing?"));

        User admin = new User();
        admin.setName("Administrator");
        admin.setEmail(properties.adminEmail());
        admin.setDepartment(department);
        admin.setPasswordHash(passwordEncoder.encode(properties.adminPassword()));
        admin.setActive(true);
        userRepository.save(admin);

        UserRole membership = new UserRole();
        membership.setId(new UserRoleId(admin.getId(), adminRole.getId()));
        membership.setUser(admin);
        membership.setRole(adminRole);
        userRoleRepository.save(membership);

        log.info("Bootstrapped initial admin account {} (department {}, role Admin).",
                admin.getEmail(), department.getCode());
    }

    static boolean usesDevelopmentDefaults(String email, String password) {
        return DEV_DEFAULT_EMAIL.equalsIgnoreCase(email) || DEV_DEFAULT_PASSWORD.equals(password);
    }

    static boolean isProdLikeProfile(String... activeProfiles) {
        return Arrays.stream(activeProfiles)
                .anyMatch(profile -> profile.equalsIgnoreCase("prod") || profile.equalsIgnoreCase("production"));
    }
}
