# Document Control System — API Specification (Draft v1)

Builds directly on `Document_Control_Data_Model_v1.md`. Grouped by resource,
with notes on which endpoints are needed for Sprint 1 (core repository) vs.
Sprint 3 (workflow). All endpoints require authentication unless noted;
responses are JSON.

**Auth note:** every write endpoint should log to `audit_log` automatically
at the service layer — not something callers opt into. This is what makes
the ISO 9001 audit trail complete without relying on developers remembering
to add logging calls in every handler.

---

## 1. Auth

| Method | Path | Description | Sprint |
|---|---|---|---|
| POST | `/auth/login` | Local login (username/password), or redirect target for AD/LDAP SSO | 1 |
| POST | `/auth/logout` | Invalidate current session/token | 1 |
| GET | `/auth/me` | Current user's profile, department, roles | 1 |

---

## 2. Lookup resources (extensible type/department lists)

Read access for everyone; write access restricted to an "Admin" role. This is
what makes new document types/departments a data change, not a code change.

| Method | Path | Description | Sprint |
|---|---|---|---|
| GET | `/document-tiers` | List tiers (Tier 1–4) | 1 |
| GET | `/document-types` | List active document types (SOP, WI, FORM...) | 1 |
| POST | `/document-types` | Create a new type — admin only | 1 |
| PATCH | `/document-types/{id}` | Update label / deactivate a type | 1 |
| GET | `/departments` | List active departments | 1 |
| POST | `/departments` | Create a new department — admin only | 1 |
| PATCH | `/departments/{id}` | Update / deactivate a department | 1 |

---

## 3. Documents

| Method | Path | Description | Sprint |
|---|---|---|---|
| GET | `/documents` | List/search documents. Query params: `type`, `department`, `status`, `q` (full text), `page`, `page_size` | 1 |
| POST | `/documents` | Create a new document. Body: `document_type_id`, `department_id`, `name`, `file`. Server auto-generates `document_number` from `document_sequence_counter` and creates version 1 | 1 |
| GET | `/documents/{id}` | Document detail — metadata, current status, current version, owner | 1 |
| PATCH | `/documents/{id}` | Update metadata (name, owner) — not the file itself | 1 |
| DELETE | `/documents/{id}` | Soft delete — moves to trash, does not purge | 1 |
| POST | `/documents/{id}/restore` | Restore a trashed document | 1 |

### Example: create document response
```json
{
  "id": 481,
  "document_number": "SOP-QA-0011",
  "name": "Incoming Inspection Procedure",
  "status": "draft",
  "current_version_id": 1102,
  "owner_user_id": 14,
  "created_at": "2026-09-04T10:15:00Z"
}
```

---

## 4. Versions

| Method | Path | Description | Sprint |
|---|---|---|---|
| GET | `/documents/{id}/versions` | Full version history for a document | 1 |
| POST | `/documents/{id}/versions` | Upload a new version. Body: `file`, `change_notes`. Auto-increments `version_number`, status `draft` | 1 |
| GET | `/documents/{id}/versions/{version_id}` | Version detail | 1 |
| GET | `/documents/{id}/versions/{version_id}/download` | Download the file for this version | 1 |
| POST | `/documents/{id}/versions/{version_id}/promote` | Mark this version as `current` (called automatically when a workflow completes with approval) | 3 |

---

## 5. Workflow

Schema exists from Sprint 1 (see data model doc), but these endpoints are
built in Sprint 3, once the first real workflow template is configured.

| Method | Path | Description | Sprint |
|---|---|---|---|
| GET | `/workflow-templates` | List available templates | 3 |
| POST | `/workflow-templates` | Create a template (name, applicable type/department, stages) — admin only | 3 |
| GET | `/workflow-templates/{id}/stages` | List stages for a template, in order | 3 |
| POST | `/documents/{id}/versions/{version_id}/workflow/start` | Start approval. Body: `template_id`. Creates a `workflow_instance` and tasks for stage 1 | 3 |
| GET | `/workflow-instances/{id}` | Instance status, current stage, all tasks | 3 |
| GET | `/workflow-instances/{id}/tasks` | Tasks for this instance | 3 |
| POST | `/workflow-tasks/{id}/complete` | Reviewer action. Body: `outcome` (`approved`/`rejected`), `comment`. Server checks the stage's `required_approval_percentage`; if met, advances to next stage or completes the instance and promotes the version | 3 |
| GET | `/my/tasks` | Tasks currently assigned to the logged-in user, pending only | 3 |

### Example: complete a review task
```
POST /workflow-tasks/2291/complete
{
  "outcome": "approved",
  "comment": "Looks good, no changes needed."
}
```
Server-side, this checks whether all required reviewers in the current stage
have responded and whether the approval percentage threshold is met — mirrors
the "Required Approval Percentage: 100" behavior seen in the current Alfresco
workflow.

---

## 6. Search

| Method | Path | Description | Sprint |
|---|---|---|---|
| GET | `/search/documents` | Full-text + metadata search. Query params: `q`, `type`, `department`, `status`. Results filtered to what the caller is permitted to see | 4 |

---

## 7. Audit log

| Method | Path | Description | Sprint |
|---|---|---|---|
| GET | `/audit-log` | Query audit entries. Params: `entity_type`, `entity_id`, `from`, `to`, `performed_by` — admin/auditor role only | 4 |
| GET | `/audit-log/export` | Export filtered results as CSV, for ISO 9001 audit evidence | 4 |

---

## 8. Users & roles (admin)

| Method | Path | Description | Sprint |
|---|---|---|---|
| GET | `/users` | List users — admin only | 1 |
| POST | `/users` | Create a user (if not using AD/LDAP sync) | 1 |
| PATCH | `/users/{id}` | Update department/active status | 1 |
| GET | `/roles` | List roles | 1 |

---

## 9. Notes for the dev team

- **Every POST/PATCH/DELETE above should write an `audit_log` row** at the
  service layer automatically — don't leave this to individual endpoint
  authors to remember.
- **Document numbers are never client-supplied.** The `document_number` is
  always server-generated from `document_sequence_counter`, so there's no
  path for a client to request or guess a specific number and cause a
  collision.
- **Permission checks belong in the service layer, not just the route.**
  `GET /documents` and `/search/documents` must filter by what the caller's
  role/department is allowed to see, not rely on the frontend hiding rows.
- **Sprint boundary is a guide, not a hard wall** — if the workflow schema
  turns out to need a field once Sprint 3 starts (e.g. from the ENG/PROD
  approval-chain differences), that's expected and cheap to add now, not a
  sign something went wrong in Sprint 1.
