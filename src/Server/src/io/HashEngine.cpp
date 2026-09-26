#include "io/HashEngine.hpp"
#include "common/SqliteChecked.hpp"

#include <openssl/evp.h>
#include <spdlog/spdlog.h>
#include <sqlite3.h>

#include <chrono>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <sstream>
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

FileInventoryRecord readInventoryRecord(sqlite3_stmt* statement) {
    FileInventoryRecord record;
    const char* name = reinterpret_cast<const char*>(sqlite3_column_text(statement, 0));
    const char* hash = reinterpret_cast<const char*>(sqlite3_column_text(statement, 1));
    record.filename = name ? name : "";
    record.sha256 = hash ? hash : "";
    record.sizeBytes = static_cast<uint64_t>(sqlite3_column_int64(statement, 2));
    record.modifiedTime = sqlite3_column_int64(statement, 3);
    record.verifiedAt = sqlite3_column_int64(statement, 4);
    return record;
}
}

HashEngine::HashEngine() = default;

#ifdef LMT_STORAGE_TESTING
std::atomic<bool> HashEngine::s_failHashFinalization{false};
std::atomic<int> HashEngine::s_freedHashContexts{0};
void HashEngine::failHashFinalizationForTesting(bool fail) noexcept {
    s_failHashFinalization.store(fail);
}
int HashEngine::freedHashContextsForTesting() noexcept {
    return s_freedHashContexts.load();
}
#endif

void HashEngine::MdCtxDeleter::operator()(EVP_MD_CTX* context) const noexcept {
    EVP_MD_CTX_free(context);
#ifdef LMT_STORAGE_TESTING
    if (context) s_freedHashContexts.fetch_add(1);
#endif
}

void HashEngine::requireHealthy() const {
    if (!m_healthy.load()) throw InventoryStorageError("file inventory unavailable");
}

void HashEngine::markUnhealthy() const noexcept {
    m_healthy.store(false);
    spdlog::error("File inventory is unhealthy; restart after correcting storage");
}

HashEngine::~HashEngine() {
    m_stopBackground.store(true);
    if (m_backgroundThread.joinable()) {
        m_backgroundThread.join();
    }
    std::lock_guard<std::mutex> lock(m_mutex);
    m_contexts.clear();
    if (m_db) {
        sqlite3_close(m_db);
        m_db = nullptr;
    }
}

void HashEngine::openDatabase(const std::string& dbPath) {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (sqlite3_open(dbPath.c_str(), &m_db) != SQLITE_OK) {
        sqlite3_close(m_db);
        m_db = nullptr;
        throw InventoryStorageError("unable to open file inventory");
    }
    try {
        lmt::sqlite::check(sqlite3_busy_timeout(m_db, 5000), "set inventory busy timeout");
        lmt::sqlite::execute(m_db, "PRAGMA journal_mode=WAL;", "configure inventory journal");
        lmt::sqlite::execute(m_db, "PRAGMA synchronous=NORMAL;", "configure inventory sync");
        lmt::sqlite::execute(m_db, "PRAGMA foreign_keys=ON;", "configure inventory foreign keys");
        executeSchemaMigrationUnsafe();
        m_healthy.store(true);
        spdlog::info("File inventory opened ({} indexed files)", getHashCountUnsafe());
    } catch (const std::exception& e) {
        spdlog::error("File inventory initialization failed: {}", e.what());
        m_healthy.store(false);
        sqlite3_close(m_db);
        m_db = nullptr;
        throw InventoryStorageError("unable to initialize file inventory");
    }
}

void HashEngine::executeSchemaMigrationUnsafe() {
    lmt::sqlite::Transaction migration(m_db);
    lmt::sqlite::Statement versionStatement(m_db, "PRAGMA user_version;");
    int version = 0;
    if (versionStatement.step() != SQLITE_ROW)
        throw InventoryStorageError("unable to read inventory schema version");
    version = sqlite3_column_int(versionStatement.get(), 0);
    versionStatement.done();

    if (version < InventorySchemaVersion) {
        lmt::sqlite::Statement tableStatement(
            m_db, "SELECT 1 FROM sqlite_master WHERE type='table' AND name='files';");
        const bool hasFilesTable = tableStatement.step() == SQLITE_ROW;
        if (hasFilesTable) tableStatement.done();

        if (hasFilesTable) {
            lmt::sqlite::execute(m_db, "ALTER TABLE files RENAME TO files_legacy;", "rename inventory");
        }

        lmt::sqlite::execute(
            m_db,
            "CREATE TABLE files ("
            " filename TEXT PRIMARY KEY NOT NULL,"
            " sha256 TEXT,"
            " size_bytes INTEGER NOT NULL,"
            " modified_time INTEGER NOT NULL,"
            " verified_at INTEGER NOT NULL"
            ");"
            "CREATE INDEX idx_files_sha256 ON files(sha256);"
            "CREATE INDEX idx_files_size ON files(size_bytes);", "create inventory schema");

        if (hasFilesTable) {
            lmt::sqlite::execute(
                m_db,
                "INSERT OR IGNORE INTO files "
                "(filename, sha256, size_bytes, modified_time, verified_at) "
                "SELECT filename, hash, 0, 0, created_at FROM files_legacy;"
                "DROP TABLE files_legacy;", "migrate inventory rows");
        }
        lmt::sqlite::execute(m_db, "PRAGMA user_version=2;", "set inventory version");
    } else {
        lmt::sqlite::execute(
            m_db,
            "CREATE TABLE IF NOT EXISTS files ("
            " filename TEXT PRIMARY KEY NOT NULL,"
            " sha256 TEXT,"
            " size_bytes INTEGER NOT NULL,"
            " modified_time INTEGER NOT NULL,"
            " verified_at INTEGER NOT NULL"
            ");"
            "CREATE INDEX IF NOT EXISTS idx_files_sha256 ON files(sha256);"
            "CREATE INDEX IF NOT EXISTS idx_files_size ON files(size_bytes);", "verify inventory schema");
    }
    migration.commit();
}

