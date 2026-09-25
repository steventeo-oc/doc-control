package com.doccontrol.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Phase 2e watermarking on export (#15, plan-back approved): downloads of
 * renditionable versions return a stamped PDF rendition with the mark
 * text chosen by version status — the ISO controlled-copy matrix (flag
 * F1). enabled=false is the explicit, visible off-switch (pre-watermark
 * pass-through), never a silent fallback; conversion failures fail
 * closed as 503 (flag F4). The rendition sidecar (LibreOffice headless
 * via Gotenberg) is flagged F6; brand fonts are deliberately not baked
 * into its image yet.
 */
@ConfigurationProperties(prefix = "doccontrol.watermark")
public record WatermarkProperties(
        boolean enabled,
        String renditionUrl,
        int renditionTimeoutSeconds,
        MarkTexts text) {

    public record MarkTexts(String current, String obsolete, String draft, String approved) {
    }
}
