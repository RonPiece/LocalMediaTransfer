#include "io/HashEngine.hpp"

#include <openssl/evp.h>
#include <spdlog/spdlog.h>
#include <sqlite3.h>

#include <chrono>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <unordered_set>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#endif

namespace fs = std::filesystem;

namespace {
constexpr int InventorySchemaVersion = 2;

int64_t unixNow() {
    return static_cast<int64_t>(std::time(nullptr));
}

int64_t fileModifiedTime(const fs::path& path) {
    std::error_code ec;
    const auto value = fs::last_write_time(path, ec);
    if (ec) {
        return 0;
    }
    return std::chrono::duration_cast<std::chrono::nanoseconds>(
               value.time_since_epoch())
        .count();
}

bool isManagedFile(const fs::directory_entry& entry) {
    std::error_code ec;
    if (!entry.is_regular_file(ec) || ec) {
        return false;
    }
    const std::string name = entry.path().filename().u8string();
    return !(name.size() > 5 &&
             name.front() == '.' &&
             name.compare(name.size() - 4, 4, ".tmp") == 0);
}

bool execSql(sqlite3* db, const char* sql) {
    char* message = nullptr;
    const int rc = sqlite3_exec(db, sql, nullptr, nullptr, &message);
    if (rc != SQLITE_OK) {
        spdlog::error("SQLite error: {}", message ? message : "unknown");
        sqlite3_free(message);
        return false;
    }
    return true;
}
}

HashEngine::HashEngine() = default;

HashEngine::~HashEngine() {
    m_stopBackground.store(true);
    if (m_backgroundThread.joinable()) {
        m_backgroundThread.join();
    }
    std::lock_guard<std::mutex> lock(m_mutex);
    for (auto& [id, context] : m_contexts) {
        std::lock_guard<std::mutex> contextLock(context->mutex);
        if (context->ctx) {
            EVP_MD_CTX_free(context->ctx);
            context->ctx = nullptr;
        }
    }
    m_contexts.clear();
    if (m_db) {
        sqlite3_close(m_db);
        m_db = nullptr;
    }
}

void HashEngine::openDatabase(const std::string& dbPath) {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (sqlite3_open(dbPath.c_str(), &m_db) != SQLITE_OK) {
        spdlog::error("Failed to open hash database: {}", sqlite3_errmsg(m_db));
        sqlite3_close(m_db);
        m_db = nullptr;
        return;
    }

    sqlite3_busy_timeout(m_db, 5000);
    execSql(m_db, "PRAGMA journal_mode=WAL;");
    execSql(m_db, "PRAGMA synchronous=NORMAL;");
    execSql(m_db, "PRAGMA foreign_keys=ON;");

    if (!executeSchemaMigrationUnsafe()) {
        spdlog::error("Failed to initialize file inventory schema");
        return;
    }

    spdlog::info(
        "File inventory opened: {} ({} indexed files)",
        dbPath,
        getHashCountUnsafe());
}