void HashEngine::reconcileDirectory(const std::string& uploadDir) {
    const fs::path root = fs::u8path(uploadDir);
    std::lock_guard<std::mutex> lock(m_mutex);
    requireHealthy();
    try {
        lmt::sqlite::Transaction transaction(m_db);
        lmt::sqlite::Statement lookup(m_db,
            "SELECT size_bytes, modified_time, sha256, verified_at "
            "FROM files WHERE filename=?;");
        lmt::sqlite::Statement upsert(m_db,
            "INSERT INTO files(filename,sha256,size_bytes,modified_time,verified_at) "
            "VALUES(?,?,?,?,?) ON CONFLICT(filename) DO UPDATE SET "
            "sha256=excluded.sha256,size_bytes=excluded.size_bytes,"
            "modified_time=excluded.modified_time,verified_at=excluded.verified_at;");

        std::error_code ec;
        for (fs::directory_iterator it(root, ec), end; !ec && it != end; it.increment(ec)) {
            const auto& entry = *it;
            if (!isManagedFile(entry)) continue;
            FileInventoryRecord disk;
            disk.filename = entry.path().filename().u8string();
            std::error_code statError;
            disk.sizeBytes = entry.file_size(statError);
            if (statError) continue;
            disk.modifiedTime = fileModifiedTime(entry.path());
            std::string retainedHash;
            int64_t retainedVerifiedAt = 0;

            lookup.text(1, disk.filename);
            if (lookup.step() == SQLITE_ROW) {
                const uint64_t knownSize =
                    static_cast<uint64_t>(sqlite3_column_int64(lookup.get(), 0));
                const int64_t knownModified = sqlite3_column_int64(lookup.get(), 1);
                if (knownSize == disk.sizeBytes && knownModified == disk.modifiedTime) {
                    const char* hash = reinterpret_cast<const char*>(
                        sqlite3_column_text(lookup.get(), 2));
                    retainedHash = hash ? hash : "";
                    retainedVerifiedAt = sqlite3_column_int64(lookup.get(), 3);
                }
                lookup.done();
            }
            lookup.reset();

            upsert.text(1, disk.filename);
            if (retainedHash.empty()) upsert.null(2);
            else upsert.text(2, retainedHash);
            upsert.integer64(3, static_cast<sqlite3_int64>(disk.sizeBytes));
            upsert.integer64(4, disk.modifiedTime);
            upsert.integer64(5, retainedVerifiedAt);
            upsert.done();
            upsert.reset();
        }
        if (ec) throw std::runtime_error("unable to enumerate upload directory");

        lmt::sqlite::Statement all(m_db, "SELECT filename FROM files;");
        lmt::sqlite::Statement remove(m_db, "DELETE FROM files WHERE filename=?;");
        while (all.step() == SQLITE_ROW) {
            const char* value = reinterpret_cast<const char*>(
                sqlite3_column_text(all.get(), 0));
            const std::string filename = value ? value : "";
            std::error_code statError;
            const bool exists = fs::is_regular_file(
                root / fs::u8path(filename).filename(), statError);
            if (!exists && (!statError || statError == std::errc::no_such_file_or_directory)) {
                remove.text(1, filename);
                remove.done();
                remove.reset();
            }
        }
        transaction.commit();
    } catch (const std::exception& e) {
        spdlog::error("File inventory reconciliation failed: {}", e.what());
        markUnhealthy();
        throw InventoryStorageError("file inventory reconciliation failed");
    }
}

