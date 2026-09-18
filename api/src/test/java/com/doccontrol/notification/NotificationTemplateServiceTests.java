package com.doccontrol.notification;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class NotificationTemplateServiceTests {

    private final NotificationTemplateService templateService = new NotificationTemplateService();

    @Test
    void rendersHtmlAndTextWithAllComponents() {
        Map<String, String> details = new LinkedHashMap<>();
        details.put("Document", "SOP-QA-001");
        details.put("Title", "Quality Protocol <Draft>");
        details.put("Version", "v1");

        NotificationTemplateService.EmailContent content = templateService.render(
                "Alice Reviewer",
                "Review Required",
                NotificationTemplateService.BadgeStyle.BLUE,
                "Action Required: Review Document",
                "Steven Teo has assigned you as a reviewer.",
                details,
                "Instructions",
                "Please check section 4 carefully & verify.",
                "Review Task in DocControl",
                "http://localhost:3000/tasks"
        );

        // Text assertions
        assertThat(content.textBody())
                .contains("Action Required: Review Document [Review Required]")
                .contains("Hello Alice Reviewer,")
                .contains("Steven Teo has assigned you as a reviewer.")
                .contains("• Document: SOP-QA-001")
                .contains("• Title: Quality Protocol <Draft>")
                .contains("Instructions:\n\"Please check section 4 carefully & verify.\"")
                .contains("Review Task in DocControl:\nhttp://localhost:3000/tasks")
                .contains("doccontrol-notifications@overclock.sg");

        // HTML assertions
        assertThat(content.htmlBody())
                .contains("<!DOCTYPE html>")
                .contains("DOC<span style=\"color: #1d4ed8;\">CONTROL</span>")
                .contains("Review Required")
                .contains("Action Required: Review Document")
                .contains("Hello Alice Reviewer,")
                .contains("Quality Protocol &lt;Draft&gt;")
                .contains("Please check section 4 carefully &amp; verify.")
                .contains("Review Task in DocControl &rarr;")
                .contains("href=\"http://localhost:3000/tasks\"")
                .contains("doccontrol-notifications@overclock.sg");
    }

    @Test
    void escapesSpecialCharactersInHtmlToPreventInjection() {
        NotificationTemplateService.EmailContent content = templateService.render(
                "<script>alert(1)</script>",
                "Alert & Warning",
                NotificationTemplateService.BadgeStyle.RED,
                "Headline <foo>",
                "Paragraph with \"quotes\" & tags",
                Map.of("Key", "<b>bold</b>"),
                "Callout <title>",
                "<script>evil()</script>",
                "Button",
                "http://example.com"
        );

        assertThat(content.htmlBody())
                .doesNotContain("<script>")
                .contains("&lt;script&gt;alert(1)&lt;/script&gt;")
                .contains("&lt;script&gt;evil()&lt;/script&gt;")
                .contains("&lt;b&gt;bold&lt;/b&gt;")
                .contains("Paragraph with &quot;quotes&quot; &amp; tags");
    }

    @Test
    void handlesNullOptionalFieldsGracefully() {
        NotificationTemplateService.EmailContent content = templateService.render(
                null,
                null,
                null,
                "Simple Headline",
                "Simple message.",
                null,
                null,
                null,
                null,
                null
        );

        assertThat(content.textBody())
                .contains("Hello there,")
                .contains("Simple message.");
        assertThat(content.htmlBody())
                .contains("Hello there,")
                .contains("Simple message.")
                .doesNotContain("table role=\"presentation\" width=\"100%\" style=\"background-color: #f8fafc; border: 1px solid #e2e8f0;");
    }
}