bool HashEngine::executeSchemaMigrationUnsafe() {
    if (!m_db || !execSql(m_db, "BEGIN IMMEDIATE;")) {
        return false;
    }

    sqlite3_stmt* versionStatement = nullptr;
    int version = 0;
    if (sqlite3_prepare_v2(
            m_db,
            "PRAGMA user_version;",
            -1,
            &versionStatement,
            nullptr) == SQLITE_OK &&
        sqlite3_step(versionStatement) == SQLITE_ROW) {
        version = sqlite3_column_int(versionStatement, 0);
    }
    sqlite3_finalize(versionStatement);

    bool ok = true;
    if (version < InventorySchemaVersion) {
        sqlite3_stmt* tableStatement = nullptr;
        bool hasFilesTable = false;
        if (sqlite3_prepare_v2(
                m_db,
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='files';",
                -1,
                &tableStatement,
                nullptr) == SQLITE_OK) {
            hasFilesTable = sqlite3_step(tableStatement) == SQLITE_ROW;
        }
        sqlite3_finalize(tableStatement);

        if (hasFilesTable) {
            ok = execSql(m_db, "ALTER TABLE files RENAME TO files_legacy;");
        }

        ok = ok && execSql(
            m_db,
            "CREATE TABLE files ("
            " filename TEXT PRIMARY KEY NOT NULL,"
            " sha256 TEXT,"
            " size_bytes INTEGER NOT NULL,"
            " modified_time INTEGER NOT NULL,"
            " verified_at INTEGER NOT NULL"
            ");"
            "CREATE INDEX idx_files_sha256 ON files(sha256);"
            "CREATE INDEX idx_files_size ON files(size_bytes);");

        if (ok && hasFilesTable) {
            ok = execSql(
                m_db,
                "INSERT OR IGNORE INTO files "
                "(filename, sha256, size_bytes, modified_time, verified_at) "
                "SELECT filename, hash, 0, 0, created_at FROM files_legacy;"
                "DROP TABLE files_legacy;");
        }

        if (ok) {
            ok = execSql(m_db, "PRAGMA user_version=2;");
        }
    } else {
        ok = execSql(
            m_db,
            "CREATE TABLE IF NOT EXISTS files ("
            " filename TEXT PRIMARY KEY NOT NULL,"
            " sha256 TEXT,"
            " size_bytes INTEGER NOT NULL,"
            " modified_time INTEGER NOT NULL,"
            " verified_at INTEGER NOT NULL"
            ");"
            "CREATE INDEX IF NOT EXISTS idx_files_sha256 ON files(sha256);"
            "CREATE INDEX IF NOT EXISTS idx_files_size ON files(size_bytes);");
    }

    execSql(m_db, ok ? "COMMIT;" : "ROLLBACK;");
    return ok;
}

