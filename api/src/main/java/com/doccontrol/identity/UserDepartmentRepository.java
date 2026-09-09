package com.doccontrol.identity;

import org.springframework.data.jpa.repository.JpaRepository;

public interface UserDepartmentRepository extends JpaRepository<UserDepartment, UserDepartmentId> {
}
