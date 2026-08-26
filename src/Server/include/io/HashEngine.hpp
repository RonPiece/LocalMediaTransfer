#pragma once

/**
 * Streaming SHA-256 plus a versioned SQLite inventory of physical files.
 *
 * SQLite accelerates candidate lookup, but callers must still verify the
 * current file on disk before treating an entry as a duplicate.
 */

#include <cstdint>
#include <atomic>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

typedef struct evp_md_ctx_st EVP_MD_CTX;
struct sqlite3;

struct FileInventoryRecord {
    std::string filename;
    std::string sha256;
    uint64_t sizeBytes = 0;
    int64_t modifiedTime = 0;
    int64_t verifiedAt = 0;
};

class HashEngine {
public:
    HashEngine();
    ~HashEngine();

    HashEngine(const HashEngine&) = delete;
    HashEngine& operator=(const HashEngine&) = delete;

    bool beginHash(const std::string& fileId);
    bool updateHash(const std::string& fileId, const char* data, uint64_t size);
    std::string finalizeHash(const std::string& fileId);
    void abortHash(const std::string& fileId);

    static std::string computeHash(const char* data, uint64_t size);
    static std::string computeFileHash(const std::string& path);

    void openDatabase(const std::string& dbPath);
    void reconcileDirectory(const std::string& uploadDir);
    void startBackgroundIndexing(const std::string& uploadDir);

    std::optional<FileInventoryRecord> findFirstCandidate(
        const std::string& filename,
        uint64_t sizeBytes) const;
    std::vector<FileInventoryRecord> findVerificationCandidates(
        const std::string& filename,
        uint64_t sizeBytes,
        const std::string& expectedHash) const;
    std::vector<FileInventoryRecord> findByHash(const std::string& hash) const;
    void upsertFile(
        const std::string& filename,
        const std::string& hash,
        uint64_t sizeBytes,
        int64_t modifiedTime,
        int64_t verifiedAt);
    void removeFile(const std::string& filename);

    // Compatibility helpers retained for the existing /check_file path.
    std::pair<bool, std::string> hashExists(const std::string& hash) const;
    void addKnownHash(const std::string& hash, const std::string& filename);
    void removeKnownHash(const std::string& hash);
    int getHashCount() const;

private:
    struct HashContext {
        EVP_MD_CTX* ctx = nullptr;
        std::mutex mutex;
    };

    bool executeSchemaMigrationUnsafe();
    int getHashCountUnsafe() const;
    std::vector<FileInventoryRecord> findUnhashedFiles() const;
    void runBackgroundIndexing(std::string uploadDir);

    std::unordered_map<std::string, std::shared_ptr<HashContext>> m_contexts;
    mutable std::mutex m_mutex;
    sqlite3* m_db = nullptr;
    std::atomic<bool> m_stopBackground{false};
    std::thread m_backgroundThread;
};
