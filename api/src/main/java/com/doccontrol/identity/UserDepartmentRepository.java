package com.doccontrol.identity;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface UserDepartmentRepository extends JpaRepository<UserDepartment, UserDepartmentId> {

    @Query("SELECT ud FROM UserDepartment ud WHERE ud.id.userId = :userId")
    List<UserDepartment> findByUserId(@Param("userId") Integer userId);

    @Query("SELECT ud.level FROM UserDepartment ud " +
           "WHERE ud.id.userId = :userId AND ud.id.departmentId = :departmentId")
    Optional<MembershipLevel> findLevelByUserIdAndDepartmentId(
            @Param("userId") Integer userId, @Param("departmentId") Integer departmentId);

    @Query("SELECT COUNT(ud) FROM UserDepartment ud JOIN ud.user u " +
           "WHERE ud.department.id = :departmentId AND u.active = true")
    long countActiveUsersByDepartmentId(@Param("departmentId") Integer departmentId);

    @Query("SELECT ud FROM UserDepartment ud WHERE ud.department.id = :departmentId")
    List<UserDepartment> findAllByDepartmentId(@Param("departmentId") Integer departmentId);

    @Query("SELECT ud.department.id FROM UserDepartment ud " +
           "WHERE ud.id.userId = :userId AND ud.level = :level")
    List<Integer> findDepartmentIdsByUserIdAndLevel(
            @Param("userId") Integer userId, @Param("level") MembershipLevel level);
}
