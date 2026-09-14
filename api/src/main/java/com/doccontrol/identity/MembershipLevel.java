package com.doccontrol.identity;

/**
 * A department membership's permission level (Department_Levels_Design_PlanBack.md).
 * MANAGER manages everything in the department including member levels;
 * COLLABORATOR edits anything in the department but deletes only its own;
 * CONTRIBUTOR works only on its own documents; CONSUMER reads and
 * downloads only. There is no default: every membership assignment states
 * its level explicitly (V8's one-time COLLABORATOR retrofit is the sole
 * exception, documented in the migration).
 */
public enum MembershipLevel {
    MANAGER,
    COLLABORATOR,
    CONTRIBUTOR,
    CONSUMER
}
