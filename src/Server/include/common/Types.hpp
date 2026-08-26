#pragma once

/**
 * Common Types and Structures
 * 
 * Shared data structures used across the server components.
 */

#include <string>
#include <chrono>
#include <cstdint>

namespace lmt {

enum class FilenameConflictPolicy {
    KeepBoth,
    Reject
};

/**
 * Transfer statistics for a single file
 */
struct FileTransferStats {
    std::string originalName;
    std::string savedName;
    uint64_t sizeBytes = 0;
    uint64_t chunksReceived = 0;
    uint64_t chunksTotal = 0;
    std::chrono::steady_clock::time_point startTime;
    std::chrono::steady_clock::time_point endTime;
    bool completed = false;
    bool isDuplicate = false;
    std::string hash;  // SHA256
};

/**
 * Session statistics
 */
struct SessionStats {
    std::string sessionId;
    std::string clientIp;
    std::chrono::steady_clock::time_point startTime;
    uint64_t filesTransferred = 0;
    uint64_t totalBytes = 0;
    double averageSpeedMBps = 0.0;
    double peakSpeedMBps = 0.0;
};

/**
 * Real-time metrics (sent to GUI via Named Pipe)
 */
  struct RealtimeMetrics {
      double currentSpeedMBps = 0.0;
      bool speedAvailable = false;
      uint64_t filesTransferred = 0;
    uint64_t totalBytes = 0;
    uint64_t sessionDurationSeconds = 0;
    bool isActive = false;
};

/**
 * Upload chunk metadata
 */
struct ChunkInfo {
    std::string fileId;           // Unique file identifier
    std::string originalName;      // Original filename
    uint64_t chunkIndex = 0;       // Current chunk (0-based)
    uint64_t totalChunks = 0;      // Total chunks for file
    uint64_t chunkSize = 0;        // Size of this chunk
    uint64_t fileSize = 0;         // Total file size
};

/**
 * Server configuration
 */
struct ServerConfig {
    int port = 8080;
    std::string uploadDir = "uploads";
    std::string staticDir = "static";
    std::string token;             // Session token
    uint64_t maxChunkSize = 16 * 1024 * 1024;  // 16MB max chunk
    FilenameConflictPolicy filenameConflictPolicy = FilenameConflictPolicy::KeepBoth;
};

/**
 * HTTP response codes
 */
enum class HttpStatus {
    OK = 200,
    BAD_REQUEST = 400,
    UNAUTHORIZED = 401,
    PAYLOAD_TOO_LARGE = 413,
    INTERNAL_ERROR = 500,
    SERVICE_UNAVAILABLE = 503
};

}  // namespace lmt
