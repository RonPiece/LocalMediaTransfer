#pragma once

/**
 * Memory-Mapped File Writer
 * 
 * High-performance file writing using memory-mapped I/O.
 * Optimized for large file transfers (40GB+).
 */

#include <string>
#include <cstdint>
#include <memory>
#include <unordered_map>
#include <mutex>
#include <shared_mutex>
#include <condition_variable>
#include <chrono>
#include <deque>
#include <vector>
#include <functional>

#ifdef _WIN32
#include <windows.h>
#endif

#include "common/Types.hpp"
#include "common/TransferLimits.hpp"

class HashEngine;

enum class ChunkWriteStatus {
    Success,
    AlreadyAccepted,
    Completed,
    Finalizing,
    UnknownFile,
    OutOfOrder,
    SizeExceeded,
    StorageError
};

enum class FileFinalizeDisposition {
    Saved,
    Duplicate,
    NameConflict,
    Finalizing,
    Error
};

struct FileFinalizeResult {
    FileFinalizeDisposition disposition = FileFinalizeDisposition::Error;
    std::string filename;
    std::string sha256;
};

enum class PreflightDisposition {
    Upload,
    Skip,
    UploadNameConflict,
    Inconclusive
};

struct PreflightResult {
    PreflightDisposition disposition = PreflightDisposition::Upload;
    std::string filename;
};

struct PreflightHashCacheEntry {
    uint64_t sizeBytes = 0;
    int64_t modifiedTime = 0;
    std::string sha256;
};

using PreflightHashCache =
    std::unordered_map<std::string, PreflightHashCacheEntry>;

struct UploadLimits {
    uint64_t maxFileBytes = lmt::TransferLimits::MaxFileBytes;
    uint64_t maxReservedBytes = 128ULL * 1024 * 1024 * 1024;
    uint64_t maxOwnerBytes = lmt::TransferLimits::MaxFileBytes;
    uint64_t minFreeBytes = 256ULL * 1024 * 1024;
    size_t maxActiveFiles = 32;
    size_t maxOwnerFiles = 8;
    std::chrono::seconds idleTimeout{30 * 60};
    std::function<std::chrono::steady_clock::time_point()> now =
        [] { return std::chrono::steady_clock::now(); };
};

class FileWriter {
public:
    FileWriter(
        const std::string& uploadDir,
        std::shared_ptr<HashEngine> hashEngine,
        lmt::FilenameConflictPolicy filenameConflictPolicy =
            lmt::FilenameConflictPolicy::KeepBoth,
        UploadLimits limits = {});
    ~FileWriter();
    
    /**
     * Initialize a new file for chunked writing
     * @param fileId Unique identifier for the file
     * @param originalName Original filename
     * @param totalSize Expected total file size
     * @return true if successful
     */
    bool initFile(const std::string& fileId, 
                  const std::string& originalName,
                  uint64_t totalSize,
                  uint64_t totalChunks = 1,
                  bool skipExactDuplicates = true);

    /**
     * Abort active files whose IDs belong to one authenticated client session.
     * Closes mappings, removes temporary files, and wakes finalization waiters.
     */
    size_t abortFilesWithPrefix(const std::string& fileIdPrefix);
    void abortFile(const std::string& fileId);
    bool ownsSession(const std::string& fileIdPrefix);
    void expireIdleFiles();
#ifdef LMT_STORAGE_TESTING
    // Compiled only into the native regression executable, never the server.
    std::function<bool(const char*)> failStorageOperation;
#endif
    
    /**
     * Write a sequential chunk to a memory-mapped file.
     * @param fileId File identifier
     * @param chunkIndex Which chunk (0-based)
     * @param data Pointer to chunk data
     * @param size Size of chunk in bytes
     * @return detailed write status
     */
    ChunkWriteStatus writeChunk(const std::string& fileId,
                                uint64_t chunkIndex,
                                const char* data,
                                uint64_t size);
    
    /**
     * Finalize a file and report whether it was saved, skipped as an exact
     * duplicate, or rejected because the original name belongs to other data.
     */
    FileFinalizeResult finalizeFileResult(
        const std::string& fileId,
        bool* finalizedNow = nullptr);
    
    /**
     * Check if a file with given hash already exists
     * @param hash SHA256 hash of file
     * @return pair of (exists, filename)
     */
    std::pair<bool, std::string> isDuplicate(const std::string& hash);

