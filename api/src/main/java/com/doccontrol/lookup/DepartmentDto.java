package com.doccontrol.lookup;

/** API shape of a department. */
public record DepartmentDto(
        Integer id,
        String code,
        String label,
        boolean active,
        Long documentCount,
        Long memberCount) {

    public DepartmentDto(Integer id, String code, String label, boolean active) {
        this(id, code, label, active, null, null);
    }

    public static DepartmentDto from(Department department) {
        return new DepartmentDto(department.getId(), department.getCode(), department.getLabel(),
                department.isActive(), null, null);
    }

    public static DepartmentDto of(Department department, Long documentCount, Long memberCount) {
        return new DepartmentDto(department.getId(), department.getCode(), department.getLabel(),
                department.isActive(), documentCount, memberCount);
    }
}
