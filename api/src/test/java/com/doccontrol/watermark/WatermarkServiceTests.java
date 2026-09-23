package com.doccontrol.watermark;

import com.doccontrol.common.web.RenditionUnavailableException;
import com.doccontrol.config.WatermarkProperties;
import com.doccontrol.document.DocumentVersionStatus;
import com.doccontrol.storage.FileStorageService.DownloadedFile;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Unit coverage of the stamping core (Phase 2e plan-back §6): mark text
 * follows the version-status matrix (flag F1), stamping is per-request
 * and never stored (F5), PDF originals never hit the rendition client,
 * office types convert then stamp, failures propagate for fail-closed
 * 503s (F4). The spike's render-diff technique proves the mark is
 * actually visible in the render, not just present in the content stream.
 */
class WatermarkServiceTests {

    private static final WatermarkProperties PROPS = new WatermarkProperties(
            true, "http://gotenberg:3000", 30,
            new WatermarkProperties.MarkTexts(
                    "RELEASED — UNCONTROLLED IF PRINTED", "SUPERSEDED — DO NOT USE",
                    "DRAFT — UNCONTROLLED", "APPROVED — NOT YET IN EFFECT"));

    private RenditionClient renditionClient;
    private WatermarkService service;

    @BeforeEach
    void setUp() {
        renditionClient = mock(RenditionClient.class);
        service = new WatermarkService(PROPS, renditionClient);
    }

    @Test
    void stampsEveryPageWithTheCurrentMarkAndItIsVisibleInTheRender() throws Exception {
        byte[] original = twoPagePdf("Procedure body line");
        DownloadedFile file = downloaded("sop.pdf", "application/pdf", original);

        WatermarkService.StampedDownload out =
                service.stampForDownload(DocumentVersionStatus.CURRENT, file);

        assertThat(out.fileName()).isEqualTo("sop.pdf");
        assertThat(new String(out.pdf(), 0, 5)).isEqualTo("%PDF-");
        try (PDDocument doc = Loader.loadPDF(out.pdf())) {
            assertThat(doc.getNumberOfPages()).isEqualTo(2);
            assertThat(normalizedText(doc))
                    .contains("RELEASED — UNCONTROLLED IF PRINTED")
                    .contains("Procedure body line");
        }
        assertThat(changedPixels(original, out.pdf())).isGreaterThan(500);
        verifyNoInteractions(renditionClient);
    }

    @Test
    void markTextFollowsTheVersionStatusMatrix() throws Exception {
        assertMark(DocumentVersionStatus.CURRENT, "RELEASED — UNCONTROLLED IF PRINTED");
        assertMark(DocumentVersionStatus.SUPERSEDED, "SUPERSEDED — DO NOT USE");
        assertMark(DocumentVersionStatus.DRAFT, "DRAFT — UNCONTROLLED");
        assertMark(DocumentVersionStatus.APPROVED, "APPROVED — NOT YET IN EFFECT");
    }

    @Test
    void disabledReturnsNullWithoutTouchingThePipeline() {
        WatermarkService off = new WatermarkService(
                new WatermarkProperties(false, "http://gotenberg:3000", 30, PROPS.text()),
                renditionClient);
        assertThat(off.stampForDownload(DocumentVersionStatus.CURRENT,
                downloaded("sop.docx", "application/msword", "office".getBytes()))).isNull();
        verifyNoInteractions(renditionClient);
    }

    @Test
    void nonRenditionableTypesPassThroughUnstamped() {
        assertThat(service.stampForDownload(DocumentVersionStatus.CURRENT,
                downloaded("part.dwg", "application/octet-stream", "dwg".getBytes())))
                .isNull();
        verifyNoInteractions(renditionClient);
    }

    @Test
    void officeTypesConvertThroughTheRenditionClientThenStamp() throws Exception {
        when(renditionClient.convertToPdf(eq("sop.docx"), eq("application/msword"), any()))
                .thenReturn(onePagePdf("converted body"));

        WatermarkService.StampedDownload out = service.stampForDownload(
                DocumentVersionStatus.CURRENT,
                downloaded("sop.docx", "application/msword", "fake docx".getBytes()));

        assertThat(out.fileName()).isEqualTo("sop.pdf");
        try (PDDocument doc = Loader.loadPDF(out.pdf())) {
            assertThat(normalizedText(doc))
                    .contains("RELEASED — UNCONTROLLED IF PRINTED")
                    .contains("converted body");
        }
    }

    @Test
    void renditionFailurePropagatesForFailClosed() {
        when(renditionClient.convertToPdf(any(), any(), any()))
                .thenThrow(new RenditionUnavailableException("sidecar down"));
        assertThatThrownBy(() -> service.stampForDownload(DocumentVersionStatus.CURRENT,
                downloaded("sop.docx", "application/msword", "x".getBytes())))
                .isInstanceOf(RenditionUnavailableException.class)
                .hasMessageContaining("sidecar down");
    }

    // ---- helpers ----

    private void assertMark(DocumentVersionStatus status, String mark) throws Exception {
        WatermarkService.StampedDownload out = service.stampForDownload(status,
                downloaded("doc.pdf", "application/pdf", onePagePdf("body")));
        try (PDDocument doc = Loader.loadPDF(out.pdf())) {
            assertThat(normalizedText(doc)).contains(mark);
        }
    }

    /** Extracted text with whitespace normalized — the rotated mark extracts with line breaks. */
    private String normalizedText(PDDocument doc) throws Exception {
        return new PDFTextStripper().getText(doc).replaceAll("\\s+", " ");
    }

    private DownloadedFile downloaded(String name, String contentType, byte[] bytes) {
        return new DownloadedFile(name, contentType, bytes.length, new ByteArrayInputStream(bytes));
    }

    private byte[] onePagePdf(String line) throws Exception {
        return pdf(1, line);
    }

    private byte[] twoPagePdf(String line) throws Exception {
        return pdf(2, line);
    }

    private byte[] pdf(int pages, String line) throws Exception {
        try (PDDocument doc = new PDDocument()) {
            for (int p = 0; p < pages; p++) {
                PDPage page = new PDPage(PDRectangle.LETTER);
                doc.addPage(page);
                try (PDPageContentStream cs = new PDPageContentStream(doc, page)) {
                    cs.beginText();
                    cs.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA), 11);
                    cs.newLineAtOffset(60, 700);
                    cs.showText(line + " (page " + (p + 1) + ")");
                    cs.endText();
                }
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            doc.save(out);
            return out.toByteArray();
        }
    }

    /** The spike's verification technique: the mark must render visibly. */
    private long changedPixels(byte[] before, byte[] after) throws Exception {
        BufferedImage a, b;
        try (PDDocument doc = Loader.loadPDF(before)) {
            a = new PDFRenderer(doc).renderImage(0, 1.0f);
        }
        try (PDDocument doc = Loader.loadPDF(after)) {
            b = new PDFRenderer(doc).renderImage(0, 1.0f);
        }
        int w = Math.min(a.getWidth(), b.getWidth());
        int h = Math.min(a.getHeight(), b.getHeight());
        long changed = 0;
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int pa = a.getRGB(x, y), pb = b.getRGB(x, y);
                int dr = Math.abs(((pa >> 16) & 255) - ((pb >> 16) & 255));
                int dg = Math.abs(((pa >> 8) & 255) - ((pb >> 8) & 255));
                int db = Math.abs((pa & 255) - (pb & 255));
                if (dr + dg + db > 48) {
                    changed++;
                }
            }
        }
        return changed;
    }
}