void HashEngine::reconcileDirectory(const std::string& uploadDir) {
    std::vector<FileInventoryRecord> diskFiles;
    const fs::path root = fs::u8path(uploadDir);
    std::error_code ec;
    for (const auto& entry : fs::directory_iterator(root, ec)) {
        if (ec) {
            break;
        }
        if (!isManagedFile(entry) ||
            entry.path().filename() == fs::u8path("_dont_delete")) {
            continue;
        }

        FileInventoryRecord record;
        record.filename = entry.path().filename().u8string();
        record.sizeBytes = entry.file_size(ec);
        if (ec) {
            ec.clear();
            continue;
        }
        record.modifiedTime = fileModifiedTime(entry.path());
        diskFiles.push_back(std::move(record));
    }

    std::lock_guard<std::mutex> lock(m_mutex);
    if (!m_db) {
        return;
    }

    execSql(m_db, "BEGIN IMMEDIATE;");
    std::unordered_set<std::string> present;
    sqlite3_stmt* lookup = nullptr;
    sqlite3_stmt* upsert = nullptr;
    sqlite3_prepare_v2(
        m_db,
        "SELECT size_bytes, modified_time, sha256, verified_at "
        "FROM files WHERE filename=?;",
        -1,
        &lookup,
        nullptr);
    sqlite3_prepare_v2(
        m_db,
        "INSERT INTO files(filename,sha256,size_bytes,modified_time,verified_at) "
        "VALUES(?,?,?,?,?) ON CONFLICT(filename) DO UPDATE SET "
        "sha256=excluded.sha256,size_bytes=excluded.size_bytes,"
        "modified_time=excluded.modified_time,verified_at=excluded.verified_at;",
        -1,
        &upsert,
        nullptr);

    for (const auto& disk : diskFiles) {
        present.insert(disk.filename);
        std::string retainedHash;
        int64_t retainedVerifiedAt = 0;

        sqlite3_bind_text(
            lookup,
            1,
            disk.filename.c_str(),
            -1,
            SQLITE_TRANSIENT);
        if (sqlite3_step(lookup) == SQLITE_ROW) {
            const uint64_t knownSize =
                static_cast<uint64_t>(sqlite3_column_int64(lookup, 0));
            const int64_t knownModified = sqlite3_column_int64(lookup, 1);
            if (knownSize == disk.sizeBytes &&
                knownModified == disk.modifiedTime) {
                const char* hash = reinterpret_cast<const char*>(
                    sqlite3_column_text(lookup, 2));
                retainedHash = hash ? hash : "";
                retainedVerifiedAt = sqlite3_column_int64(lookup, 3);
            }
        }
        sqlite3_reset(lookup);
        sqlite3_clear_bindings(lookup);

        sqlite3_bind_text(upsert, 1, disk.filename.c_str(), -1, SQLITE_TRANSIENT);
        if (retainedHash.empty()) {
            sqlite3_bind_null(upsert, 2);
        } else {
            sqlite3_bind_text(
                upsert,
                2,
                retainedHash.c_str(),
                -1,
                SQLITE_TRANSIENT);
        }
        sqlite3_bind_int64(upsert, 3, static_cast<sqlite3_int64>(disk.sizeBytes));
        sqlite3_bind_int64(upsert, 4, disk.modifiedTime);
        sqlite3_bind_int64(upsert, 5, retainedVerifiedAt);
        sqlite3_step(upsert);
        sqlite3_reset(upsert);
        sqlite3_clear_bindings(upsert);
    }
    sqlite3_finalize(lookup);
    sqlite3_finalize(upsert);

    sqlite3_stmt* all = nullptr;
    sqlite3_stmt* remove = nullptr;
    sqlite3_prepare_v2(m_db, "SELECT filename FROM files;", -1, &all, nullptr);
    sqlite3_prepare_v2(
        m_db,
        "DELETE FROM files WHERE filename=?;",
        -1,
        &remove,
        nullptr);
    while (sqlite3_step(all) == SQLITE_ROW) {
        const char* value = reinterpret_cast<const char*>(
            sqlite3_column_text(all, 0));
        const std::string filename = value ? value : "";
        if (present.find(filename) == present.end()) {
            sqlite3_bind_text(
                remove,
                1,
                filename.c_str(),
                -1,
                SQLITE_TRANSIENT);
            sqlite3_step(remove);
            sqlite3_reset(remove);
            sqlite3_clear_bindings(remove);
        }
    }
    sqlite3_finalize(all);
    sqlite3_finalize(remove);
    execSql(m_db, "COMMIT;");
}

