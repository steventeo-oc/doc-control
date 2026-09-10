package com.doccontrol.identity;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface UserRepository extends JpaRepository<User, Integer> {

    Optional<User> findByEmailIgnoreCase(String email);

    boolean existsByEmailIgnoreCase(String email);

    /** Active users holding any of the given roles (e.g. pooled-task reviewers, Admins). */
    @Query("SELECT DISTINCT u FROM User u JOIN u.roles ur JOIN ur.role r " +
            "WHERE r.name IN :roleNames AND u.active = true")
    List<User> findActiveByRoleNames(@Param("roleNames") List<String> roleNames);

    /** Active administrators — escalation targets for overdue approvals. */
    @Query("SELECT DISTINCT u FROM User u JOIN u.roles ur JOIN ur.role r " +
            "WHERE r.name = 'Admin' AND u.active = true")
    List<User> findActiveAdmins();

    /** Active members of a department — the acknowledgment population (Phase 2d). */
    @Query("SELECT DISTINCT u FROM User u JOIN u.departments ud " +
            "WHERE ud.id.departmentId = :departmentId AND u.active = true")
    List<User> findActiveByDepartmentId(@Param("departmentId") Integer departmentId);
}
