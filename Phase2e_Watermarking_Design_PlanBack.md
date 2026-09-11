# Phase 2e — Watermarking on Export: Design Plan-Back

Companion to `Phase2_Roadmap.md` (#15) and `Phase2e_Watermark_Spike.md`.
Roadmap requirement: released documents get a visible mark (e.g.
"Uncontrolled if Printed") when exported/downloaded/printed. The
PDF-stamping library spike (2026-09-11) recommends **Apache PDFBox 3.x**;
this plan-back assumes that confirmation. *(Status: approved unchanged by
the owner and implemented 2026-09-11 — `WatermarkService`, `RenditionClient`,
the download pipeline in `DocumentVersionController`/`DocumentVersionService`,
the Gotenberg sidecar in compose, and `WatermarkServiceTests` /
`WatermarkEndpointTests` / `WatermarkDisabledTests`; 78 tests green; smoke
section 15 passes end-to-end against the real sidecar. The brand-font
baking step is confirmed unnecessary (owner, 2026-09-11: real SOPs use
standard fonts only).)*

Everything below is grounded in the code as it exists on main today:
`DocumentVersionController.download` →
`DocumentVersionService.openForDownload` → `findVisibleVersion` (the
404-not-leak visibility rule) → `FileStorageService.open`, plus the SPA's
`downloadFile` anchor-click in `web/src/api/client.ts`.

---

## 0. Rendition decision — LibreOffice headless in compose: confirmed sound

The owner's lean (self-hosted LibreOffice headless, consistent with the
project) was checked against current sourced research. Verdict: **sound,
with four complications to accept consciously** — none overturn the lean:

1. **Concurrency is the classic trap**: a LibreOffice user profile must
   never be touched by two processes — naive parallel
   `soffice --convert-to` silently no-ops. **Packaging answer: run it as
   the Gotenberg sidecar** (`gotenberg/gotenberg:8-libreoffice`, MIT,
   417 MB image), which wraps LibreOffice behind one HTTP endpoint
   (`POST /forms/libreoffice/convert`, multipart in → PDF out) and has
   the lock, restart-recycling (every 10 conversions), and timeout
   plumbing solved upstream. This *is* "LibreOffice headless in compose"
   — just packaged by people who solved the sharp edges.
2. **Resource cost**: budget ≥512 MiB–1 GiB RAM and ~0.2–1 CPU for the
   sidecar (one conversion ≈ one core); conversions are fast (98 ms for
   1 page, 2.3 s for 52 pages warm; cold start 2–4× that). Fine for a
   single-VM stack at this company's scale.
3. **Fidelity**: LibreOffice ships metric-compatible fonts (Carlito/
   Caladea for Calibri/Cambria, Liberation for Arial/Times/Courier), so
   typical Calibri/Arial business documents paginate correctly (glyph
   shapes differ slightly). Branded/company fonts must be baked into the
   image or those documents drift. LibreOffice is not a 1:1 MS Office
   clone (SmartArt and exotic styling can shift) — acceptable for
   read/distribute copies, which is exactly what a stamped rendition is.
4. **Non-Office types**: PDF originals pass through to the stamper
   directly (never re-render a PDF through LibreOffice Draw). Images
   convert. But **DWG is not supported (only DXF), and .msg/.eml not at
   all** — Graph's `?format=pdf` does handle those three, so a targeted
   Graph fallback remains possible later. For v1: non-renditionable
   types download as the unstamped original (flag F3).

Alternative considered and not recommended: JODConverter managing soffice
processes inside the api container (no new service, but bloats the api
image by ~400–700 MB and puts LO crashes/memory pressure inside the api's
process space). M365/Graph conversion as the *primary* path was rejected:
it uploads controlled documents into the tenant per download and adds
auth/throttling to every export; it remains the optional fallback for
DWG/msg/eml only.

## 1. Flags — decision points for the owner

### F1 — What gets marked: stamp by version state, not just "released"

The roadmap names released documents, but owners/admins can also download
draft and superseded versions (normal users can only ever reach the
current version — `findVisibleVersion` 404s the rest). Marking only
"released" would let uncontrolled *superseded* copies escape unmarked.
The stamping code is identical either way; only the text differs.

