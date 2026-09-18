package com.doccontrol.identity;

import com.doccontrol.security.CurrentUserProvider;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

/**
 * The level-aware permission predicates (Department_Levels_Design_PlanBack.md
 * section 1) that replace Phase 2a's flat member-or-admin rule. Admins
 * bypass everything exactly as before — the short-circuit is first in every
 * predicate and admins hold no membership rows.
 *
 * Two document predicates cover the whole confirmed matrix:
 * {@link #canEdit} (metadata, versions, start approval, reviewer
 * candidates, original download, full version history) and
 * {@link #canManageDocument} (soft-delete/restore) — plus
 * {@link #canCreate} for the department-scoped creation gate and
 * {@link #canManageMembers} for Manager self-service.
 */
@Service
public class DepartmentAccessService {

    private final UserDepartmentRepository userDepartmentRepository;
    private final CurrentUserProvider currentUserProvider;

    public DepartmentAccessService(UserDepartmentRepository userDepartmentRepository,
                                   CurrentUserProvider currentUserProvider) {
        this.userDepartmentRepository = userDepartmentRepository;
        this.currentUserProvider = currentUserProvider;
    }

    /** The caller's membership level in the department, or empty when not a member. */
    @Transactional(readOnly = true)
    public Optional<MembershipLevel> levelOfCurrentUser(Integer departmentId) {
        return userDepartmentRepository.findLevelByUserIdAndDepartmentId(
                currentUserProvider.getCurrentUserId(), departmentId);
    }

    /** The given user's membership level in the department, or empty when not a member. */
    @Transactional(readOnly = true)
    public Optional<MembershipLevel> levelOf(Integer userId, Integer departmentId) {
        return userDepartmentRepository.findLevelByUserIdAndDepartmentId(userId, departmentId);
    }

    /** Viewing department details and activity: members or admins. */
    public boolean canAccess(Integer departmentId) {
        if (currentUserProvider.isAdmin()) {
            return true;
        }
        return levelOfCurrentUser(departmentId).isPresent();
    }

    /** Creating documents in the department: everything except CONSUMER. */
    public boolean canCreate(Integer departmentId) {
        if (currentUserProvider.isAdmin()) {
            return true;
        }
        return levelOfCurrentUser(departmentId)
                .map(level -> level != MembershipLevel.CONSUMER)
                .orElse(false);
    }

    /**
     * Edit a document (metadata, versions, start approval, reviewer
     * candidates, original download, full version history): MANAGER and
     * COLLABORATOR on any document in the department, CONTRIBUTOR on its
     * own documents only, CONSUMER never.
     */
    public boolean canEdit(Integer ownerId, Integer departmentId) {
        if (currentUserProvider.isAdmin()) {
            return true;
        }
        MembershipLevel level = levelOfCurrentUser(departmentId).orElse(null);
        if (level == null) {
            return false;
        }
        return switch (level) {
            case MANAGER, COLLABORATOR -> true;
            case CONTRIBUTOR -> ownerId.equals(currentUserProvider.getCurrentUserId());
            case CONSUMER -> false;
        };
    }

    /**
     * Manage a document (soft-delete, restore): MANAGER on any document in
     * the department; COLLABORATOR and CONTRIBUTOR on their own documents
     * only ("edit-not-delete on others'"); CONSUMER never.
     */
    public boolean canManageDocument(Integer ownerId, Integer departmentId) {
        if (currentUserProvider.isAdmin()) {
            return true;
        }
        MembershipLevel level = levelOfCurrentUser(departmentId).orElse(null);
        if (level == null) {
            return false;
        }
        return switch (level) {
            case MANAGER -> true;
            case COLLABORATOR, CONTRIBUTOR -> ownerId.equals(currentUserProvider.getCurrentUserId());
            case CONSUMER -> false;
        };
    }

    /** Changing member levels in the department: MANAGER (or admin, as always). */
    public boolean canManageMembers(Integer departmentId) {
        if (currentUserProvider.isAdmin()) {
            return true;
        }
        return levelOfCurrentUser(departmentId).orElse(null) == MembershipLevel.MANAGER;
    }

    /**
     * Departments where the caller holds MANAGER — the trash view's
     * "managed" set (nav restructure plan-back F2).
     */
    @Transactional(readOnly = true)
    public List<Integer> managedDepartmentIdsOfCurrentUser() {
        return userDepartmentRepository.findDepartmentIdsByUserIdAndLevel(
                currentUserProvider.getCurrentUserId(), MembershipLevel.MANAGER);
    }
}
