#include "history/TransferHistoryStore.hpp"
#include "common/SqliteChecked.hpp"
#include "common/TransferLimits.hpp"

#include <nlohmann/json.hpp>
#include <sqlite3.h>

#include <filesystem>
#include <algorithm>

using json = nlohmann::json;

namespace {
bool historyColumnExists(
    sqlite3* db,
    const char* table,
    const char* column) {
    const std::string query = std::string("PRAGMA table_info(") + table + ");";
    lmt::sqlite::Statement statement(db, query.c_str());
    bool found = false;
    while (statement.step() == SQLITE_ROW) {
        const char* name = reinterpret_cast<const char*>(
            sqlite3_column_text(statement.get(), 1));
        if (name && std::string(name) == column) {
            found = true;
        }
    }
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
        sqlite3_close(m_db);
        m_db = nullptr;
        throw std::runtime_error("Unable to open transfer history database");
    }
    try {
    lmt::sqlite::check(sqlite3_busy_timeout(m_db, 5000), "set history busy timeout");
    lmt::sqlite::execute(m_db, "PRAGMA journal_mode=WAL;", "configure history journal");
    lmt::sqlite::execute(m_db, "PRAGMA synchronous=NORMAL;", "configure history sync");
    lmt::sqlite::execute(m_db, "PRAGMA foreign_keys=ON;", "configure history foreign keys");
    lmt::sqlite::Transaction migration(m_db);
    lmt::sqlite::execute(
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
            " expanded_files INTEGER NOT NULL DEFAULT 0,"
            " completion_status TEXT NOT NULL DEFAULT 'completed'"
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
            "PRAGMA user_version=5;", "initialize transfer history schema");
    if (!historyColumnExists(m_db, "sessions", "selected_assets")) {
        lmt::sqlite::execute(m_db,
            "ALTER TABLE sessions ADD COLUMN selected_assets INTEGER NOT NULL DEFAULT 0;", "migrate history");
    }
    if (!historyColumnExists(m_db, "sessions", "expanded_files")) {
        lmt::sqlite::execute(m_db,
            "ALTER TABLE sessions ADD COLUMN expanded_files INTEGER NOT NULL DEFAULT 0;", "migrate history");
    }
    if (!historyColumnExists(m_db, "sessions", "avoided_bytes")) {
        lmt::sqlite::execute(m_db,
            "ALTER TABLE sessions ADD COLUMN avoided_bytes INTEGER NOT NULL DEFAULT 0;", "migrate history");
    }
    if (!historyColumnExists(m_db, "sessions", "finalization_duplicate_bytes")) {
        lmt::sqlite::execute(m_db,
            "ALTER TABLE sessions ADD COLUMN finalization_duplicate_bytes INTEGER NOT NULL DEFAULT 0;", "migrate history");
    }
    if (!historyColumnExists(m_db, "sessions", "selected_media_bytes")) {
        lmt::sqlite::execute(m_db,
            "ALTER TABLE sessions ADD COLUMN selected_media_bytes INTEGER NOT NULL DEFAULT 0;", "migrate history");
    }
    if (!historyColumnExists(m_db, "sessions", "additional_components_bytes")) {
        lmt::sqlite::execute(m_db,
            "ALTER TABLE sessions ADD COLUMN additional_components_bytes INTEGER NOT NULL DEFAULT 0;", "migrate history");
    }
    if (!historyColumnExists(m_db, "sessions", "selected_media_files")) {
        lmt::sqlite::execute(m_db,
            "ALTER TABLE sessions ADD COLUMN selected_media_files INTEGER NOT NULL DEFAULT 0;", "migrate history");
    }
    if (!historyColumnExists(m_db, "sessions", "additional_components_files")) {
        lmt::sqlite::execute(m_db,
            "ALTER TABLE sessions ADD COLUMN additional_components_files INTEGER NOT NULL DEFAULT 0;", "migrate history");
    }
    if (!historyColumnExists(m_db, "sessions", "completion_status")) {
        lmt::sqlite::execute(m_db,
            "ALTER TABLE sessions ADD COLUMN completion_status TEXT NOT NULL DEFAULT 'completed';", "migrate history");
    }
    if (!historyColumnExists(m_db, "session_files", "matched_name")) {
        lmt::sqlite::execute(m_db,
            "ALTER TABLE session_files ADD COLUMN matched_name TEXT NOT NULL DEFAULT '';", "migrate history");
    }
    if (!historyColumnExists(m_db, "session_files", "duplicate_stage")) {
        lmt::sqlite::execute(m_db,
            "ALTER TABLE session_files ADD COLUMN duplicate_stage TEXT NOT NULL DEFAULT '';", "migrate history");
    }
    if (!historyColumnExists(m_db, "session_files", "avoided_bytes")) {
        lmt::sqlite::execute(m_db,
            "ALTER TABLE session_files ADD COLUMN avoided_bytes INTEGER NOT NULL DEFAULT 0;", "migrate history");
    }
    lmt::sqlite::execute(m_db, "PRAGMA user_version=5;", "set history version");
    migration.commit();
    } catch (...) {
        sqlite3_close(m_db);
        m_db = nullptr;
        throw;
    }
}