**Resolution (recommended)**: stamp every download of a renditionable
version, text by state — `current` (of a released document) →
"UNCONTROLLED IF PRINTED"; `superseded` → "SUPERSEDED — DO NOT USE";
`draft` → "DRAFT — UNCONTROLLED"; `approved` (pending effective) →
"APPROVED — NOT YET IN EFFECT". This is the standard ISO 9001
controlled-copy matrix and costs nothing beyond the released case.
Texts configurable (`doccontrol.watermark.text.*`), so QA can reword.

### F2 — A stamped download is a PDF: the original-vs-rendition UX

A .docx cannot be stamped; a rendition necessarily changes what arrives:
`application/pdf`, filename `<original-base>.pdf`, via the existing
`Content-Disposition`. The SPA needs **zero changes** (the anchor-click
download is fully server-driven), but users downloading a released SOP
get a stamped PDF, not the docx.

**Resolution (recommended)**: normal users always receive the rendition —
that is the control working as intended. Owners/admins additionally get
an explicit escape hatch: `GET …/download?original=true` (requires
`canModify`), returning the untouched original for editing/re-upload
loops, **audited** as `original_downloaded` (an unstamped copy leaving
the system is a control-relevant event worth a row; downloads of
renditions stay unaudited like today).

### F3 — Non-renditionable types pass through unstamped (for now)

DWG (and .msg/.eml) cannot be converted by LibreOffice. For v1 these
download as the original, unstamped, for everyone — with the type list
derived from the rendition client's capability, not hardcoded per
convention 3. This dovetails with the open go-live item on upload limits
(CAD in scope → 100 MB): CAD files also skip conversion cost entirely.
**Follow-up option recorded, not built**: a Graph-based conversion
fallback for exactly these types. QA should consciously accept that
CAD/email artifacts circulate unmarked until that exists.

### F4 — Fail closed when the rendition pipeline is unavailable

If the sidecar is down or a conversion times out, the choice is between
an unstamped original escaping (fail open) or a failed download (fail
closed). **Resolution (recommended): fail closed** — HTTP 503 with a
clear "rendition temporarily unavailable" message. The entire point of
#15 is that unstamped copies of controlled documents do not circulate;
silently shipping the original precisely when the system is unhealthy
would defeat it. `doccontrol.watermark.enabled=false` remains the
explicit, visible way to turn the whole behavior off (pre-watermark
pass-through) — an operational decision, not a silent fallback.

### F5 — Ephemeral stamping; renditions are never stored

The stamp is applied per request: original streamed from MinIO →
(optionally converted) → PDFBox stamp → response bytes discarded. MinIO
keeps only originals; the version of record is never a marked file;
`current_version_id` semantics untouched. No rendition caching in v1
(conversions are sub-second-to-seconds; caching is a later optimization
if usage ever demands it).

### F6 — Packaging: Gotenberg sidecar in compose

**Resolution (recommended)**: add `gotenberg/gotenberg:8-libreoffice` as
a compose service on the internal network; the api gets
`doccontrol.watermark.rendition-url` pointing at it. The api image stays
lean; the profile-lock/recycling/timeout problems stay solved upstream;
scaling later = replicas, not code. (The raw-soffice-in-api and
JODConverter-in-api alternatives were considered; see §0.)

### F7 — "Printed" needs no separate pipeline

There is no print feature in the SPA and none is added: the mark rides
on the stamped PDF the user saves and prints. Printing an unstamped
original is only possible via the owner/admin `original=true` path,
which is audited (F2).

## 2. Design

### 2.1 Download pipeline (the only touched code path)

```
GET /documents/{id}/versions/{versionId}/download[?original=true]
  findVisibleVersion(...)                    # unchanged visibility rules
  if original requested → require canModify, stream original, audit
  if !watermark.enabled or type not renditionable → stream original (unchanged)
  else:
    bytes = fileStorageService.open(...)     # MinIO stream, as today
    pdf  = contentType == application/pdf ? bytes : gotenberg.convert(bytes)
    out  = pdfbox.stamp(pdf, markTextFor(version))   # spike-verified code
    return out, contentType application/pdf, filename base + ".pdf"
```

- Stamp geometry per the spike: diagonal (~30°), translucent (~15%
  alpha), centered, standard-14 Helvetica Bold (no font embedding), every
  page; auto-fit font size so the text never clips (the spike measured
  48 pt clipping on LETTER; fit-to-page-width solves it).
