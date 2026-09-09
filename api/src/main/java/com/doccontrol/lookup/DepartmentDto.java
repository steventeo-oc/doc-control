package com.doccontrol.lookup;

/** API shape of a department. */
public record DepartmentDto(Integer id, String code, String label, boolean active) {

    public static DepartmentDto from(Department department) {
        return new DepartmentDto(department.getId(), department.getCode(), department.getLabel(),
                department.isActive());
    }
}
