package com.doccontrol.lookup;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface DepartmentRepository extends JpaRepository<Department, Integer> {

    Optional<Department> findByCode(String code);

    List<Department> findAllByActiveTrueOrderByCodeAsc();
}
