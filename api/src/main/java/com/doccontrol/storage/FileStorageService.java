package com.doccontrol.storage;

import java.io.InputStream;

/**
 * Object-storage abstraction (MinIO for this system). Implemented at the
 * storage boundary so the rest of the code never touches S3/MinIO types.
 */
public interface FileStorageService {

    /** Uploads the content and returns the stored file reference (object key). */
    String store(StoredUpload upload);

    /** Opens the stored file for streaming download. */
    DownloadedFile open(String fileReference);

    record StoredUpload(
            Integer documentId,
            Integer versionId,
            String fileName,
            String contentType,
            long size,
            InputStream content) {
    }

    record DownloadedFile(String fileName, String contentType, long size, InputStream content) {
    }
}
