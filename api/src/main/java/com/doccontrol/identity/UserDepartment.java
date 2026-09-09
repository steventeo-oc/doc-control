package com.doccontrol.identity;

import com.doccontrol.lookup.Department;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * Join table for the user <-> department many-to-many (Phase 2a — mirrors
 * user_role). Replaces the singular user.department_id column.
 */
@Entity
@Table(name = "user_department")
@Getter
@Setter
@NoArgsConstructor
public class UserDepartment {

    @EmbeddedId
    private UserDepartmentId id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", insertable = false, updatable = false)
    private User user;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "department_id", insertable = false, updatable = false)
    private Department department;
}
