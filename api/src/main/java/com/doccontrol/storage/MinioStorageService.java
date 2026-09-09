package com.doccontrol.storage;

import com.doccontrol.config.MinioProperties;
import io.minio.BucketExistsArgs;
import io.minio.GetObjectArgs;
import io.minio.MakeBucketArgs;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import io.minio.StatObjectArgs;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.InputStream;

@Service
public class MinioStorageService implements FileStorageService {

    private static final Logger log = LoggerFactory.getLogger(MinioStorageService.class);

    private final MinioClient minioClient;
    private final MinioProperties properties;

    public MinioStorageService(MinioClient minioClient, MinioProperties properties) {
        this.minioClient = minioClient;
        this.properties = properties;
    }

    @PostConstruct
    void ensureBucket() {
        try {
            boolean exists = minioClient.bucketExists(
                    BucketExistsArgs.builder().bucket(properties.bucket()).build());
            if (!exists) {
                minioClient.makeBucket(MakeBucketArgs.builder().bucket(properties.bucket()).build());
                log.info("Created storage bucket '{}'.", properties.bucket());
            }
        } catch (Exception e) {
            // Non-fatal: the app can start (and serve metadata) while storage
            // is down; uploads will fail with a clear error instead.
            log.warn("Storage bucket check failed ({}): {}", properties.endpoint(), e.getMessage());
        }
    }

    @Override
    public String store(StoredUpload upload) {
        String key = objectKey(upload.documentId(), upload.versionId(), upload.fileName());
        try (InputStream content = upload.content()) {
            minioClient.putObject(PutObjectArgs.builder()
                    .bucket(properties.bucket())
                    .object(key)
                    .contentType(upload.contentType() == null ? "application/octet-stream" : upload.contentType())
                    .stream(content, upload.size(), -1)
                    .build());
        } catch (Exception e) {
            throw new IllegalStateException("Failed to store file in object storage: " + e.getMessage(), e);
        }
        return key;
    }

    @Override
    public DownloadedFile open(String fileReference) {
        try {
            var stat = minioClient.statObject(StatObjectArgs.builder()
                    .bucket(properties.bucket()).object(fileReference).build());
            InputStream content = minioClient.getObject(GetObjectArgs.builder()
                    .bucket(properties.bucket()).object(fileReference).build());
            String fileName = fileReference.substring(fileReference.lastIndexOf('/') + 1);
            return new DownloadedFile(fileName, stat.contentType(), stat.size(), content);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to read file from object storage: " + e.getMessage(), e);
        }
    }

    /**
     * Layout: documents/{documentId}/{versionId}/{fileName}. The version's
     * original file name is the key tail — no separate filename column needed.
     */
    private String objectKey(Integer documentId, Integer versionId, String originalName) {
        return "documents/" + documentId + "/" + versionId + "/" + sanitize(originalName);
    }

    private String sanitize(String name) {
        String safe = name == null ? "" : name.replaceAll(".*[\\\\/]", "").replaceAll("[\\p{Cntrl}]", "").trim();
        return safe.isBlank() ? "file" : safe;
    }
}
