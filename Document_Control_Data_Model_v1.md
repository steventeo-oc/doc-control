# Document Control System — Data Model (Draft v1)

Prepared for dev team Sprint 1 kickoff. Reflects real structure pulled from the
current Alfresco instance (document ID scheme, L2/L3/L4 folder hierarchy) plus
decisions made during planning: extensible type/department lists, native
version control, and a stage-based (flexible) workflow model.

**Naming note:** the document hierarchy uses **"Tier"** (Tier 1–4), not
"Level," to avoid clashing with the manufacturing test levels (L6–L12) used
elsewhere in the company. Keep this distinction in all table/column/API names.

---

## 1. Lookup tables (extensible — no hardcoded types)

These exist so new document types or departments can be added later with a
row insert (or a small admin screen), never a code change or redeploy.

### `document_tier`
| Column | Type | Notes |
|---|---|---|
| id | int, PK | |
| tier_number | int | 1–4 today; extensible if a 5th tier is ever needed |
| label | text | e.g. "Policy", "Procedure", "Work Instruction", "Form/Record" |
| active | boolean | soft-disable instead of deleting |

### `document_type`
| Column | Type | Notes |
|---|---|---|
| id | int, PK | |
| code | text, unique | e.g. `SOP`, `WI`, `FORM`, `DWG` — used in the document ID |
| label | text | e.g. "Standard Operating Procedure" |
| tier_id | int, FK → document_tier | which tier this type belongs to |
| active | boolean | |

### `department`
| Column | Type | Notes |
|---|---|---|
| id | int, PK | |
| code | text, unique | e.g. `QA`, `ENG`, `PROD`, `HR` |
| label | text | e.g. "Quality Assurance" |
| active | boolean | |

### `document_sequence_counter`
Tracks the next available number per Type + Department, so IDs are
system-generated (never hand-typed) and gaps (like the unused `SOP-QA-0003`
seen in the current system) are allowed and expected.

| Column | Type | Notes |
|---|---|---|
| id | int, PK | |
| document_type_id | int, FK → document_type | |
| department_id | int, FK → department | |
| next_sequence_number | int | incremented on each new document of this type+dept |

---

## 2. Core document entities

### `document`
The "folder" for a document — its identity and current state. Content and
history live in `document_version`, not here.

| Column | Type | Notes |
|---|---|---|
| id | int, PK | |
| document_number | text, unique | generated, e.g. `SOP-QA-0011` — Type + Dept + Sequence |
| document_type_id | int, FK → document_type | |
| department_id | int, FK → department | |
| sequence_number | int | the numeric part of the ID |
| name | text | descriptive name (replaces the unused "Title" field seen in current system — this becomes the one authoritative name field) |
| status | enum | `draft`, `in_review`, `approved`, `released`, `superseded`, `obsolete` |
| current_version_id | int, FK → document_version, nullable | points to the live version |
| owner_user_id | int, FK → user | who owns/maintains this document |
| created_at | timestamp | |
| updated_at | timestamp | |

### `document_version`
Real, system-tracked versioning — replaces the current pattern of embedding
"Rev 0" / "Rev 1" in the filename.

| Column | Type | Notes |
|---|---|---|
| id | int, PK | |
| document_id | int, FK → document | |
| version_number | int | auto-incremented per document (1, 2, 3...) |
| file_reference | text | path/URL to the stored file (object storage) |
| legacy_revision_label | text, nullable | optional — store old "Rev 0" style labels during migration for continuity, not used going forward |
| status | enum | `draft`, `current`, `superseded` |
| change_notes | text, nullable | what changed in this version |
| uploaded_by | int, FK → user | |
| uploaded_at | timestamp | |

---

## 3. Workflow (stage-based, built flexible from the start)

These tables exist from Sprint 1 so the model never needs a rewrite — but
**only one template needs to be configured for Sprint 3** (matching the
current QA process: single stage, parallel reviewers, 100% approval
required). Additional templates for other departments get added later as
data, not code changes.

### `workflow_template`
| Column | Type | Notes |
|---|---|---|
| id | int, PK | |
| name | text | e.g. "QA Standard Approval" |
| document_type_id | int, FK, nullable | null = applies to any type |
| department_id | int, FK, nullable | null = applies to any department |
| active | boolean | |

### `workflow_stage`
Ordered stages within a template — supports both parallel-only (today) and
sequential multi-department chains (future) using the same structure.

| Column | Type | Notes |
|---|---|---|
| id | int, PK | |
| template_id | int, FK → workflow_template | |
| stage_order | int | 1, 2, 3... execution order |
| name | text | e.g. "Review", "Final Approval" |
| approval_mode | enum | `parallel` or `single` |
| required_approval_percentage | int | default 100, matches current Alfresco setting |
| due_date_offset_days | int, nullable | deferred for now — field reserved for later |

### `workflow_stage_assignee`
| Column | Type | Notes |
|---|---|---|
| id | int, PK | |
| stage_id | int, FK → workflow_stage | |
| user_id | int, FK → user, nullable | specific person |
| role_id | int, FK → role, nullable | or assign by role instead of named person |

### `workflow_instance`
One per document version going through approval.

| Column | Type | Notes |
|---|---|---|
| id | int, PK | |
| document_version_id | int, FK → document_version | |
| template_id | int, FK → workflow_template | |
| current_stage_id | int, FK → workflow_stage, nullable | |
| status | enum | `in_progress`, `completed`, `rejected` |
| started_by | int, FK → user | |
| started_at | timestamp | |
| completed_at | timestamp, nullable | |

### `workflow_task`
Individual reviewer actions within a stage.

| Column | Type | Notes |
|---|---|---|
| id | int, PK | |
| instance_id | int, FK → workflow_instance | |
| stage_id | int, FK → workflow_stage | |
| assigned_to_user_id | int, FK → user | |
| outcome | enum | `pending`, `approved`, `rejected` |
| comment | text, nullable | |
| completed_at | timestamp, nullable | |

---

## 4. Identity & audit

### `user`
| Column | Type | Notes |
|---|---|---|
| id | int, PK | |
| name | text | |
| email | text, unique | |
| department_id | int, FK → department | |
| ad_username | text, nullable | for LDAP/AD integration, if in use |
| active | boolean | |

### `role`
| Column | Type | Notes |
|---|---|---|
| id | int, PK | |
| name | text | e.g. "QA Reviewer", "Document Owner" |

### `audit_log`
Every meaningful action, for ISO 9001 audit trail export.

| Column | Type | Notes |
|---|---|---|
| id | int, PK | |
| entity_type | text | e.g. `document`, `document_version`, `workflow_task` |
| entity_id | int | id of the affected row |
| action | text | e.g. `created`, `status_changed`, `approved`, `rejected` |
| performed_by | int, FK → user | |
| performed_at | timestamp | |
| details | json, nullable | before/after values where relevant |

---

## 5. What this enables immediately

- **New document type or department later?** Insert one row — no code change.
- **A department needs a different approval chain?** Add a new
  `workflow_template` + `workflow_stage` rows — the engine already supports it.
- **Document ID collisions?** Impossible — `document_sequence_counter` is the
  single source of truth for the next number per Type + Department.
- **"Which version was live when this was tested?"** (future MES link) —
  answerable directly from `document_version`, once that integration is built.

## 6. Explicitly deferred (not in Sprint 1)

- Due dates / reminder nudges on workflow stages (field reserved, logic deferred per request)
- Workflow template configuration UI (Sprint 1 ships with templates seeded directly in the database)
- Migration of existing Alfresco content (separate decision — see open items)
