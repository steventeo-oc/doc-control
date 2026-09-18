package com.doccontrol.notification;

import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Renders responsive, inline-CSS email templates for DocControl notifications.
 * Generates both rich HTML and clean plain-text representations for universal
 * mail client compatibility (Outlook, Apple Mail, Gmail, Webmail).
 */
@Service
public class NotificationTemplateService {

    public enum BadgeStyle {
        BLUE("#1d4ed8", "#eff6ff", "#bfdbfe"),
        GREEN("#16a34a", "#f0fdf4", "#bbf7d0"),
        RED("#dc2626", "#fef2f2", "#fecaca"),
        AMBER("#d97706", "#fffbeb", "#fde68a"),
        VIOLET("#7c3aed", "#f5f3ff", "#ddd6fe"),
        CYAN("#0891b2", "#ecfeff", "#a5f3fc"),
        SLATE("#475569", "#f8fafc", "#e2e8f0");

        public final String text;
        public final String bg;
        public final String border;

        BadgeStyle(String text, String bg, String border) {
            this.text = text;
            this.bg = bg;
            this.border = border;
        }
    }

    public record EmailContent(String textBody, String htmlBody) {
    }

    /**
     * Builds both text and HTML email content with standard DocControl layout.
     */
    public EmailContent render(
            String recipientName,
            String badgeText,
            BadgeStyle badgeStyle,
            String headline,
            String leadParagraph,
            Map<String, String> details,
            String calloutTitle,
            String calloutText,
            String buttonText,
            String buttonUrl) {

        String textBody = renderText(recipientName, badgeText, headline, leadParagraph,
                details, calloutTitle, calloutText, buttonText, buttonUrl);
        String htmlBody = renderHtml(recipientName, badgeText, badgeStyle, headline,
                leadParagraph, details, calloutTitle, calloutText, buttonText, buttonUrl);

        return new EmailContent(textBody, htmlBody);
    }

    private String renderText(
            String recipientName,
            String badgeText,
            String headline,
            String leadParagraph,
            Map<String, String> details,
            String calloutTitle,
            String calloutText,
            String buttonText,
            String buttonUrl) {

        StringBuilder sb = new StringBuilder();
        sb.append(headline).append(" [").append(badgeText).append("]\n\n");
        sb.append("Hello ").append(recipientName != null ? recipientName : "there").append(",\n\n");
        sb.append(leadParagraph).append("\n\n");

        if (details != null && !details.isEmpty()) {
            sb.append("Details:\n");
            details.forEach((k, v) -> {
                if (v != null && !v.isBlank()) {
                    sb.append("  • ").append(k).append(": ").append(v).append("\n");
                }
            });
            sb.append("\n");
        }

        if (calloutText != null && !calloutText.isBlank()) {
            if (calloutTitle != null && !calloutTitle.isBlank()) {
                sb.append(calloutTitle).append(":\n");
            }
            sb.append("\"").append(calloutText.trim()).append("\"\n\n");
        }

        if (buttonUrl != null && !buttonUrl.isBlank()) {
            String label = (buttonText != null && !buttonText.isBlank()) ? buttonText : "Action Link";
            sb.append(label).append(":\n").append(buttonUrl).append("\n\n");
        }

        sb.append("--------------------------------------------------\n");
        sb.append("Automated message from Overclock Document Control System\n");
        sb.append("doccontrol-notifications@overclock.sg\n");
        return sb.toString();
    }

