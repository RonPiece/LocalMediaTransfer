#include "history/TransferHistoryStore.hpp"

#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>
#include <sqlite3.h>

#include <filesystem>
#include <algorithm>

using json = nlohmann::json;

namespace {
bool execHistorySql(sqlite3* db, const char* sql) {
    char* message = nullptr;
    const int rc = sqlite3_exec(db, sql, nullptr, nullptr, &message);
    if (rc != SQLITE_OK) {
        spdlog::error(
            "Transfer history SQLite error: {}",
            message ? message : "unknown");
        sqlite3_free(message);
        return false;
    }
    return true;
}

bool historyColumnExists(
    sqlite3* db,
    const char* table,
    const char* column) {
    sqlite3_stmt* statement = nullptr;
    const std::string query = std::string("PRAGMA table_info(") + table + ");";
    if (sqlite3_prepare_v2(
            db, query.c_str(), -1, &statement, nullptr) != SQLITE_OK) {
        return false;
    }
    bool found = false;
    while (sqlite3_step(statement) == SQLITE_ROW) {
        const char* name = reinterpret_cast<const char*>(
            sqlite3_column_text(statement, 1));
        if (name && std::string(name) == column) {
            found = true;
            break;
        }
    }
    sqlite3_finalize(statement);
    return found;
}
}

TransferHistoryStore::~TransferHistoryStore() {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (m_db) {
        sqlite3_close(m_db);
        m_db = nullptr;
    }
}

