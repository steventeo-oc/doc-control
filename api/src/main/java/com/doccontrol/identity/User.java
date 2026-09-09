package com.doccontrol.identity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.OneToMany;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.HashSet;
import java.util.Set;

/**
 * Maps the "user" table. The table name is quoted because "user" is a
 * reserved word in PostgreSQL. Departments are many-to-many since Phase 2a
 * (see {@link UserDepartment}) — a user belongs to one or more departments.
 */
@Entity
@Table(name = "\"user\"")
@Getter
@Setter
@NoArgsConstructor
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Integer id;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false, unique = true)
    private String email;

    @Column(name = "ad_username")
    private String adUsername;

    /**
     * bcrypt hash; null is allowed so future AD/LDAP-sourced accounts can
     * leave it unused (see CLAUDE.md schema decisions).
     */
    @Column(name = "password_hash")
    private String passwordHash;

    @Column(nullable = false)
    private boolean active = true;

    @OneToMany(mappedBy = "user", fetch = FetchType.LAZY)
    private Set<UserRole> roles = new HashSet<>();

    @OneToMany(mappedBy = "user", fetch = FetchType.LAZY)
    private Set<UserDepartment> departments = new HashSet<>();
}
