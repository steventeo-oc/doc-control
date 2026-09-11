# Phase 2e — Watermarking: PDF-Stamping Library Spike (Findings)

Companion to `Phase2_Roadmap.md` (#15). The owner deferred watermarking
design until a short technical spike on PDF-stamping library options was
done (same spirit as the Camunda/Flowable engine spike). This document
records what the spike did and found. **It is findings only, not a design
— watermarking design starts after the owner confirms the direction.**
The spike code was throwaway (a scratch Maven project outside the repo)
and has been deleted; everything worth keeping is below.

**Recommendation (pending owner confirmation): Apache PDFBox 3.x for the
stamping step.**

---

## What the spike did (2026-09-11, Java 21 / Temurin, Maven)

Generated a 2-page sample "released SOP" PDF, then stamped
`UNCONTROLLED IF PRINTED` — diagonal (30°), translucent (15% alpha),
centered, every page — once with each candidate library. Both outputs
were then reloaded, text-extracted, rendered to PNG, and pixel-diffed
against the unstamped render to prove the mark is actually visible and
where expected (the spike ran headless; the pixel-diff is the visual
check).

## Results

| | Apache PDFBox 3.0.8 | OpenPDF 3.0.5 |
|---|---|---|
| License | Apache 2.0 | LGPL / MPL dual |
| Footprint | 2 jars (pdfbox 2.0 MB + fontbox 1.6 MB) | 1 jar (2.2 MB), no transitive deps |
| API shape | Low-level: per-page `PDPageContentStream` (APPEND) + `PDExtendedGraphicsState` alpha + rotated text matrix | Higher-level: `PdfReader`/`PdfStamper` over-content + `PdfGState` opacity + `showTextAligned(angle)` |
| Stamp time | ~15 ms | ~116 ms (first-use font init; trivial either way) |
| Output verified | Text extractable ✓; pixel-diff 7658 px changed, bbox = the rotated band through page centre ✓ | **Identical**: 7658 px, same bbox — geometry byte-equivalent by construction (same computed placement) |
| LOC for the stamp | ~20 | ~20 |

Both worked first-try at the API level; the only snag hit was OpenPDF
3.x's package rename (`com.lowagie.text.*` → `org.openpdf.text.*`, done
in the 3.0 line — the 2.x line still uses the old packages). Worth
knowing if any tutorial/code sample is copied later.

## Ruled out, without hands-on

- **iText 7/8** — AGPL or commercial. AGPL obligations on a
  network-accessible internal service are a legal question the project
  should not take on when two permissively-licensed options demonstrably
  work. Ruled out.
- **Aspose.PDF, PDFTron, Spire.PDF** — commercial-only, priced far above
  what this need justifies, no capability the task requires beyond what
  the two above showed. Ruled out.
- **LibreOffice headless** — not a stamping library; it is the leading
  candidate for the **rendition step** (below), a separate decision.

## Why PDFBox over OpenPDF (close call, stated reasons)

- Apache 2.0 needs no attribution engineering; LGPL/MPL is workable but
  asks slightly more care in distribution practices.
- ASF-governed, the de-facto default JVM PDF library; long support
  trajectory matches the Flowable/Spring choice rationale.
- One library covers read + write + render + text extraction — the
  verification/rendition plumbing around the stamp likely wants PDFBox
  anyway, so a second library would be redundant weight.
- The lower-level API is exactly the shape of "open, append a mark,
  save" with no extra concepts.

OpenPDF remains a fully viable runner-up if PDFBox throws a surprise
(simpler stamper API, single jar, provably identical stamp output).

## Boundary of the spike — what it deliberately did not decide

1. **Rendition (the real prerequisite)**: stamping operates on PDFs;
   originals in this system are mostly Office files. Where the PDF comes
   from at download time — LibreOffice headless in the compose stack
   being the default candidate, with M365/Graph conversion as an
   external-dependency alternative — is the next design question, and it
   is bigger than the stamp itself.
2. **Stamp-on-download vs stamped-archival**: the spike stamped a file on
   disk once; whether the mark is applied ephemerally at download or a
   stamped rendition is stored is a design decision (default lean:
   ephemeral at download — never store a marked file as the version of
   record).
3. **Fit/wording/placement parameters**: at 34 pt the mark fits a LETTER
   page with margins; at 48 pt the same string would clip. Auto-fit or a
   fixed size, mark wording per state ("UNCONTROLLED IF PRINTED" only for
   released docs?), placement, and whether downloads of draft versions
   get a different mark are all design-phase decisions.