void TransferHistoryStore::open(const std::string& dbPath) {
    std::lock_guard<std::mutex> lock(m_mutex);
    std::filesystem::create_directories(
        std::filesystem::u8path(dbPath).parent_path());
    if (sqlite3_open(dbPath.c_str(), &m_db) != SQLITE_OK) {
        throw std::runtime_error("Unable to open transfer history database");
    }
    sqlite3_busy_timeout(m_db, 5000);
    execHistorySql(m_db, "PRAGMA journal_mode=WAL;");
    execHistorySql(m_db, "PRAGMA synchronous=NORMAL;");
    execHistorySql(m_db, "PRAGMA foreign_keys=ON;");
    if (!execHistorySql(
            m_db,
            "CREATE TABLE IF NOT EXISTS sessions("
            " session_id TEXT PRIMARY KEY,"
            " completed_at INTEGER NOT NULL,"
            " client_ip TEXT NOT NULL,"
            " selected_files INTEGER NOT NULL,"
            " uploaded_files INTEGER NOT NULL,"
            " skipped_files INTEGER NOT NULL,"
            " failed_files INTEGER NOT NULL,"
            " selected_bytes INTEGER NOT NULL,"
            " selected_media_bytes INTEGER NOT NULL DEFAULT 0,"
            " additional_components_bytes INTEGER NOT NULL DEFAULT 0,"
            " selected_media_files INTEGER NOT NULL DEFAULT 0,"
            " additional_components_files INTEGER NOT NULL DEFAULT 0,"
            " uploaded_bytes INTEGER NOT NULL,"
            " skipped_bytes INTEGER NOT NULL,"
            " avoided_bytes INTEGER NOT NULL DEFAULT 0,"
            " finalization_duplicate_bytes INTEGER NOT NULL DEFAULT 0,"
            " check_duration_ms INTEGER NOT NULL,"
            " upload_duration_ms INTEGER NOT NULL,"
            " total_duration_ms INTEGER NOT NULL,"
            " average_speed_mbps REAL NOT NULL,"
            " peak_speed_mbps REAL NOT NULL,"
            " retries INTEGER NOT NULL,"
            " selected_assets INTEGER NOT NULL DEFAULT 0,"
            " expanded_files INTEGER NOT NULL DEFAULT 0"
            ");"
            "CREATE TABLE IF NOT EXISTS session_files("
            " session_id TEXT NOT NULL,"
            " file_id TEXT NOT NULL,"
            " original_name TEXT NOT NULL,"
            " saved_name TEXT NOT NULL,"
            " size_bytes INTEGER NOT NULL,"
            " outcome TEXT NOT NULL,"
            " matched_name TEXT NOT NULL DEFAULT '',"
            " duplicate_stage TEXT NOT NULL DEFAULT '',"
            " avoided_bytes INTEGER NOT NULL DEFAULT 0,"
            " PRIMARY KEY(session_id,file_id),"
            " FOREIGN KEY(session_id) REFERENCES sessions(session_id)"
            " ON DELETE CASCADE"
            ");"
            "PRAGMA user_version=4;")) {
        throw std::runtime_error("Unable to initialize transfer history schema");
    }
    if (!historyColumnExists(m_db, "sessions", "selected_assets")) {
        execHistorySql(m_db,
            "ALTER TABLE sessions ADD COLUMN selected_assets INTEGER NOT NULL DEFAULT 0;");
    }
    if (!historyColumnExists(m_db, "sessions", "expanded_files")) {
        execHistorySql(m_db,
            "ALTER TABLE sessions ADD COLUMN expanded_files INTEGER NOT NULL DEFAULT 0;");
    }
    if (!historyColumnExists(m_db, "sessions", "avoided_bytes")) {
        execHistorySql(m_db,
            "ALTER TABLE sessions ADD COLUMN avoided_bytes INTEGER NOT NULL DEFAULT 0;");
    }
    if (!historyColumnExists(m_db, "sessions", "finalization_duplicate_bytes")) {
        execHistorySql(m_db,
            "ALTER TABLE sessions ADD COLUMN finalization_duplicate_bytes INTEGER NOT NULL DEFAULT 0;");
    }
    if (!historyColumnExists(m_db, "sessions", "selected_media_bytes")) {
        execHistorySql(m_db,
            "ALTER TABLE sessions ADD COLUMN selected_media_bytes INTEGER NOT NULL DEFAULT 0;");
    }
    if (!historyColumnExists(m_db, "sessions", "additional_components_bytes")) {
        execHistorySql(m_db,
            "ALTER TABLE sessions ADD COLUMN additional_components_bytes INTEGER NOT NULL DEFAULT 0;");
    }
    if (!historyColumnExists(m_db, "sessions", "selected_media_files")) {
        execHistorySql(m_db,
            "ALTER TABLE sessions ADD COLUMN selected_media_files INTEGER NOT NULL DEFAULT 0;");
    }
    if (!historyColumnExists(m_db, "sessions", "additional_components_files")) {
        execHistorySql(m_db,
            "ALTER TABLE sessions ADD COLUMN additional_components_files INTEGER NOT NULL DEFAULT 0;");
    }
    if (!historyColumnExists(m_db, "session_files", "matched_name")) {
        execHistorySql(m_db,
            "ALTER TABLE session_files ADD COLUMN matched_name TEXT NOT NULL DEFAULT '';" );
    }
    if (!historyColumnExists(m_db, "session_files", "duplicate_stage")) {
        execHistorySql(m_db,
            "ALTER TABLE session_files ADD COLUMN duplicate_stage TEXT NOT NULL DEFAULT '';" );
    }
    if (!historyColumnExists(m_db, "session_files", "avoided_bytes")) {
        execHistorySql(m_db,
            "ALTER TABLE session_files ADD COLUMN avoided_bytes INTEGER NOT NULL DEFAULT 0;" );
    }
    execHistorySql(m_db, "PRAGMA user_version=4;");
}

