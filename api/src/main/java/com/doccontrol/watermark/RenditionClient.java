package com.doccontrol.watermark;

import com.doccontrol.common.web.RenditionUnavailableException;
import com.doccontrol.config.WatermarkProperties;
import org.springframework.stereotype.Component;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.UUID;

/**
 * Converts one document to PDF via the Gotenberg sidecar — LibreOffice
 * headless packaged for compose (plan-back flag F6): multipart POST to
 * /forms/libreoffice/convert, response body is the PDF. JDK HTTP client
 * and raw multipart, no SDK — mirroring GraphNotificationSender's style.
 * Every failure surfaces as RenditionUnavailableException so the download
 * fails closed (flag F4) instead of leaking an unstamped original.
 */
@Component
public class RenditionClient {

    private final WatermarkProperties properties;
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    public RenditionClient(WatermarkProperties properties) {
        this.properties = properties;
    }

    public byte[] convertToPdf(String fileName, String contentType, InputStream content) {
        try (content) {
            byte[] file = content.readAllBytes();
            String boundary = "doccontrol-" + UUID.randomUUID();
            HttpRequest request = HttpRequest.newBuilder(
                        URI.create(properties.renditionUrl() + "/forms/libreoffice/convert"))
                    .timeout(Duration.ofSeconds(properties.renditionTimeoutSeconds()))
                    .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                    .POST(HttpRequest.BodyPublishers.ofByteArray(
                            multipartBody(boundary, fileName, contentType, file)))
                    .build();
            HttpResponse<byte[]> response =
                    http.send(request, HttpResponse.BodyHandlers.ofByteArray());
            if (response.statusCode() >= 300) {
                throw new RenditionUnavailableException("Rendition service failed with HTTP "
                        + response.statusCode() + ": " + truncate(
                                new String(response.body(), StandardCharsets.UTF_8)));
            }
            return response.body();
        } catch (IOException e) {
            throw new RenditionUnavailableException(
                    "Rendition service unreachable: " + e.getMessage(), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RenditionUnavailableException("Rendition request interrupted", e);
        }
    }

    private byte[] multipartBody(String boundary, String fileName, String contentType, byte[] file)
            throws IOException {
        String headers = "--" + boundary + "\r\n"
                + "Content-Disposition: form-data; name=\"files\"; filename=\""
                + fileName.replace("\"", "'").replace("\r", "").replace("\n", "")
                + "\"\r\n"
                + "Content-Type: " + contentType + "\r\n\r\n";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(headers.getBytes(StandardCharsets.UTF_8));
        out.write(file);
        out.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
        return out.toByteArray();
    }

    private static String truncate(String value) {
        if (value == null) {
            return "";
        }
        // keep sidecar error bodies out of logs/responses at a sane size
        String oneLine = value.replaceAll("\\s+", " ").trim();
        return oneLine.length() <= 300 ? oneLine : oneLine.substring(0, 300) + "…";
    }
}