- The controller gains a rendition branch; the streaming contract stays
  `InputStreamResource`/byte-array resource with corrected
  `contentLength` (the stamped size differs from the original).
- Conversion client: a small `RenditionClient` (JDK HttpClient, form
  POST to Gotenberg, response bytes) mirroring `GraphNotificationSender`'s
  no-SDK style; timeout configurable (default 30 s, Gotenberg's own).

### 2.2 Config

```yaml
doccontrol:
  watermark:
    enabled: true                 # false = pre-watermark pass-through
    rendition-url: http://gotenberg:3000   # compose network name
    rendition-timeout-seconds: 30
    text:
      current: "UNCONTROLLED IF PRINTED"
      superseded: "SUPERSEDED — DO NOT USE"
      draft: "DRAFT — UNCONTROLLED"
      approved: "APPROVED — NOT YET IN EFFECT"
```

Env-overridable (`DOCCONTROL_WATERMARK_*`), same pattern as every other
`doccontrol.*` knob. Compose gains the gotenberg service (no host port
exposed — internal network only) and interpolates the rendition URL.

### 2.3 Dependency

`org.apache.pdfbox:pdfbox:3.0.x` (per the spike; pulls fontbox). No
other new libraries.

## 3. What does not change

- Visibility rules: `findVisibleVersion` runs first, unchanged —
  stamping never creates a new way to reach a version.
- Uploads, storage, version-of-record semantics, `current_version_id`.
- The SPA: the download button works as-is (the server changes what it
  serves). Optionally a one-line hint on the versions table ("released
  documents download as stamped PDF renditions") — cosmetic, owner's
  call.
- No migration, no audit-schema change (one new audit action string for
  `original_downloaded` under the existing table).

## 4. Edge cases

| # | Situation | Decision |
|---|---|---|
| D1 | Sidecar down / conversion timeout | 503 fail-closed (F4); the download simply retries later. WARN logged with document/version. |
| D2 | PDF original | Stamped directly; never re-rendered through LibreOffice (research: Draw re-render corrupts fidelity for no gain). |
| D3 | Non-renditionable type (DWG, .msg/.eml) | Original, unstamped, for everyone (F3); recorded as a conscious QA accept. |
| D4 | Owner downloads a draft version of a released document | Marked "DRAFT — UNCONTROLLED" (F1 matrix) — owner/admin-only path today. |
| D5 | `original=true` by a non-modifier | 403; audited nothing (rejected attempts are visible in logs only). |
| D6 | Zero-page / corrupt stored file | Conversion or stamping throws → 503 (D1 path); the file is version-of-record damage that predates watermarking — surfaced loudly rather than papered over. |
| D7 | Very large files (100 MB CAD excepted — those pass through) | 52-page conversions measured at ~2.3 s; timeout guards the rest. |
| D8 | Watermarking disabled mid-life | Downloads revert to original pass-through instantly (config-only); no data was ever stored stamped (F5), so no backfill/cleanup exists to do. |

## 5. Explicitly out of scope

- Graph conversion fallback for DWG/.msg/.eml (recorded as the follow-up
  to F3).
- Rendition caching, per-user copy tracking, numbered-copy watermarks
  ("Copy 3 of 7"), QR/doc-control codes.
- Server-side "print" features; the mark rides on the PDF (F7).
- Stamping anything other than downloads (previews, thumbnails).

## 6. Test impact (when implementation is approved)

- Existing 63 tests stay green; download-endpoint tests gain
  content-type/filename expectations per the matrix (released → PDF
  rendition; disabled → original bytes).
- New coverage: stamp round-trip (stamp → text-extract/render → mark
  present, reusing the spike's pixel-diff technique as a unit test);
  the F1 matrix (current/superseded/draft/approved texts); PDF-original
  direct stamp; non-renditionable passthrough; fail-closed 503 on a
  rendition client that fails (mocked); `original=true` allowed for
  owner/admin + 403 for others + audit row; disabled flag passes
  originals through; SPA unchanged (no frontend tests exist).
- An end-to-end check against real Gotenberg belongs in
  `scripts/smoke.sh` after the compose service lands (upload a .txt/.docx
  fixture, download, assert `%PDF` magic + Content-Type) — smoke section
  15.