void TransferHistoryStore::recordSession(
    const std::string& payloadJson,
    const std::string& clientIp) {
    const json payload = json::parse(payloadJson);
    const std::string sessionId = payload.value("sessionId", "");
    if (sessionId.empty()) {
        throw std::invalid_argument("sessionId is required");
    }

    std::lock_guard<std::mutex> lock(m_mutex);
    if (!m_db) {
        return;
    }
    execHistorySql(m_db, "BEGIN IMMEDIATE;");
    sqlite3_stmt* session = nullptr;
    sqlite3_prepare_v2(
        m_db,
        "INSERT OR REPLACE INTO sessions("
        "session_id,completed_at,client_ip,selected_files,uploaded_files,"
        "skipped_files,failed_files,selected_bytes,uploaded_bytes,skipped_bytes,"
        "selected_media_bytes,additional_components_bytes,"
        "selected_media_files,additional_components_files,"
        "avoided_bytes,finalization_duplicate_bytes,"
        "check_duration_ms,upload_duration_ms,total_duration_ms,"
        "average_speed_mbps,peak_speed_mbps,retries,selected_assets,expanded_files)"
        " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?);",
        -1,
        &session,
        nullptr);
    int column = 1;
    sqlite3_bind_text(session, column++, sessionId.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(
        session,
        column++,
        payload.value("completedAt", static_cast<int64_t>(0)));
    sqlite3_bind_text(session, column++, clientIp.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int(session, column++, payload.value("selectedFiles", 0));
    sqlite3_bind_int(session, column++, payload.value("uploadedFiles", 0));
    sqlite3_bind_int(session, column++, payload.value("skippedFiles", 0));
    sqlite3_bind_int(session, column++, payload.value("failedFiles", 0));
    const int64_t selectedBytes = payload.value("selectedBytes", 0LL);
    sqlite3_bind_int64(session, column++, selectedBytes);
    sqlite3_bind_int64(session, column++, payload.value("uploadedBytes", 0LL));
    sqlite3_bind_int64(session, column++, payload.value("skippedBytes", 0LL));
    sqlite3_bind_int64(
        session, column++, payload.value("selectedMediaBytes", selectedBytes));
    sqlite3_bind_int64(
        session, column++, payload.value("additionalComponentsBytes", 0LL));
    sqlite3_bind_int(
        session, column++, payload.value("selectedMediaFiles", payload.value("selectedFiles", 0)));
    sqlite3_bind_int(
        session, column++, payload.value("additionalComponentsFiles", 0));
    sqlite3_bind_int64(session, column++, payload.value("avoidedBytes", 0LL));
    sqlite3_bind_int64(
        session,
        column++,
        payload.value("finalizationDuplicateBytes", 0LL));
    sqlite3_bind_int64(session, column++, payload.value("checkDurationMs", 0LL));
    sqlite3_bind_int64(session, column++, payload.value("uploadDurationMs", 0LL));
    sqlite3_bind_int64(session, column++, payload.value("totalDurationMs", 0LL));
    sqlite3_bind_double(session, column++, payload.value("averageSpeedMBps", 0.0));
    sqlite3_bind_double(session, column++, payload.value("peakSpeedMBps", 0.0));
    sqlite3_bind_int(session, column++, payload.value("retries", 0));
    sqlite3_bind_int(session, column++, payload.value("selectedAssets", 0));
    sqlite3_bind_int(session, column++, payload.value(
        "expandedFiles", payload.value("selectedFiles", 0)));
    if (sqlite3_step(session) != SQLITE_DONE) {
        sqlite3_finalize(session);
        execHistorySql(m_db, "ROLLBACK;");
        throw std::runtime_error("Unable to store transfer session");
    }
    sqlite3_finalize(session);

    sqlite3_stmt* file = nullptr;
    sqlite3_prepare_v2(
        m_db,
        "INSERT OR REPLACE INTO session_files("
        "session_id,file_id,original_name,saved_name,size_bytes,outcome,"
        "matched_name,duplicate_stage,avoided_bytes) VALUES(?,?,?,?,?,?,?,?,?);",
        -1,
        &file,
        nullptr);
    for (const auto& item : payload.value("files", json::array())) {
        sqlite3_bind_text(file, 1, sessionId.c_str(), -1, SQLITE_TRANSIENT);
        const std::string id = item.value("id", "");
        const std::string original = item.value("name", "");
        const std::string saved = item.value("savedName", original);
        const std::string outcome = item.value("outcome", "failed");
        sqlite3_bind_text(file, 2, id.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(file, 3, original.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(file, 4, saved.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int64(file, 5, item.value("size", 0LL));
        sqlite3_bind_text(file, 6, outcome.c_str(), -1, SQLITE_TRANSIENT);
        const std::string matched = item.value("matchedName", "");
        const std::string duplicateStage = item.value("duplicateStage", "");
        sqlite3_bind_text(file, 7, matched.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(file, 8, duplicateStage.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int64(file, 9, item.value("avoidedBytes", 0LL));
        sqlite3_step(file);
        sqlite3_reset(file);
        sqlite3_clear_bindings(file);
    }
    sqlite3_finalize(file);

    execHistorySql(
        m_db,
        "DELETE FROM sessions WHERE session_id IN ("
        " SELECT session_id FROM sessions ORDER BY completed_at DESC"
        " LIMIT -1 OFFSET 200"
        ");");
    execHistorySql(m_db, "COMMIT;");
}

std::string TransferHistoryStore::recentSessionsJson(int limit) const {
    std::lock_guard<std::mutex> lock(m_mutex);
    json rows = json::array();
    if (!m_db) {
        return rows.dump();
    }
    sqlite3_stmt* statement = nullptr;
    sqlite3_prepare_v2(
        m_db,
        "SELECT session_id,completed_at,client_ip,selected_files,"
        "uploaded_files,skipped_files,failed_files,selected_bytes,"
        "selected_media_bytes,additional_components_bytes,"
        "selected_media_files,additional_components_files,"
        "uploaded_bytes,skipped_bytes,avoided_bytes,finalization_duplicate_bytes,"
        "check_duration_ms,upload_duration_ms,"
        "total_duration_ms,average_speed_mbps,peak_speed_mbps,retries,"
        "selected_assets,expanded_files "
        "FROM sessions ORDER BY completed_at DESC LIMIT ?;",
        -1,
        &statement,
        nullptr);
    sqlite3_bind_int(statement, 1, std::max(1, std::min(limit, 200)));
    while (sqlite3_step(statement) == SQLITE_ROW) {
        const std::string sessionId = reinterpret_cast<const char*>(
            sqlite3_column_text(statement, 0));
        json files = json::array();
        sqlite3_stmt* fileStatement = nullptr;
        sqlite3_prepare_v2(
            m_db,
            "SELECT file_id,original_name,saved_name,size_bytes,outcome,"
            "matched_name,duplicate_stage,avoided_bytes FROM session_files "
            "WHERE session_id=? ORDER BY rowid;",
            -1,
            &fileStatement,
            nullptr);
        sqlite3_bind_text(
            fileStatement, 1, sessionId.c_str(), -1, SQLITE_TRANSIENT);
        while (sqlite3_step(fileStatement) == SQLITE_ROW) {
            files.push_back({
                {"id", reinterpret_cast<const char*>(sqlite3_column_text(fileStatement, 0))},
                {"name", reinterpret_cast<const char*>(sqlite3_column_text(fileStatement, 1))},
                {"savedName", reinterpret_cast<const char*>(sqlite3_column_text(fileStatement, 2))},
                {"size", sqlite3_column_int64(fileStatement, 3)},
                {"outcome", reinterpret_cast<const char*>(sqlite3_column_text(fileStatement, 4))},
                {"matchedName", reinterpret_cast<const char*>(sqlite3_column_text(fileStatement, 5))},
                {"duplicateStage", reinterpret_cast<const char*>(sqlite3_column_text(fileStatement, 6))},
                {"avoidedBytes", sqlite3_column_int64(fileStatement, 7)}
            });
        }
        sqlite3_finalize(fileStatement);
        rows.push_back({
            {"sessionId", sessionId},
            {"completedAt", sqlite3_column_int64(statement, 1)},
            {"clientIp", reinterpret_cast<const char*>(sqlite3_column_text(statement, 2))},
            {"selectedFiles", sqlite3_column_int(statement, 3)},
            {"uploadedFiles", sqlite3_column_int(statement, 4)},
            {"skippedFiles", sqlite3_column_int(statement, 5)},
            {"failedFiles", sqlite3_column_int(statement, 6)},
            {"selectedBytes", sqlite3_column_int64(statement, 7)},
            {"selectedMediaBytes", sqlite3_column_int64(statement, 8)},
            {"additionalComponentsBytes", sqlite3_column_int64(statement, 9)},
            {"selectedMediaFiles", sqlite3_column_int(statement, 10)},
            {"additionalComponentsFiles", sqlite3_column_int(statement, 11)},
            {"uploadedBytes", sqlite3_column_int64(statement, 12)},
            {"skippedBytes", sqlite3_column_int64(statement, 13)},
            {"avoidedBytes", sqlite3_column_int64(statement, 14)},
            {"finalizationDuplicateBytes", sqlite3_column_int64(statement, 15)},
            {"checkDurationMs", sqlite3_column_int64(statement, 16)},
            {"uploadDurationMs", sqlite3_column_int64(statement, 17)},
            {"totalDurationMs", sqlite3_column_int64(statement, 18)},
            {"averageSpeedMBps", sqlite3_column_double(statement, 19)},
            {"peakSpeedMBps", sqlite3_column_double(statement, 20)},
            {"retries", sqlite3_column_int(statement, 21)},
            {"selectedAssets", sqlite3_column_int(statement, 22)},
            {"expandedFiles", sqlite3_column_int(statement, 23)},
            {"files", files}
        });
    }
    sqlite3_finalize(statement);
    return rows.dump();
}

void TransferHistoryStore::clear() {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (m_db) {
        execHistorySql(m_db, "DELETE FROM session_files; DELETE FROM sessions;");
    }
}