std::optional<FileInventoryRecord> HashEngine::findFirstCandidate(
    const std::string& filename, uint64_t sizeBytes) const {
    std::lock_guard<std::mutex> lock(m_mutex);
    requireHealthy();
    try {
        lmt::sqlite::Statement statement(m_db,
            "SELECT filename,COALESCE(sha256,''),size_bytes,modified_time,"
            "verified_at FROM files WHERE filename=?1 OR size_bytes=?2 "
            "ORDER BY CASE WHEN filename=?1 THEN 0 ELSE 1 END LIMIT 1;");
        statement.text(1, filename);
        statement.integer64(2, static_cast<sqlite3_int64>(sizeBytes));
        if (statement.step() == SQLITE_DONE) return std::nullopt;
        auto record = readInventoryRecord(statement.get());
        statement.done();
        return record;
    } catch (...) {
        markUnhealthy();
        throw;
    }
}

std::vector<FileInventoryRecord> HashEngine::findVerificationCandidates(
    const std::string& filename, uint64_t sizeBytes,
    const std::string& expectedHash, const std::string& afterFilename) const {
    std::lock_guard<std::mutex> lock(m_mutex);
    requireHealthy();
    std::vector<FileInventoryRecord> records;
    if (filename.empty() || expectedHash.empty()) return records;
    try {
        lmt::sqlite::Statement statement(m_db,
            "SELECT filename,COALESCE(sha256,''),size_bytes,modified_time,"
            "verified_at FROM files "
            "WHERE (filename=?1 OR sha256=?2 OR size_bytes=?3) AND filename>?4 "
            "ORDER BY filename LIMIT 256;");
        statement.text(1, filename);
        statement.text(2, expectedHash);
        statement.integer64(3, static_cast<sqlite3_int64>(sizeBytes));
        statement.text(4, afterFilename);
        while (statement.step() == SQLITE_ROW) {
            records.push_back(readInventoryRecord(statement.get()));
        }
        return records;
    } catch (...) {
        markUnhealthy();
        throw;
    }
}

std::vector<FileInventoryRecord> HashEngine::findUnhashedFiles(
    const std::string& afterFilename) const {
    std::lock_guard<std::mutex> lock(m_mutex);
    requireHealthy();
    std::vector<FileInventoryRecord> records;
    try {
        lmt::sqlite::Statement statement(m_db,
            "SELECT filename,COALESCE(sha256,''),size_bytes,modified_time,"
            "verified_at FROM files WHERE COALESCE(sha256,'')='' AND filename>?1 "
            "ORDER BY filename LIMIT 256;");
        statement.text(1, afterFilename);
        while (statement.step() == SQLITE_ROW) {
            records.push_back(readInventoryRecord(statement.get()));
        }
        return records;
    } catch (...) {
        markUnhealthy();
        throw;
    }
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
        try {
        reconcileDirectory(uploadDir);
        std::string afterFilename;
        while (!m_stopBackground.load()) {
            const auto records = findUnhashedFiles(afterFilename);
            if (records.empty()) break;
            afterFilename = records.back().filename;
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
        }
        } catch (const std::exception& e) {
            spdlog::error("Background inventory indexing stopped: {}", e.what());
            markUnhealthy();
            return;
        }
        for (auto waited = std::chrono::milliseconds(0);
             waited < ReconcileInterval && !m_stopBackground.load();
             waited += std::chrono::milliseconds(100)) {
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
    }
}

std::vector<FileInventoryRecord> HashEngine::findByHash(
    const std::string& hash, const std::string& afterFilename) const {
    std::lock_guard<std::mutex> lock(m_mutex);
    requireHealthy();
    std::vector<FileInventoryRecord> records;
    if (hash.empty()) return records;
    try {
        lmt::sqlite::Statement statement(m_db,
            "SELECT filename,sha256,size_bytes,modified_time,verified_at "
            "FROM files WHERE sha256=?1 AND filename>?2 ORDER BY filename LIMIT 256;");
        statement.text(1, hash);
        statement.text(2, afterFilename);
        while (statement.step() == SQLITE_ROW) {
            records.push_back(readInventoryRecord(statement.get()));
        }
        return records;
    } catch (...) {
        markUnhealthy();
        throw;
    }
}

void HashEngine::upsertFile(
    const std::string& filename, const std::string& hash,
    uint64_t sizeBytes, int64_t modifiedTime, int64_t verifiedAt) {
    std::lock_guard<std::mutex> lock(m_mutex);
    requireHealthy();
    if (filename.empty()) return;
    try {
        lmt::sqlite::Statement statement(m_db,
            "INSERT INTO files(filename,sha256,size_bytes,modified_time,verified_at) "
            "VALUES(?,?,?,?,?) ON CONFLICT(filename) DO UPDATE SET "
            "sha256=excluded.sha256,size_bytes=excluded.size_bytes,"
            "modified_time=excluded.modified_time,verified_at=excluded.verified_at;");
        statement.text(1, filename);
        if (hash.empty()) statement.null(2);
        else statement.text(2, hash);
        statement.integer64(3, static_cast<sqlite3_int64>(sizeBytes));
        statement.integer64(4, modifiedTime);
        statement.integer64(5, verifiedAt);
        statement.done();
    } catch (...) {
        markUnhealthy();
        throw;
    }
}