    bool hasPreflightCandidate(
        const std::string& originalName,
        uint64_t sizeBytes);
    PreflightResult verifyPreflight(
        const std::string& originalName,
        uint64_t sizeBytes,
        const std::string& sha256,
        PreflightHashCache* hashCache = nullptr);

    /**
     * Store a file hash for duplicate detection
     * @param hash SHA256 hash
     * @param filename saved filename
     */
    void storeHash(const std::string& hash, const std::string& filename);

    
    /**
     * Return the Windows-safe original filename.
     * @param originalName Original filename
     * @return Filename safe for the destination filesystem
     */
    std::string makeFinalFilename(const std::string& originalName);

private:
    struct FinalizationState {
        std::mutex mutex;
        std::condition_variable completedCondition;
        bool finalizing = false;
        bool completed = false;
        bool failed = false;
        std::string originalName;
        uint64_t totalSize = 0;
        uint64_t totalChunks = 0;
        bool skipExactDuplicates = true;
        std::string filename;
        std::string sha256;
        FileFinalizeDisposition disposition = FileFinalizeDisposition::Error;
        bool reserved = true;
        std::string temporaryPath;
        std::chrono::steady_clock::time_point lastActivity{};
    };

    struct FileHandle {
        FileHandle() = default;
        FileHandle(const FileHandle&) = delete;
        FileHandle& operator=(const FileHandle&) = delete;
        FileHandle(FileHandle&& other) noexcept;
        FileHandle& operator=(FileHandle&& other) noexcept;

        std::string fileId;
        std::string originalName;
        std::string tempPath;
        uint64_t totalSize = 0;
        uint64_t bytesWritten = 0;
        uint64_t chunksReceived = 0;
        uint64_t chunksExpected = 0;
        bool skipExactDuplicates = true;
        std::vector<uint64_t> acceptedChunkSizes;
        bool streamingHashValid = false;
        std::shared_ptr<std::mutex> writeMutex = std::make_shared<std::mutex>();
        std::shared_ptr<FinalizationState> finalization =
            std::make_shared<FinalizationState>();
        
#ifdef _WIN32
        HANDLE hFile = INVALID_HANDLE_VALUE;
        HANDLE hMapping = nullptr;
#else
        int fd = -1;
#endif
    };

    struct WriteTarget {
        uint64_t totalSize = 0;
#ifdef _WIN32
        HANDLE hMapping = nullptr;
#else
        int fd = -1;
#endif
    };
    
    bool createMemoryMappedFile(FileHandle& handle);
    bool writeMappedRange(
        const WriteTarget& target,
        uint64_t offset,
        const char* data,
        uint64_t size);
    void closeHandle(FileHandle& handle);
    bool flushFile(FileHandle& handle);
    bool storageFault(const char* operation) const;
    size_t abortMatching(const std::function<bool(const std::string&,
        const FinalizationState&)>& matches);
    void retireTemporary(const std::string& fileId,
        const std::shared_ptr<FinalizationState>& state);
    ChunkWriteStatus waitForFinalization(
        const std::shared_ptr<FinalizationState>& state) const;
    FileFinalizeResult waitForFinalizedResult(
        const std::shared_ptr<FinalizationState>& state) const;
    void rememberCompletedSessionLocked(const std::string& fileId);
    std::string sanitizeFilename(const std::string& name);
    std::string makeNumberedFilename(const std::string& safeName);
    std::pair<bool, std::string> findVerifiedDuplicate(const std::string& hash);
    bool verifyInventoryRecord(
        const std::string& filename,
        uint64_t expectedSize,
        const std::string& expectedHash);
    void refreshDuplicateInventoryIfDue();
    
    std::string m_uploadDir;
    std::unordered_map<std::string, FileHandle> m_handles;
    std::unordered_map<std::string, std::shared_ptr<FinalizationState>> m_sessions;
    std::deque<std::string> m_completedSessionOrder;
    std::mutex m_mutex;
    std::mutex m_finalizeMutex;
    std::mutex m_inventoryRefreshMutex;
    std::chrono::steady_clock::time_point m_lastInventoryRefresh{};
    std::unordered_map<std::string, uint64_t> m_nextFilenameSuffix;
    std::shared_ptr<HashEngine> m_hashEngine;
    lmt::FilenameConflictPolicy m_filenameConflictPolicy;
    UploadLimits m_limits;
};