void TransferHistoryStore::recordSession(
    const std::string& payloadJson,
    const std::string& clientIp) {
    const json payload = json::parse(payloadJson);
    const std::string sessionId = payload.value("sessionId", "");
    if (sessionId.empty()) {
        throw std::invalid_argument("sessionId is required");
    }
    const json files = payload.value("files", json::array());
    if (!files.is_array() || files.size() > lmt::TransferLimits::MaxQueuedFiles) {
        throw std::invalid_argument("Invalid transfer history files");
    }

    std::lock_guard<std::mutex> lock(m_mutex);
    if (!m_db) {
        throw std::runtime_error("Transfer history is unavailable");
    }
    lmt::sqlite::Transaction transaction(m_db);
    lmt::sqlite::Statement sessionStatement(m_db,
        "INSERT OR REPLACE INTO sessions("
        "session_id,completed_at,client_ip,selected_files,uploaded_files,"
        "skipped_files,failed_files,selected_bytes,uploaded_bytes,skipped_bytes,"
        "selected_media_bytes,additional_components_bytes,"
        "selected_media_files,additional_components_files,"
        "avoided_bytes,finalization_duplicate_bytes,"
        "check_duration_ms,upload_duration_ms,total_duration_ms,"
        "average_speed_mbps,peak_speed_mbps,retries,selected_assets,expanded_files,"
        "completion_status)"
        " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?);");
    int column = 1;
    sessionStatement.text(column++, sessionId);
    sessionStatement.integer64(column++, payload.value("completedAt", static_cast<int64_t>(0)));
    sessionStatement.text(column++, clientIp);
    sessionStatement.integer(column++, payload.value("selectedFiles", 0));
    sessionStatement.integer(column++, payload.value("uploadedFiles", 0));
    sessionStatement.integer(column++, payload.value("skippedFiles", 0));
    sessionStatement.integer(column++, payload.value("failedFiles", 0));
    const int64_t selectedBytes = payload.value("selectedBytes", 0LL);
    sessionStatement.integer64(column++, selectedBytes);
    sessionStatement.integer64(column++, payload.value("uploadedBytes", 0LL));
    sessionStatement.integer64(column++, payload.value("skippedBytes", 0LL));
    sessionStatement.integer64(column++, payload.value("selectedMediaBytes", selectedBytes));
    sessionStatement.integer64(column++, payload.value("additionalComponentsBytes", 0LL));
    sessionStatement.integer(column++, payload.value("selectedMediaFiles", payload.value("selectedFiles", 0)));
    sessionStatement.integer(column++, payload.value("additionalComponentsFiles", 0));
    sessionStatement.integer64(column++, payload.value("avoidedBytes", 0LL));
    sessionStatement.integer64(column++, payload.value("finalizationDuplicateBytes", 0LL));
    sessionStatement.integer64(column++, payload.value("checkDurationMs", 0LL));
    sessionStatement.integer64(column++, payload.value("uploadDurationMs", 0LL));
    sessionStatement.integer64(column++, payload.value("totalDurationMs", 0LL));
    sessionStatement.real(column++, payload.value("averageSpeedMBps", 0.0));
    sessionStatement.real(column++, payload.value("peakSpeedMBps", 0.0));
    sessionStatement.integer(column++, payload.value("retries", 0));
    sessionStatement.integer(column++, payload.value("selectedAssets", 0));
    sessionStatement.integer(column++, payload.value(
        "expandedFiles", payload.value("selectedFiles", 0)));
    const std::string completionStatus = payload.value("completionStatus", "completed");
    sessionStatement.text(column++, completionStatus);
    sessionStatement.done();

    lmt::sqlite::Statement fileStatement(m_db,
        "INSERT OR REPLACE INTO session_files("
        "session_id,file_id,original_name,saved_name,size_bytes,outcome,"
        "matched_name,duplicate_stage,avoided_bytes) VALUES(?,?,?,?,?,?,?,?,?);");
    for (const auto& item : files) {
        fileStatement.text(1, sessionId);
        const std::string id = item.value("id", "");
        const std::string original = item.value("name", "");
        const std::string saved = item.value("savedName", original);
        const std::string outcome = item.value("outcome", "failed");
        fileStatement.text(2, id);
        fileStatement.text(3, original);
        fileStatement.text(4, saved);
        fileStatement.integer64(5, item.value("size", 0LL));
        fileStatement.text(6, outcome);
        const std::string matched = item.value("matchedName", "");
        const std::string duplicateStage = item.value("duplicateStage", "");
        fileStatement.text(7, matched);
        fileStatement.text(8, duplicateStage);
        fileStatement.integer64(9, item.value("avoidedBytes", 0LL));
        fileStatement.done();
        fileStatement.reset();
    }

    lmt::sqlite::execute(
        m_db,
        "DELETE FROM sessions WHERE session_id IN ("
        " SELECT session_id FROM sessions ORDER BY completed_at DESC"
        " LIMIT -1 OFFSET 200"
        ");", "trim transfer history");
    transaction.commit();
}

