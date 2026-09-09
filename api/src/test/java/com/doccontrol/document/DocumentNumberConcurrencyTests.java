package com.doccontrol.document;

import com.doccontrol.identity.User;
import com.doccontrol.identity.UserRepository;
import com.doccontrol.lookup.Department;
import com.doccontrol.lookup.DepartmentRepository;
import com.doccontrol.lookup.DocumentTypeRepository;
import com.doccontrol.security.AppUserPrincipal;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Proves the row-level lock on document_sequence_counter: concurrent creates
 * for the same (type, department) pair must get distinct, sequential numbers.
 * This test commits real data (it needs real concurrent transactions), so it
 * cleans up after itself.
 */
@SpringBootTest
class DocumentNumberConcurrencyTests {

    @Autowired
    DocumentService documentService;

    @Autowired
    UserRepository userRepository;

    @Autowired
    DepartmentRepository departmentRepository;

    @Autowired
    DocumentTypeRepository documentTypeRepository;

    @Autowired
    JdbcTemplate jdbcTemplate;

    @Test
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    void concurrentCreatesGetDistinctSequentialNumbers() throws Exception {
        String deptCode = "CC" + System.nanoTime() % 100000;
        Department dept = new Department();
        dept.setCode(deptCode);
        dept.setLabel("Concurrency Temp");
        dept.setActive(true);
        Integer deptId = departmentRepository.save(dept).getId();

        Integer typeId = documentTypeRepository.findAll().stream()
                .filter(type -> "SOP".equals(type.getCode()))
                .findFirst().orElseThrow().getId();

        User creator = new User();
        creator.setName("concurrency@doccontrol.test");
        creator.setEmail("concurrency@doccontrol.test");
        creator.setDepartment(departmentRepository.findByCode("QA").orElseThrow());
        creator.setPasswordHash("x");
        creator.setActive(true);
        Integer creatorId = userRepository.save(creator).getId();

        Authentication creatorAuth = new UsernamePasswordAuthenticationToken(
                new AppUserPrincipal(creatorId, creator.getEmail(), "x", true,
                        Set.of(new SimpleGrantedAuthority("ROLE_USER"))),
                null, List.of(new SimpleGrantedAuthority("ROLE_USER")));

        CyclicBarrier barrier = new CyclicBarrier(2);

        Callable<String> task = () -> {
            barrier.await(10, TimeUnit.SECONDS);
            SecurityContextHolder.getContext().setAuthentication(creatorAuth);
            try {
                return documentService
                        .create(typeId, deptId, "Concurrent " + Thread.currentThread().getName())
                        .documentNumber();
            } finally {
                SecurityContextHolder.clearContext();
            }
        };

        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            List<Future<String>> futures = List.of(pool.submit(task), pool.submit(task));
            List<String> numbers = new java.util.ArrayList<>();
            for (Future<String> future : futures) {
                numbers.add(future.get(30, TimeUnit.SECONDS));
            }
            assertThat(numbers).containsExactlyInAnyOrder(
                    "SOP-" + deptCode + "-0001", "SOP-" + deptCode + "-0002");
        } finally {
            pool.shutdownNow();
            cleanup(deptId, creatorId);
        }
    }

    private void cleanup(Integer deptId, Integer userId) {
        jdbcTemplate.update("DELETE FROM audit_log WHERE performed_by = ?", userId);
        jdbcTemplate.update("DELETE FROM document WHERE department_id = ?", deptId);
        jdbcTemplate.update("DELETE FROM document_sequence_counter WHERE department_id = ?", deptId);
        jdbcTemplate.update("DELETE FROM \"user\" WHERE id = ?", userId);
        jdbcTemplate.update("DELETE FROM department WHERE id = ?", deptId);
    }
}
