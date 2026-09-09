package com.doccontrol.identity;

import org.springframework.data.domain.Sort;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** Admin-only (SecurityConfig: /roles requires ROLE_ADMIN). */
@RestController
public class RoleController {

    private final RoleRepository roleRepository;

    public RoleController(RoleRepository roleRepository) {
        this.roleRepository = roleRepository;
    }

    @GetMapping("/roles")
    public List<RoleDto> list() {
        return roleRepository.findAll(Sort.by("name")).stream()
                .map(RoleDto::from)
                .toList();
    }
}
