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
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.apache.pdfbox.pdmodel.graphics.state.PDExtendedGraphicsState;
import org.apache.pdfbox.util.Matrix;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Set;

/**
 * Phase 2e watermarking on export (#15, plan-back approved): downloads of
 * renditionable versions return a stamped PDF rendition — mark text by
 * version status (the ISO controlled-copy matrix, flag F1), applied
 * ephemeral per request and never stored (F5). PDF originals are stamped
 * directly with PDFBox (spike-verified); office types convert in the
 * Gotenberg sidecar (LibreOffice headless, flag F6). Non-renditionable
 * types (DWG, .msg/.eml) pass through unstamped for now (F3). Any
 * rendition/stamp failure fails closed as 503 — an unstamped copy of a
 * controlled document must never escape because the pipeline is
 * unhealthy (F4).
 */
@Service
public class WatermarkService {

    private static final Logger log = LoggerFactory.getLogger(WatermarkService.class);

    /**
     * Types the pipeline can turn into (or already is) a PDF. Derived from
     * the rendition client's capability, never hardcoded per convention 3;
     * deliberately excludes DWG/email formats LibreOffice cannot convert
     * (flag F3) and images.
     */
    private static final Set<String> RENDITIONABLE = Set.of(
            "application/pdf",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.ms-powerpoint",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/rtf",
            "text/rtf",
            "application/vnd.oasis.opendocument.text",
            "application/vnd.oasis.opendocument.spreadsheet",
            "application/vnd.oasis.opendocument.presentation",
            "text/plain");

    private static final float MAX_FONT_SIZE = 48f;
    private static final float ANGLE_RADIANS = (float) Math.toRadians(30);
    private static final float ALPHA = 0.15f;
    private static final float MARGIN = 36f;

    private final WatermarkProperties properties;
    private final RenditionClient renditionClient;

    public WatermarkService(WatermarkProperties properties, RenditionClient renditionClient) {
        this.properties = properties;
        this.renditionClient = renditionClient;
    }

    /** The stamped rendition: PDF bytes under the original file's base name. */
    public record StampedDownload(byte[] pdf, String fileName) {
    }

    /**
     * The stamped rendition for this download, or null when the original
     * should stream unchanged (watermarking off, or a type the pipeline
     * cannot render — flag F3). Throws RenditionUnavailableException
     * (→ 503) when the rendition pipeline cannot deliver (flag F4).
     */
    public StampedDownload stampForDownload(DocumentVersionStatus versionStatus, DownloadedFile file) {
        if (!properties.enabled()) {
            return null;
        }
        byte[] pdf = asPdf(file);
        if (pdf == null) {
            return null;
        }
        String mark = markTextFor(versionStatus);
        log.debug("Stamping download: {} mark '{}'", file.fileName(), mark);
        return new StampedDownload(stamp(pdf, mark), baseName(file.fileName()) + ".pdf");
    }

    private byte[] asPdf(DownloadedFile file) {
        String contentType = file.contentType() == null
                ? ""
                : file.contentType().split(";")[0].trim();
        if (!RENDITIONABLE.contains(contentType)) {
            return null;
        }
        if ("application/pdf".equals(contentType)) {
            return read(file.content());
        }
        return renditionClient.convertToPdf(file.fileName(), contentType, file.content());
    }

    private String markTextFor(DocumentVersionStatus status) {
        return switch (status) {
            case CURRENT -> properties.text().current();
            case OBSOLETE -> properties.text().obsolete();
            case DRAFT -> properties.text().draft();
            case APPROVED -> properties.text().approved();
        };
    }

    /**
     * Diagonal translucent mark on every page (spike-verified geometry):
     * standard-14 Helvetica Bold — no font embedding, so no brand fonts —
     * with the size auto-fit so the text never clips the page (the spike
     * measured 48pt clipping a LETTER page).
     */
    private byte[] stamp(byte[] pdf, String mark) {
        try (PDDocument doc = Loader.loadPDF(pdf)) {
            PDFont font = new PDType1Font(Standard14Fonts.FontName.HELVETICA_BOLD);
            PDExtendedGraphicsState gs = new PDExtendedGraphicsState();
            gs.setNonStrokingAlphaConstant(ALPHA);
            for (PDPage page : doc.getPages()) {
                PDRectangle box = page.getMediaBox();
                float fullWidth = font.getStringWidth(mark) / 1000f * MAX_FONT_SIZE;
                float maxWidth = box.getWidth() - 2 * MARGIN;
                float size = fullWidth > maxWidth ? MAX_FONT_SIZE * maxWidth / fullWidth : MAX_FONT_SIZE;
                float textWidth = font.getStringWidth(mark) / 1000f * size;
                // center the rotated span, not the text origin
                float x = (float) ((box.getWidth() - textWidth * Math.cos(ANGLE_RADIANS)) / 2f);
                float y = box.getHeight() / 2f - size;
                try (PDPageContentStream cs = new PDPageContentStream(
                        doc, page, PDPageContentStream.AppendMode.APPEND, true, true)) {
                    cs.setGraphicsStateParameters(gs);
                    cs.beginText();
                    cs.setFont(font, size);
                    cs.setTextMatrix(Matrix.getRotateInstance(ANGLE_RADIANS, x, y));
                    cs.showText(mark);
                    cs.endText();
                }
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            doc.save(out);
            return out.toByteArray();
        } catch (IOException e) {
            throw new RenditionUnavailableException("Could not stamp the document rendition.", e);
        }
    }

    private byte[] read(InputStream content) {
        try (content) {
            return content.readAllBytes();
        } catch (IOException e) {
            throw new RenditionUnavailableException("Could not read the stored file.", e);
        }
    }

    private String baseName(String fileName) {
        String stripped = fileName.replaceFirst("\\.[^.]*$", "");
        return stripped.isEmpty() ? fileName : stripped;
    }
}