void HashEngine::removeFile(const std::string& filename) {
    std::lock_guard<std::mutex> lock(m_mutex);
    requireHealthy();
    if (filename.empty()) return;
    try {
        lmt::sqlite::Statement statement(m_db, "DELETE FROM files WHERE filename=?;");
        statement.text(1, filename);
        statement.done();
    } catch (...) {
        markUnhealthy();
        throw;
    }
}

int HashEngine::getHashCount() const {
    std::lock_guard<std::mutex> lock(m_mutex);
    return getHashCountUnsafe();
}

int HashEngine::getHashCountUnsafe() const {
    if (!m_db) throw InventoryStorageError("file inventory unavailable");
    try {
        lmt::sqlite::Statement statement(m_db, "SELECT COUNT(*) FROM files;");
        if (statement.step() != SQLITE_ROW)
            throw InventoryStorageError("unable to count inventory entries");
        const int count = sqlite3_column_int(statement.get(), 0);
        statement.done();
        return count;
    } catch (...) {
        markUnhealthy();
        throw;
    }
}

bool HashEngine::beginHash(const std::string& fileId) {
    auto context = std::make_shared<HashContext>();
    context->ctx.reset(EVP_MD_CTX_new());
    if (!context->ctx ||
        EVP_DigestInit_ex(context->ctx.get(), EVP_sha256(), nullptr) != 1) {
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
        previous->ctx.reset();
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
           EVP_DigestUpdate(context->ctx.get(), data, size) == 1;
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
#ifdef LMT_STORAGE_TESTING
            s_failHashFinalization.load() ||
#endif
            EVP_DigestFinal_ex(context->ctx.get(), digest, &length) != 1) {
            return "";
        }
        context->ctx.reset();
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
    context->ctx.reset();
}

std::string HashEngine::computeHash(const char* data, uint64_t size) {
    std::unique_ptr<EVP_MD_CTX, MdCtxDeleter> context(EVP_MD_CTX_new());
    if (!context) {
        return "";
    }
    unsigned char digest[EVP_MAX_MD_SIZE];
    unsigned int length = 0;
    const bool ok =
        EVP_DigestInit_ex(context.get(), EVP_sha256(), nullptr) == 1 &&
        EVP_DigestUpdate(context.get(), data, size) == 1 &&
        EVP_DigestFinal_ex(context.get(), digest, &length) == 1;
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

std::string HashEngine::computeFileHash(const std::string& path,
    std::optional<uint64_t> expectedSize) {
    std::ifstream input(fs::u8path(path), std::ios::binary);
    if (!input) {
        return "";
    }
    std::error_code ec;
    const auto size = fs::file_size(fs::u8path(path), ec);
    if (ec || (expectedSize && size != *expectedSize)) return "";
    return computeStreamHash(input, expectedSize.value_or(size));
}

std::string HashEngine::computeStreamHash(std::istream& input,
    std::optional<uint64_t> expectedSize) {
    EVP_MD_CTX* context = EVP_MD_CTX_new();
    if (!context || EVP_DigestInit_ex(context, EVP_sha256(), nullptr) != 1) {
        EVP_MD_CTX_free(context);
        return "";
    }

    std::unique_ptr<EVP_MD_CTX, decltype(&EVP_MD_CTX_free)> owner(context, EVP_MD_CTX_free);
    std::vector<char> buffer(4 * 1024 * 1024);
    uint64_t consumed = 0;
    try {
        while (input) {
            input.read(buffer.data(), static_cast<std::streamsize>(buffer.size()));
            const auto count = input.gcount();
            if (count > 0) consumed += static_cast<uint64_t>(count);
            if (count > 0 &&
                EVP_DigestUpdate(context, buffer.data(), static_cast<size_t>(count)) != 1) {
                return "";
            }
        }
    } catch (const std::ios_base::failure&) { return ""; }
    if (input.bad() || !input.eof() ||
        (expectedSize && consumed != *expectedSize)) return "";

    unsigned char digest[EVP_MAX_MD_SIZE];
    unsigned int length = 0;
    if (EVP_DigestFinal_ex(context, digest, &length) != 1) {
        return "";
    }

    std::ostringstream output;
    output << std::hex << std::setfill('0');
    for (unsigned int i = 0; i < length; ++i) {
        output << std::setw(2) << static_cast<unsigned int>(digest[i]);
    }
    return output.str();
}