    private String renderHtml(
            String recipientName,
            String badgeText,
            BadgeStyle badgeStyle,
            String headline,
            String leadParagraph,
            Map<String, String> details,
            String calloutTitle,
            String calloutText,
            String buttonText,
            String buttonUrl) {

        BadgeStyle style = badgeStyle != null ? badgeStyle : BadgeStyle.BLUE;

        StringBuilder sb = new StringBuilder();
        sb.append("<!DOCTYPE html>\n")
          .append("<html lang=\"en\">\n<head>\n")
          .append("<meta charset=\"UTF-8\">\n")
          .append("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n")
          .append("<title>").append(escapeHtml(headline)).append("</title>\n")
          .append("</head>\n")
          .append("<body style=\"margin: 0; padding: 24px 0; background-color: #f4f6f8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #1e293b;\">\n")
          .append("<table role=\"presentation\" border=\"0\" cellpadding=\"0\" cellspacing=\"0\" width=\"100%\">\n")
          .append("  <tr>\n    <td align=\"center\">\n")
          .append("      <!-- Container Card -->\n")
          .append("      <table role=\"presentation\" border=\"0\" cellpadding=\"0\" cellspacing=\"0\" width=\"100%\" style=\"max-width: 580px; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.05); overflow: hidden; margin: 0 16px;\">\n")
          .append("        <!-- Brand Header -->\n")
          .append("        <tr>\n")
          .append("          <td style=\"padding: 24px 32px 18px 32px; border-bottom: 1px solid #f1f5f9;\">\n")
          .append("            <table role=\"presentation\" border=\"0\" cellpadding=\"0\" cellspacing=\"0\" width=\"100%\">\n")
          .append("              <tr>\n")
          .append("                <td>\n")
          .append("                  <span style=\"font-size: 16px; font-weight: 800; letter-spacing: 0.5px; color: #0f172a;\">DOC<span style=\"color: #1d4ed8;\">CONTROL</span></span>\n")
          .append("                  <div style=\"font-size: 11px; color: #64748b; font-weight: 500; margin-top: 2px;\">Overclock Document Control System</div>\n")
          .append("                </td>\n");

        if (badgeText != null && !badgeText.isBlank()) {
            sb.append("                <td align=\"right\">\n")
              .append("                  <span style=\"display: inline-block; padding: 4px 12px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; border-radius: 9999px; background-color: ")
              .append(style.bg).append("; color: ").append(style.text).append("; border: 1px solid ").append(style.border).append(";\">\n")
              .append("                    ").append(escapeHtml(badgeText)).append("\n")
              .append("                  </span>\n")
              .append("                </td>\n");
        }

        sb.append("              </tr>\n")
          .append("            </table>\n")
          .append("          </td>\n")
          .append("        </tr>\n")
          .append("        <!-- Body Content -->\n")
          .append("        <tr>\n")
          .append("          <td style=\"padding: 28px 32px;\">\n")
          .append("            <h2 style=\"margin: 0 0 12px 0; font-size: 18px; font-weight: 700; color: #0f172a; line-height: 1.3;\">")
          .append(escapeHtml(headline)).append("</h2>\n")
          .append("            <p style=\"margin: 0 0 16px 0; font-size: 14px; color: #334155; line-height: 1.6;\">\n")
          .append("              Hello ").append(recipientName != null ? escapeHtml(recipientName) : "there").append(",<br><br>\n")
          .append("              ").append(escapeHtml(leadParagraph)).append("\n")
          .append("            </p>\n");

        // Details key-value card
        if (details != null && !details.isEmpty()) {
            sb.append("            <table role=\"presentation\" border=\"0\" cellpadding=\"0\" cellspacing=\"0\" width=\"100%\" style=\"background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; margin: 20px 0; border-collapse: separate; overflow: hidden;\">\n");
            int idx = 0;
            for (Map.Entry<String, String> entry : details.entrySet()) {
                if (entry.getValue() == null || entry.getValue().isBlank()) continue;
                String borderBottom = (idx < details.size() - 1) ? "border-bottom: 1px solid #edf2f7;" : "";
                sb.append("              <tr>\n")
                  .append("                <td style=\"padding: 10px 16px; font-size: 13px; font-weight: 600; color: #64748b; width: 35%; vertical-align: top; ").append(borderBottom).append("\">")
                  .append(escapeHtml(entry.getKey())).append("</td>\n")
                  .append("                <td style=\"padding: 10px 16px; font-size: 13px; font-weight: 500; color: #0f172a; vertical-align: top; ").append(borderBottom).append("\">")
                  .append(escapeHtml(entry.getValue())).append("</td>\n")
                  .append("              </tr>\n");
                idx++;
            }
            sb.append("            </table>\n");
        }

        // Callout box (e.g. rejection reason or delegation message)
        if (calloutText != null && !calloutText.isBlank()) {
            String calloutBg = style == BadgeStyle.RED ? "#fef2f2" : "#f8fafc";
            String calloutBorder = style == BadgeStyle.RED ? "#ef4444" : style.text;
            String calloutColor = style == BadgeStyle.RED ? "#991b1b" : "#334155";
            sb.append("            <div style=\"background-color: ").append(calloutBg).append("; border-left: 4px solid ").append(calloutBorder).append("; border-radius: 4px; padding: 14px 18px; margin: 20px 0;\">\n");
            if (calloutTitle != null && !calloutTitle.isBlank()) {
                sb.append("              <div style=\"font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: ").append(calloutBorder).append("; margin-bottom: 6px;\">")
                  .append(escapeHtml(calloutTitle)).append("</div>\n");
            }
            sb.append("              <div style=\"font-size: 13px; font-style: italic; color: ").append(calloutColor).append("; line-height: 1.5;\">")
              .append("\"").append(escapeHtml(calloutText.trim())).append("\"</div>\n")
              .append("            </div>\n");
        }

        // Action CTA Button
        if (buttonUrl != null && !buttonUrl.isBlank()) {
            String label = (buttonText != null && !buttonText.isBlank()) ? buttonText : "Open in DocControl";
            sb.append("            <div style=\"margin: 28px 0 16px 0; text-align: left;\">\n")
              .append("              <a href=\"").append(escapeHtml(buttonUrl)).append("\" style=\"display: inline-block; background-color: #1d4ed8; color: #ffffff !important; text-decoration: none; padding: 12px 24px; font-size: 14px; font-weight: 600; border-radius: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.1);\">\n")
              .append("                ").append(escapeHtml(label)).append(" &rarr;\n")
              .append("              </a>\n")
              .append("            </div>\n")
              .append("            <div style=\"font-size: 11px; color: #64748b; line-height: 1.4; word-break: break-all; margin-top: 8px;\">\n")
              .append("              If the button doesn't work, copy and paste this link: <a href=\"").append(escapeHtml(buttonUrl)).append("\" style=\"color: #2563eb;\">").append(escapeHtml(buttonUrl)).append("</a>\n")
              .append("            </div>\n");
        }

        sb.append("          </td>\n")
          .append("        </tr>\n")
          .append("        <!-- Footer -->\n")
          .append("        <tr>\n")
          .append("          <td style=\"padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; text-align: center; font-size: 12px; color: #94a3b8; line-height: 1.5;\">\n")
          .append("            This is an automated message from the Overclock Document Control System.<br>\n")
          .append("            Sent from <span style=\"color: #64748b;\">doccontrol-notifications@overclock.sg</span>\n")
          .append("          </td>\n")
          .append("        </tr>\n")
          .append("      </table>\n")
          .append("    </td>\n  </tr>\n")
          .append("</table>\n")
          .append("</body>\n</html>");

        return sb.toString();
    }

    private static String escapeHtml(String text) {
        if (text == null) return "";
        return text.replace("&", "&amp;")
                   .replace("<", "&lt;")
                   .replace(">", "&gt;")
                   .replace("\"", "&quot;")
                   .replace("'", "&#39;");
    }
}