std::string TransferHistoryStore::recentSessionsJson(int limit) const {
    std::lock_guard<std::mutex> lock(m_mutex);
    json rows = json::array();
    if (!m_db) {
        throw std::runtime_error("Transfer history is unavailable");
    }
    lmt::sqlite::Statement sessions(m_db,
        "SELECT session_id,completed_at,client_ip,selected_files,"
        "uploaded_files,skipped_files,failed_files,selected_bytes,"
        "selected_media_bytes,additional_components_bytes,"
        "selected_media_files,additional_components_files,"
        "uploaded_bytes,skipped_bytes,avoided_bytes,finalization_duplicate_bytes,"
        "check_duration_ms,upload_duration_ms,"
        "total_duration_ms,average_speed_mbps,peak_speed_mbps,retries,"
        "selected_assets,expanded_files,completion_status "
        "FROM sessions ORDER BY completed_at DESC LIMIT ?;");
    sqlite3_stmt* statement = sessions.get();
    sessions.integer(1, std::max(1, std::min(limit, 200)));
    while (sessions.step() == SQLITE_ROW) {
        const std::string sessionId = reinterpret_cast<const char*>(
            sqlite3_column_text(statement, 0));
        json files = json::array();
        lmt::sqlite::Statement filesStatement(m_db,
            "SELECT file_id,original_name,saved_name,size_bytes,outcome,"
            "matched_name,duplicate_stage,avoided_bytes FROM session_files "
            "WHERE session_id=? ORDER BY rowid;");
        sqlite3_stmt* fileStatement = filesStatement.get();
        filesStatement.text(1, sessionId);
        while (filesStatement.step() == SQLITE_ROW) {
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
            {"completionStatus", reinterpret_cast<const char*>(sqlite3_column_text(statement, 24))},
            {"files", files}
        });
    }
    return rows.dump();
}

void TransferHistoryStore::clear() {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (!m_db) throw std::runtime_error("Transfer history is unavailable");
    lmt::sqlite::Transaction transaction(m_db);
    lmt::sqlite::execute(m_db, "DELETE FROM session_files;", "clear transfer history files");
    lmt::sqlite::execute(m_db, "DELETE FROM sessions;", "clear transfer history sessions");
    transaction.commit();
}