std::optional<FileInventoryRecord> HashEngine::findFirstCandidate(
    const std::string& filename,
    uint64_t sizeBytes) const {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (!m_db) {
        return std::nullopt;
    }

    sqlite3_stmt* statement = nullptr;
    if (sqlite3_prepare_v2(
            m_db,
            "SELECT filename,COALESCE(sha256,''),size_bytes,modified_time,"
            "verified_at FROM files WHERE filename=?1 OR size_bytes=?2 "
            "ORDER BY CASE WHEN filename=?1 THEN 0 ELSE 1 END LIMIT 1;",
            -1,
            &statement,
            nullptr) != SQLITE_OK) {
        return std::nullopt;
    }
    sqlite3_bind_text(statement, 1, filename.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(statement, 2, static_cast<sqlite3_int64>(sizeBytes));
    std::optional<FileInventoryRecord> result;
    if (sqlite3_step(statement) == SQLITE_ROW) {
        FileInventoryRecord record;
        const char* name = reinterpret_cast<const char*>(
            sqlite3_column_text(statement, 0));
        const char* hash = reinterpret_cast<const char*>(
            sqlite3_column_text(statement, 1));
        record.filename = name ? name : "";
        record.sha256 = hash ? hash : "";
        record.sizeBytes =
            static_cast<uint64_t>(sqlite3_column_int64(statement, 2));
        record.modifiedTime = sqlite3_column_int64(statement, 3);
        record.verifiedAt = sqlite3_column_int64(statement, 4);
        result = std::move(record);
    }
    sqlite3_finalize(statement);
    return result;
}

std::vector<FileInventoryRecord> HashEngine::findVerificationCandidates(
    const std::string& filename,
    uint64_t sizeBytes,
    const std::string& expectedHash) const {
    std::vector<FileInventoryRecord> records;
    std::lock_guard<std::mutex> lock(m_mutex);
    if (!m_db || filename.empty() || expectedHash.empty()) {
        return records;
    }

    constexpr int CandidatePageSize = 256;
    sqlite3_stmt* statement = nullptr;
    if (sqlite3_prepare_v2(
            m_db,
            "SELECT filename,COALESCE(sha256,''),size_bytes,modified_time,"
            "verified_at FROM files "
            "WHERE filename=?1 OR sha256=?2 OR size_bytes=?3 "
            "ORDER BY CASE WHEN filename=?1 THEN 0 "
            "WHEN sha256=?2 THEN 1 "
            "WHEN COALESCE(sha256,'')='' THEN 2 ELSE 3 END, filename "
            "LIMIT ?4 OFFSET ?5;",
            -1,
            &statement,
            nullptr) != SQLITE_OK) {
        return records;
    }
    sqlite3_bind_text(statement, 1, filename.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(statement, 2, expectedHash.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(statement, 3, static_cast<sqlite3_int64>(sizeBytes));
    sqlite3_bind_int(statement, 4, CandidatePageSize);
    int offset = 0;
    while (true) {
        sqlite3_bind_int(statement, 5, offset);
        int pageCount = 0;
        while (sqlite3_step(statement) == SQLITE_ROW) {
            FileInventoryRecord record;
            const char* name = reinterpret_cast<const char*>(
                sqlite3_column_text(statement, 0));
            const char* hash = reinterpret_cast<const char*>(
                sqlite3_column_text(statement, 1));
            record.filename = name ? name : "";
            record.sha256 = hash ? hash : "";
            record.sizeBytes =
                static_cast<uint64_t>(sqlite3_column_int64(statement, 2));
            record.modifiedTime = sqlite3_column_int64(statement, 3);
            record.verifiedAt = sqlite3_column_int64(statement, 4);
            records.push_back(std::move(record));
            ++pageCount;
        }
        if (pageCount < CandidatePageSize) {
            break;
        }
        offset += pageCount;
        sqlite3_reset(statement);
        sqlite3_clear_bindings(statement);
        sqlite3_bind_text(statement, 1, filename.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(statement, 2, expectedHash.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int64(statement, 3, static_cast<sqlite3_int64>(sizeBytes));
        sqlite3_bind_int(statement, 4, CandidatePageSize);
    }
    sqlite3_finalize(statement);
    return records;
}

std::vector<FileInventoryRecord> HashEngine::findUnhashedFiles() const {
    std::vector<FileInventoryRecord> records;
    std::lock_guard<std::mutex> lock(m_mutex);
    if (!m_db) {
        return records;
    }
    sqlite3_stmt* statement = nullptr;
    if (sqlite3_prepare_v2(
            m_db,
            "SELECT filename,COALESCE(sha256,''),size_bytes,modified_time,"
            "verified_at FROM files WHERE COALESCE(sha256,'')='' "
            "ORDER BY filename;",
            -1,
            &statement,
            nullptr) != SQLITE_OK) {
        return records;
    }
    while (sqlite3_step(statement) == SQLITE_ROW) {
        FileInventoryRecord record;
        const char* name = reinterpret_cast<const char*>(
            sqlite3_column_text(statement, 0));
        record.filename = name ? name : "";
        record.sizeBytes =
            static_cast<uint64_t>(sqlite3_column_int64(statement, 2));
        record.modifiedTime = sqlite3_column_int64(statement, 3);
        record.verifiedAt = sqlite3_column_int64(statement, 4);
        records.push_back(std::move(record));
    }
    sqlite3_finalize(statement);
    return records;
}

void HashEngine::startBackgroundIndexing(const std::string& uploadDir) {
    if (m_backgroundThread.joinable() || uploadDir.empty()) {
        return;
    }
    m_stopBackground.store(false);
    m_backgroundThread = std::thread(
        [this, uploadDir]() { runBackgroundIndexing(uploadDir); });
}

void HashEngine::runBackgroundIndexing(std::string uploadDir) {
#ifdef _WIN32
    SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_BELOW_NORMAL);
#endif
    constexpr auto ReconcileInterval = std::chrono::seconds(5);
    while (!m_stopBackground.load()) {
        reconcileDirectory(uploadDir);
        const auto records = findUnhashedFiles();
        for (const auto& record : records) {
            if (m_stopBackground.load()) {
                return;
            }
            const fs::path path = fs::u8path(uploadDir) /
                fs::u8path(record.filename).filename();
            std::error_code ec;
            if (!fs::is_regular_file(path, ec) || ec) {
                removeFile(record.filename);
                continue;
            }
            const uint64_t beforeSize = fs::file_size(path, ec);
            const int64_t beforeModified = fileModifiedTime(path);
            if (ec || beforeSize != record.sizeBytes ||
                beforeModified != record.modifiedTime) {
                continue;
            }
            const std::string hash = computeFileHash(path.u8string());
            if (hash.empty() || m_stopBackground.load()) {
                continue;
            }
            const uint64_t afterSize = fs::file_size(path, ec);
            const int64_t afterModified = fileModifiedTime(path);
            if (ec || afterSize != beforeSize || afterModified != beforeModified) {
                continue;
            }
            upsertFile(
                record.filename,
                hash,
                afterSize,
                afterModified,
                unixNow());
        }
        for (auto waited = std::chrono::milliseconds(0);
             waited < ReconcileInterval && !m_stopBackground.load();
             waited += std::chrono::milliseconds(100)) {
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
    }
}

std::vector<FileInventoryRecord> HashEngine::findByHash(
    const std::string& hash) const {
    std::vector<FileInventoryRecord> records;
    std::lock_guard<std::mutex> lock(m_mutex);
    if (!m_db || hash.empty()) {
        return records;
    }
    sqlite3_stmt* statement = nullptr;
    if (sqlite3_prepare_v2(
            m_db,
            "SELECT filename,sha256,size_bytes,modified_time,verified_at "
            "FROM files WHERE sha256=?;",
            -1,
            &statement,
            nullptr) != SQLITE_OK) {
        return records;
    }
    sqlite3_bind_text(statement, 1, hash.c_str(), -1, SQLITE_TRANSIENT);
    while (sqlite3_step(statement) == SQLITE_ROW) {
        FileInventoryRecord record;
        const char* name = reinterpret_cast<const char*>(
            sqlite3_column_text(statement, 0));
        record.filename = name ? name : "";
        record.sha256 = hash;
        record.sizeBytes =
            static_cast<uint64_t>(sqlite3_column_int64(statement, 2));
        record.modifiedTime = sqlite3_column_int64(statement, 3);
        record.verifiedAt = sqlite3_column_int64(statement, 4);
        records.push_back(std::move(record));
    }
    sqlite3_finalize(statement);
    return records;
}

void HashEngine::upsertFile(
    const std::string& filename,
    const std::string& hash,
    uint64_t sizeBytes,
    int64_t modifiedTime,
    int64_t verifiedAt) {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (!m_db || filename.empty()) {
        return;
    }
    sqlite3_stmt* statement = nullptr;
    if (sqlite3_prepare_v2(
            m_db,
            "INSERT INTO files(filename,sha256,size_bytes,modified_time,verified_at) "
            "VALUES(?,?,?,?,?) ON CONFLICT(filename) DO UPDATE SET "
            "sha256=excluded.sha256,size_bytes=excluded.size_bytes,"
            "modified_time=excluded.modified_time,verified_at=excluded.verified_at;",
            -1,
            &statement,
            nullptr) != SQLITE_OK) {
        return;
    }
    sqlite3_bind_text(statement, 1, filename.c_str(), -1, SQLITE_TRANSIENT);
    if (hash.empty()) {
        sqlite3_bind_null(statement, 2);
    } else {
        sqlite3_bind_text(statement, 2, hash.c_str(), -1, SQLITE_TRANSIENT);
    }
    sqlite3_bind_int64(statement, 3, static_cast<sqlite3_int64>(sizeBytes));
    sqlite3_bind_int64(statement, 4, modifiedTime);
    sqlite3_bind_int64(statement, 5, verifiedAt);
    if (sqlite3_step(statement) != SQLITE_DONE) {
        spdlog::warn("Failed to update file inventory: {}", sqlite3_errmsg(m_db));
    }
    sqlite3_finalize(statement);
}

void HashEngine::removeFile(const std::string& filename) {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (!m_db || filename.empty()) {
        return;
    }
    sqlite3_stmt* statement = nullptr;
    sqlite3_prepare_v2(
        m_db,
        "DELETE FROM files WHERE filename=?;",
        -1,
        &statement,
        nullptr);
    sqlite3_bind_text(statement, 1, filename.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_step(statement);
    sqlite3_finalize(statement);
}

std::pair<bool, std::string> HashEngine::hashExists(
    const std::string& hash) const {
    const auto records = findByHash(hash);
    return records.empty()
        ? std::make_pair(false, std::string())
        : std::make_pair(true, records.front().filename);
}

void HashEngine::addKnownHash(
    const std::string& hash,
    const std::string& filename) {
    upsertFile(filename, hash, 0, 0, unixNow());
}

void HashEngine::removeKnownHash(const std::string& hash) {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (!m_db || hash.empty()) {
        return;
    }
    sqlite3_stmt* statement = nullptr;
    sqlite3_prepare_v2(
        m_db,
        "DELETE FROM files WHERE sha256=?;",
        -1,
        &statement,
        nullptr);
    sqlite3_bind_text(statement, 1, hash.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_step(statement);
    sqlite3_finalize(statement);
}

int HashEngine::getHashCount() const {
    std::lock_guard<std::mutex> lock(m_mutex);
    return getHashCountUnsafe();
}

int HashEngine::getHashCountUnsafe() const {
    if (!m_db) {
        return 0;
    }
    sqlite3_stmt* statement = nullptr;
    int count = 0;
    if (sqlite3_prepare_v2(
            m_db,
            "SELECT COUNT(*) FROM files;",
            -1,
            &statement,
            nullptr) == SQLITE_OK &&
        sqlite3_step(statement) == SQLITE_ROW) {
        count = sqlite3_column_int(statement, 0);
    }
    sqlite3_finalize(statement);
    return count;
}

bool HashEngine::beginHash(const std::string& fileId) {
    auto context = std::make_shared<HashContext>();
    context->ctx = EVP_MD_CTX_new();
    if (!context->ctx ||
        EVP_DigestInit_ex(context->ctx, EVP_sha256(), nullptr) != 1) {
        if (context->ctx) {
            EVP_MD_CTX_free(context->ctx);
        }
        return false;
    }

    std::shared_ptr<HashContext> previous;
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        auto it = m_contexts.find(fileId);
        if (it != m_contexts.end()) {
            previous = std::move(it->second);
        }
        m_contexts[fileId] = std::move(context);
    }
    if (previous) {
        std::lock_guard<std::mutex> lock(previous->mutex);
        if (previous->ctx) {
            EVP_MD_CTX_free(previous->ctx);
            previous->ctx = nullptr;
        }
    }
    return true;
}

bool HashEngine::updateHash(
    const std::string& fileId,
    const char* data,
    uint64_t size) {
    std::shared_ptr<HashContext> context;
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        auto it = m_contexts.find(fileId);
        if (it == m_contexts.end()) {
            return false;
        }
        context = it->second;
    }
    std::lock_guard<std::mutex> lock(context->mutex);
    return context->ctx &&
           EVP_DigestUpdate(context->ctx, data, size) == 1;
}

std::string HashEngine::finalizeHash(const std::string& fileId) {
    std::shared_ptr<HashContext> context;
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        auto it = m_contexts.find(fileId);
        if (it == m_contexts.end()) {
            return "";
        }
        context = std::move(it->second);
        m_contexts.erase(it);
    }

    unsigned char digest[EVP_MAX_MD_SIZE];
    unsigned int length = 0;
    {
        std::lock_guard<std::mutex> lock(context->mutex);
        if (!context->ctx ||
            EVP_DigestFinal_ex(context->ctx, digest, &length) != 1) {
            return "";
        }
        EVP_MD_CTX_free(context->ctx);
        context->ctx = nullptr;
    }

    std::ostringstream output;
    output << std::hex << std::setfill('0');
    for (unsigned int i = 0; i < length; ++i) {
        output << std::setw(2) << static_cast<unsigned int>(digest[i]);
    }
    return output.str();
}

void HashEngine::abortHash(const std::string& fileId) {
    std::shared_ptr<HashContext> context;
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        auto it = m_contexts.find(fileId);
        if (it == m_contexts.end()) {
            return;
        }
        context = std::move(it->second);
        m_contexts.erase(it);
    }
    std::lock_guard<std::mutex> lock(context->mutex);
    if (context->ctx) {
        EVP_MD_CTX_free(context->ctx);
        context->ctx = nullptr;
    }
}

std::string HashEngine::computeHash(const char* data, uint64_t size) {
    EVP_MD_CTX* context = EVP_MD_CTX_new();
    if (!context) {
        return "";
    }
    unsigned char digest[EVP_MAX_MD_SIZE];
    unsigned int length = 0;
    const bool ok =
        EVP_DigestInit_ex(context, EVP_sha256(), nullptr) == 1 &&
        EVP_DigestUpdate(context, data, size) == 1 &&
        EVP_DigestFinal_ex(context, digest, &length) == 1;
    EVP_MD_CTX_free(context);
    if (!ok) {
        return "";
    }
    std::ostringstream output;
    output << std::hex << std::setfill('0');
    for (unsigned int i = 0; i < length; ++i) {
        output << std::setw(2) << static_cast<unsigned int>(digest[i]);
    }
    return output.str();
}

std::string HashEngine::computeFileHash(const std::string& path) {
    std::ifstream input(fs::u8path(path), std::ios::binary);
    if (!input) {
        return "";
    }
    EVP_MD_CTX* context = EVP_MD_CTX_new();
    if (!context || EVP_DigestInit_ex(context, EVP_sha256(), nullptr) != 1) {
        EVP_MD_CTX_free(context);
        return "";
    }

    std::vector<char> buffer(4 * 1024 * 1024);
    while (input) {
        input.read(buffer.data(), static_cast<std::streamsize>(buffer.size()));
        const auto count = input.gcount();
        if (count > 0 &&
            EVP_DigestUpdate(context, buffer.data(), count) != 1) {
            EVP_MD_CTX_free(context);
            return "";
        }
    }

    unsigned char digest[EVP_MAX_MD_SIZE];
    unsigned int length = 0;
    if (EVP_DigestFinal_ex(context, digest, &length) != 1) {
        EVP_MD_CTX_free(context);
        return "";
    }
    EVP_MD_CTX_free(context);

    std::ostringstream output;
    output << std::hex << std::setfill('0');
    for (unsigned int i = 0; i < length; ++i) {
        output << std::setw(2) << static_cast<unsigned int>(digest[i]);
    }
    return output.str();
}
