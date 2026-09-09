package com.doccontrol.identity;

import com.doccontrol.config.BootstrapProperties;
import com.doccontrol.lookup.Department;
import com.doccontrol.lookup.DepartmentRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Creates the initial admin account once, at first startup, when the user
 * table is empty. Credentials come from configuration (doccontrol.bootstrap.*,
 * overridable via DOCCONTROL_BOOTSTRAP_ADMIN_* env vars) — never hardcoded.
 * After this runs, the account is managed like any other user; later startups
 * never touch it.
 */
@Component
public class AdminBootstrap implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(AdminBootstrap.class);

    private final UserRepository userRepository;
    private final UserRoleRepository userRoleRepository;
    private final RoleRepository roleRepository;
    private final DepartmentRepository departmentRepository;
    private final PasswordEncoder passwordEncoder;
    private final BootstrapProperties properties;

    public AdminBootstrap(UserRepository userRepository, UserRoleRepository userRoleRepository,
                          RoleRepository roleRepository, DepartmentRepository departmentRepository,
                          PasswordEncoder passwordEncoder, BootstrapProperties properties) {
        this.userRepository = userRepository;
        this.userRoleRepository = userRoleRepository;
        this.roleRepository = roleRepository;
        this.departmentRepository = departmentRepository;
        this.passwordEncoder = passwordEncoder;
        this.properties = properties;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
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
}
