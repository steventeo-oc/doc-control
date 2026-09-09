package com.doccontrol.identity;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface UserDepartmentRepository extends JpaRepository<UserDepartment, UserDepartmentId> {

    @Query("SELECT ud FROM UserDepartment ud WHERE ud.id.userId = :userId")
    List<UserDepartment> findByUserId(@Param("userId") Integer userId);
}
