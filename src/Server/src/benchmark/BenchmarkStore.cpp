#include "benchmark/BenchmarkStore.hpp"
#include "common/Version.hpp"

#include <chrono>
#include <filesystem>
#include <iomanip>
#include <random>
#include <sstream>
#include <stdexcept>

#include <sqlite3.h>
#include <spdlog/spdlog.h>

using json = nlohmann::json;

namespace {
class Statement {
public:
    Statement(sqlite3* db, const char* sql) {
        if (sqlite3_prepare_v2(db, sql, -1, &m_statement, nullptr) != SQLITE_OK) {
            throw std::runtime_error(sqlite3_errmsg(db));
        }
    }

    ~Statement() {
        sqlite3_finalize(m_statement);
    }

    sqlite3_stmt* get() const { return m_statement; }

private:
    sqlite3_stmt* m_statement = nullptr;
};

std::string textValue(const json& value, const char* key, const std::string& fallback = "") {
    if (!value.contains(key) || value[key].is_null()) {
        return fallback;
    }
    if (value[key].is_string()) {
        return value[key].get<std::string>();
    }
    return value[key].dump();
}

int64_t integerValue(const json& value, const char* key, int64_t fallback = 0) {
    if (!value.contains(key) || !value[key].is_number()) {
        return fallback;
    }
    return value[key].get<int64_t>();
}

double doubleValue(const json& value, const char* key, double fallback = 0.0) {
    if (!value.contains(key) || !value[key].is_number()) {
        return fallback;
    }
    return value[key].get<double>();
}

void bindText(sqlite3_stmt* statement, int index, const std::string& value) {
    sqlite3_bind_text(statement, index, value.c_str(), -1, SQLITE_TRANSIENT);
}

void requireDone(sqlite3* db, sqlite3_stmt* statement) {
    if (sqlite3_step(statement) != SQLITE_DONE) {
        throw std::runtime_error(sqlite3_errmsg(db));
    }
}

void resetStatement(sqlite3_stmt* statement) {
    sqlite3_reset(statement);
    sqlite3_clear_bindings(statement);
}
}

BenchmarkStore::~BenchmarkStore() {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (m_db) {
        try {
            flushSamplesLocked();
        } catch (...) {
        }
        finalizeStatements();
        sqlite3_close(m_db);
        m_db = nullptr;
    }
}

void BenchmarkStore::open(const std::string& databasePath) {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (m_db) {
        throw std::runtime_error("Benchmark database is already open");
    }

    auto parent = std::filesystem::path(databasePath).parent_path();
    if (!parent.empty()) {
        std::filesystem::create_directories(parent);
    }

    if (sqlite3_open(databasePath.c_str(), &m_db) != SQLITE_OK) {
        std::string error = m_db ? sqlite3_errmsg(m_db) : "unknown SQLite error";
        if (m_db) {
            sqlite3_close(m_db);
            m_db = nullptr;
        }
        throw std::runtime_error("Unable to open benchmark database: " + error);
    }

    execute("PRAGMA journal_mode=WAL;");
    execute("PRAGMA synchronous=NORMAL;");
    execute("PRAGMA foreign_keys=ON;");
    execute("PRAGMA busy_timeout=5000;");
    createSchema();
    try {
        prepareStatements();
    } catch (...) {
        finalizeStatements();
        sqlite3_close(m_db);
        m_db = nullptr;
        throw;
    }
    spdlog::info("Benchmark database opened: {}", databasePath);
}

bool BenchmarkStore::isOpen() const {
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_db != nullptr;
}

void BenchmarkStore::execute(const char* sql) {
    char* error = nullptr;
    if (sqlite3_exec(m_db, sql, nullptr, nullptr, &error) != SQLITE_OK) {
        std::string message = error ? error : "SQLite execution failed";
        sqlite3_free(error);
        throw std::runtime_error(message);
    }
}

void BenchmarkStore::createSchema() {
    execute(
        "CREATE TABLE IF NOT EXISTS benchmark_schema ("
        " version INTEGER NOT NULL"
        ");"
        "INSERT INTO benchmark_schema(version)"
        " SELECT 2 WHERE NOT EXISTS (SELECT 1 FROM benchmark_schema);");

    int schemaVersion = 0;
    {
        Statement versionStatement(
            m_db,
            "SELECT version FROM benchmark_schema LIMIT 1;");
        if (sqlite3_step(versionStatement.get()) == SQLITE_ROW) {
            schemaVersion = sqlite3_column_int(versionStatement.get(), 0);
        }
    }

    if (schemaVersion == 1) {
        execute(
            "BEGIN IMMEDIATE TRANSACTION;"
            "ALTER TABLE benchmark_runs RENAME COLUMN average_mbps TO average_mb_per_s;"
            "ALTER TABLE benchmark_runs RENAME COLUMN peak_mbps TO peak_mb_per_s;"
            "ALTER TABLE benchmark_runs RENAME COLUMN p50_mbps TO p50_mb_per_s;"
            "ALTER TABLE benchmark_runs RENAME COLUMN p95_mbps TO p95_mb_per_s;"
            "ALTER TABLE benchmark_runs RENAME COLUMN p99_mbps TO p99_mb_per_s;"
            "ALTER TABLE benchmark_samples RENAME COLUMN throughput_mbps TO throughput_mb_per_s;"
            "ALTER TABLE benchmark_files RENAME COLUMN throughput_mbps TO throughput_mb_per_s;"
            "UPDATE benchmark_schema SET version=2;"
            "COMMIT;");
        schemaVersion = 2;
    }

    if (schemaVersion != 2) {
        throw std::runtime_error(
            "Unsupported benchmark database schema version: " +
            std::to_string(schemaVersion));
    }

    execute(
        "CREATE TABLE IF NOT EXISTS benchmark_machines ("
        " id INTEGER PRIMARY KEY AUTOINCREMENT,"
        " fingerprint TEXT NOT NULL UNIQUE,"
        " os_name TEXT NOT NULL DEFAULT '',"
        " os_version TEXT NOT NULL DEFAULT '',"
        " cpu_name TEXT NOT NULL DEFAULT '',"
        " physical_cores INTEGER NOT NULL DEFAULT 0,"
        " logical_cores INTEGER NOT NULL DEFAULT 0,"
        " ram_bytes INTEGER NOT NULL DEFAULT 0,"
        " nic_name TEXT NOT NULL DEFAULT '',"
        " nic_link_mbps REAL NOT NULL DEFAULT 0,"
        " storage_model TEXT NOT NULL DEFAULT '',"
        " storage_type TEXT NOT NULL DEFAULT '',"
        " created_at_ms INTEGER NOT NULL"
        ");"
        "CREATE TABLE IF NOT EXISTS benchmark_runs ("
        " id TEXT PRIMARY KEY,"
        " machine_id INTEGER,"
        " started_at_ms INTEGER NOT NULL,"
        " finished_at_ms INTEGER,"
        " git_commit TEXT NOT NULL DEFAULT '',"
        " server_version TEXT NOT NULL DEFAULT '',"
        " client_version TEXT NOT NULL DEFAULT '',"
        " build_configuration TEXT NOT NULL DEFAULT '',"
        " profile TEXT NOT NULL DEFAULT '',"
        " transport TEXT NOT NULL DEFAULT '',"
        " chunk_size_bytes INTEGER NOT NULL DEFAULT 0,"
        " file_concurrency INTEGER NOT NULL DEFAULT 0,"
        " network_baseline_mbps REAL NOT NULL DEFAULT 0,"
        " total_bytes INTEGER NOT NULL DEFAULT 0,"
        " total_files INTEGER NOT NULL DEFAULT 0,"
        " duration_ms INTEGER NOT NULL DEFAULT 0,"
        " average_mb_per_s REAL NOT NULL DEFAULT 0,"
        " peak_mb_per_s REAL NOT NULL DEFAULT 0,"
        " p50_mb_per_s REAL NOT NULL DEFAULT 0,"
        " p95_mb_per_s REAL NOT NULL DEFAULT 0,"
        " p99_mb_per_s REAL NOT NULL DEFAULT 0,"
        " retries INTEGER NOT NULL DEFAULT 0,"
        " errors INTEGER NOT NULL DEFAULT 0,"
        " integrity_ok INTEGER NOT NULL DEFAULT 0,"
        " notes TEXT NOT NULL DEFAULT '',"
        " status TEXT NOT NULL DEFAULT 'running',"
        " FOREIGN KEY(machine_id) REFERENCES benchmark_machines(id)"
        ");"
        "CREATE TABLE IF NOT EXISTS benchmark_samples ("
        " id INTEGER PRIMARY KEY AUTOINCREMENT,"
        " run_id TEXT NOT NULL,"
        " elapsed_ms INTEGER NOT NULL,"
        " throughput_mb_per_s REAL NOT NULL DEFAULT 0,"
        " cpu_percent REAL NOT NULL DEFAULT 0,"
        " working_set_bytes INTEGER NOT NULL DEFAULT 0,"
        " process_io_read_bytes INTEGER NOT NULL DEFAULT 0,"
        " process_io_write_bytes INTEGER NOT NULL DEFAULT 0,"
        " network_bytes INTEGER NOT NULL DEFAULT 0,"
        " transferred_bytes INTEGER NOT NULL DEFAULT 0,"
        " FOREIGN KEY(run_id) REFERENCES benchmark_runs(id) ON DELETE CASCADE"
        ");"
        "CREATE INDEX IF NOT EXISTS idx_benchmark_samples_run"
        " ON benchmark_samples(run_id, elapsed_ms);"
        "CREATE TABLE IF NOT EXISTS benchmark_files ("
        " run_id TEXT NOT NULL,"
        " file_id TEXT NOT NULL,"
        " source_name TEXT NOT NULL DEFAULT '',"
        " saved_name TEXT NOT NULL DEFAULT '',"
        " size_bytes INTEGER NOT NULL DEFAULT 0,"
        " upload_mode TEXT NOT NULL DEFAULT '',"
        " duration_ms INTEGER NOT NULL DEFAULT 0,"
        " throughput_mb_per_s REAL NOT NULL DEFAULT 0,"
        " retries INTEGER NOT NULL DEFAULT 0,"
        " http_status INTEGER NOT NULL DEFAULT 0,"
        " expected_sha256 TEXT NOT NULL DEFAULT '',"
        " actual_sha256 TEXT NOT NULL DEFAULT '',"
        " integrity_ok INTEGER NOT NULL DEFAULT 0,"
        " error TEXT NOT NULL DEFAULT '',"
        " PRIMARY KEY(run_id, file_id),"
        " FOREIGN KEY(run_id) REFERENCES benchmark_runs(id) ON DELETE CASCADE"
        ");");
}

void BenchmarkStore::prepareStatements() {
    const char* sampleSql =
        "INSERT INTO benchmark_samples("
        " run_id,elapsed_ms,throughput_mb_per_s,cpu_percent,working_set_bytes,"
        " process_io_read_bytes,process_io_write_bytes,network_bytes,transferred_bytes"
        ") VALUES(?,?,?,?,?,?,?,?,?);";
    if (sqlite3_prepare_v2(m_db, sampleSql, -1, &m_sampleInsertStatement, nullptr) != SQLITE_OK) {
        throw std::runtime_error(sqlite3_errmsg(m_db));
    }

    const char* fileSql =
        "INSERT INTO benchmark_files("
        " run_id,file_id,source_name,saved_name,size_bytes,upload_mode,duration_ms,"
        " throughput_mb_per_s,retries,http_status,expected_sha256,actual_sha256,"
        " integrity_ok,error"
        ") VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
        " ON CONFLICT(run_id,file_id) DO UPDATE SET"
        " source_name=excluded.source_name,saved_name=excluded.saved_name,"
        " size_bytes=excluded.size_bytes,upload_mode=excluded.upload_mode,"
        " duration_ms=excluded.duration_ms,"
        " throughput_mb_per_s=excluded.throughput_mb_per_s,"
        " retries=excluded.retries,http_status=excluded.http_status,"
        " expected_sha256=excluded.expected_sha256,actual_sha256=excluded.actual_sha256,"
        " integrity_ok=excluded.integrity_ok,error=excluded.error;";
    if (sqlite3_prepare_v2(m_db, fileSql, -1, &m_fileUpsertStatement, nullptr) != SQLITE_OK) {
        throw std::runtime_error(sqlite3_errmsg(m_db));
    }
}

void BenchmarkStore::finalizeStatements() {
    if (m_sampleInsertStatement) {
        sqlite3_finalize(m_sampleInsertStatement);
        m_sampleInsertStatement = nullptr;
    }
    if (m_fileUpsertStatement) {
        sqlite3_finalize(m_fileUpsertStatement);
        m_fileUpsertStatement = nullptr;
    }
}

std::optional<std::string> BenchmarkStore::startRun(const json& payload) {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (!m_db || !m_activeRunId.empty()) {
        return std::nullopt;
    }

    const json machine = payload.value("machine", json::object());
    const int64_t machineId = upsertMachineLocked(machine);
    const std::string runId = generateId();

    Statement statement(
        m_db,
        "INSERT INTO benchmark_runs("
        " id,machine_id,started_at_ms,git_commit,server_version,client_version,"
        " build_configuration,profile,transport,chunk_size_bytes,file_concurrency,"
        " network_baseline_mbps,notes,status"
        ") VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'running');");
    auto* s = statement.get();
    bindText(s, 1, runId);
    if (machineId > 0) sqlite3_bind_int64(s, 2, machineId); else sqlite3_bind_null(s, 2);
    sqlite3_bind_int64(s, 3, unixTimeMilliseconds());
    bindText(s, 4, textValue(payload, "gitCommit"));
    bindText(s, 5, textValue(payload, "serverVersion", lmt::Version));
    bindText(s, 6, textValue(payload, "clientVersion"));
    bindText(s, 7, textValue(payload, "buildConfiguration"));
    bindText(s, 8, textValue(payload, "profile"));
    bindText(s, 9, textValue(payload, "transport"));
    sqlite3_bind_int64(s, 10, integerValue(payload, "chunkSizeBytes"));
    sqlite3_bind_int64(s, 11, integerValue(payload, "fileConcurrency"));
    sqlite3_bind_double(s, 12, doubleValue(payload, "networkBaselineMbps"));
    bindText(s, 13, textValue(payload, "notes"));
    requireDone(m_db, s);

    m_activeRunId = runId;
    return runId;
}

bool BenchmarkStore::addSample(const std::string& runId, const json& payload) {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (!m_db || m_activeRunId != runId) {
        return false;
    }

    m_pendingSamples.push_back({
        runId,
        integerValue(payload, "elapsedMs"),
        doubleValue(payload, "throughputMBps"),
        doubleValue(payload, "cpuPercent"),
        integerValue(payload, "workingSetBytes"),
        integerValue(payload, "processIoReadBytes"),
        integerValue(payload, "processIoWriteBytes"),
        integerValue(payload, "networkBytes"),
        integerValue(payload, "transferredBytes")
    });

    if (m_pendingSamples.size() >= 10) {
        flushSamplesLocked();
    }
    return true;
}

bool BenchmarkStore::addFileResult(
    const std::string& runId,
    const std::string& fileId,
    const json& payload) {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (!m_db || m_activeRunId != runId) {
        return false;
    }

    auto* s = m_fileUpsertStatement;
    resetStatement(s);
    bindText(s, 1, runId);
    bindText(s, 2, fileId);
    bindText(s, 3, textValue(payload, "sourceName"));
    bindText(s, 4, textValue(payload, "savedName"));
    sqlite3_bind_int64(s, 5, integerValue(payload, "sizeBytes"));
    bindText(s, 6, textValue(payload, "uploadMode"));
    sqlite3_bind_int64(s, 7, integerValue(payload, "durationMs"));
    sqlite3_bind_double(s, 8, doubleValue(payload, "throughputMBps"));
    sqlite3_bind_int64(s, 9, integerValue(payload, "retries"));
    sqlite3_bind_int64(s, 10, integerValue(payload, "httpStatus"));
    bindText(s, 11, textValue(payload, "expectedSha256"));
    bindText(s, 12, textValue(payload, "actualSha256"));
    sqlite3_bind_int(s, 13, payload.value("integrityOk", false) ? 1 : 0);
    bindText(s, 14, textValue(payload, "error"));
    requireDone(m_db, s);
    resetStatement(s);
    return true;
}

bool BenchmarkStore::finishRun(const std::string& runId, const json& payload) {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (!m_db || m_activeRunId != runId) {
        return false;
    }

    flushSamplesLocked();
    Statement statement(
        m_db,
        "UPDATE benchmark_runs SET"
        " finished_at_ms=?,total_bytes=?,total_files=?,duration_ms=?,average_mb_per_s=?,"
        " peak_mb_per_s=?,p50_mb_per_s=?,p95_mb_per_s=?,p99_mb_per_s=?,retries=?,errors=?,"
        " integrity_ok=?,notes=CASE WHEN ?='' THEN notes ELSE ? END,status=?"
        " WHERE id=?;");
    auto* s = statement.get();
    sqlite3_bind_int64(s, 1, unixTimeMilliseconds());
    sqlite3_bind_int64(s, 2, integerValue(payload, "totalBytes"));
    sqlite3_bind_int64(s, 3, integerValue(payload, "totalFiles"));
    sqlite3_bind_int64(s, 4, integerValue(payload, "durationMs"));
    sqlite3_bind_double(s, 5, doubleValue(payload, "averageMBps"));
    sqlite3_bind_double(s, 6, doubleValue(payload, "peakMBps"));
    sqlite3_bind_double(s, 7, doubleValue(payload, "p50MBps"));
    sqlite3_bind_double(s, 8, doubleValue(payload, "p95MBps"));
    sqlite3_bind_double(s, 9, doubleValue(payload, "p99MBps"));
    sqlite3_bind_int64(s, 10, integerValue(payload, "retries"));
    sqlite3_bind_int64(s, 11, integerValue(payload, "errors"));
    sqlite3_bind_int(s, 12, payload.value("integrityOk", false) ? 1 : 0);
    const std::string notes = textValue(payload, "notes");
    bindText(s, 13, notes);
    bindText(s, 14, notes);
    bindText(s, 15, textValue(payload, "status", "completed"));
    bindText(s, 16, runId);
    requireDone(m_db, s);

    m_activeRunId.clear();
    return true;
}

std::optional<json> BenchmarkStore::getRun(const std::string& runId) {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (!m_db) {
        return std::nullopt;
    }
    flushSamplesLocked();

    Statement runStatement(
        m_db,
        "SELECT r.started_at_ms,r.finished_at_ms,r.git_commit,r.server_version,"
        " r.client_version,r.build_configuration,r.profile,r.transport,"
        " r.chunk_size_bytes,r.file_concurrency,r.network_baseline_mbps,"
        " r.total_bytes,r.total_files,r.duration_ms,r.average_mb_per_s,"
        " r.peak_mb_per_s,r.p50_mb_per_s,r.p95_mb_per_s,r.p99_mb_per_s,"
        " r.retries,r.errors,r.integrity_ok,r.notes,r.status,"
        " m.fingerprint,m.os_name,m.os_version,m.cpu_name,m.physical_cores,"
        " m.logical_cores,m.ram_bytes,m.nic_name,m.nic_link_mbps,"
        " m.storage_model,m.storage_type"
        " FROM benchmark_runs r"
        " LEFT JOIN benchmark_machines m ON m.id=r.machine_id"
        " WHERE r.id=?;");
    bindText(runStatement.get(), 1, runId);
    if (sqlite3_step(runStatement.get()) != SQLITE_ROW) {
        return std::nullopt;
    }

    auto textColumn = [](sqlite3_stmt* statement, int column) {
        const auto* text = sqlite3_column_text(statement, column);
        return text ? reinterpret_cast<const char*>(text) : "";
    };
    sqlite3_stmt* r = runStatement.get();
    json result = {
        {"id", runId},
        {"startedAtMs", sqlite3_column_int64(r, 0)},
        {"finishedAtMs", sqlite3_column_type(r, 1) == SQLITE_NULL ? 0 : sqlite3_column_int64(r, 1)},
        {"gitCommit", textColumn(r, 2)},
        {"serverVersion", textColumn(r, 3)},
        {"clientVersion", textColumn(r, 4)},
        {"buildConfiguration", textColumn(r, 5)},
        {"profile", textColumn(r, 6)},
        {"transport", textColumn(r, 7)},
        {"chunkSizeBytes", sqlite3_column_int64(r, 8)},
        {"fileConcurrency", sqlite3_column_int64(r, 9)},
        {"networkBaselineMbps", sqlite3_column_double(r, 10)},
        {"totalBytes", sqlite3_column_int64(r, 11)},
        {"totalFiles", sqlite3_column_int64(r, 12)},
        {"durationMs", sqlite3_column_int64(r, 13)},
        {"averageMBps", sqlite3_column_double(r, 14)},
        {"peakMBps", sqlite3_column_double(r, 15)},
        {"p50MBps", sqlite3_column_double(r, 16)},
        {"p95MBps", sqlite3_column_double(r, 17)},
        {"p99MBps", sqlite3_column_double(r, 18)},
        {"retries", sqlite3_column_int64(r, 19)},
        {"errors", sqlite3_column_int64(r, 20)},
        {"integrityOk", sqlite3_column_int(r, 21) != 0},
        {"notes", textColumn(r, 22)},
        {"status", textColumn(r, 23)},
        {"machine", {
            {"fingerprint", textColumn(r, 24)},
            {"osName", textColumn(r, 25)},
            {"osVersion", textColumn(r, 26)},
            {"cpuName", textColumn(r, 27)},
            {"physicalCores", sqlite3_column_int64(r, 28)},
            {"logicalCores", sqlite3_column_int64(r, 29)},
            {"ramBytes", sqlite3_column_int64(r, 30)},
            {"nicName", textColumn(r, 31)},
            {"nicLinkMbps", sqlite3_column_double(r, 32)},
            {"storageModel", textColumn(r, 33)},
            {"storageType", textColumn(r, 34)}
        }}
    };

    result["samples"] = json::array();
    Statement sampleStatement(
        m_db,
        "SELECT elapsed_ms,throughput_mb_per_s,cpu_percent,working_set_bytes,"
        " process_io_read_bytes,process_io_write_bytes,network_bytes,transferred_bytes"
        " FROM benchmark_samples WHERE run_id=? ORDER BY elapsed_ms;");
    bindText(sampleStatement.get(), 1, runId);
    while (sqlite3_step(sampleStatement.get()) == SQLITE_ROW) {
        auto* s = sampleStatement.get();
        result["samples"].push_back({
            {"elapsedMs", sqlite3_column_int64(s, 0)},
            {"throughputMBps", sqlite3_column_double(s, 1)},
            {"cpuPercent", sqlite3_column_double(s, 2)},
            {"workingSetBytes", sqlite3_column_int64(s, 3)},
            {"processIoReadBytes", sqlite3_column_int64(s, 4)},
            {"processIoWriteBytes", sqlite3_column_int64(s, 5)},
            {"networkBytes", sqlite3_column_int64(s, 6)},
            {"transferredBytes", sqlite3_column_int64(s, 7)}
        });
    }

    result["files"] = json::array();
    Statement fileStatement(
        m_db,
        "SELECT file_id,source_name,saved_name,size_bytes,upload_mode,duration_ms,"
        " throughput_mb_per_s,retries,http_status,expected_sha256,actual_sha256,"
        " integrity_ok,error FROM benchmark_files WHERE run_id=? ORDER BY rowid;");
    bindText(fileStatement.get(), 1, runId);
    while (sqlite3_step(fileStatement.get()) == SQLITE_ROW) {
        auto* f = fileStatement.get();
        result["files"].push_back({
            {"fileId", textColumn(f, 0)},
            {"sourceName", textColumn(f, 1)},
            {"savedName", textColumn(f, 2)},
            {"sizeBytes", sqlite3_column_int64(f, 3)},
            {"uploadMode", textColumn(f, 4)},
            {"durationMs", sqlite3_column_int64(f, 5)},
            {"throughputMBps", sqlite3_column_double(f, 6)},
            {"retries", sqlite3_column_int64(f, 7)},
            {"httpStatus", sqlite3_column_int(f, 8)},
            {"expectedSha256", textColumn(f, 9)},
            {"actualSha256", textColumn(f, 10)},
            {"integrityOk", sqlite3_column_int(f, 11) != 0},
            {"error", textColumn(f, 12)}
        });
    }

    return result;
}

void BenchmarkStore::flushSamplesLocked() {
    if (m_pendingSamples.empty()) {
        return;
    }

    execute("BEGIN IMMEDIATE TRANSACTION;");
    try {
        for (const auto& sample : m_pendingSamples) {
            auto* s = m_sampleInsertStatement;
            resetStatement(s);
            bindText(s, 1, sample.runId);
            sqlite3_bind_int64(s, 2, sample.elapsedMs);
            sqlite3_bind_double(s, 3, sample.throughputMBps);
            sqlite3_bind_double(s, 4, sample.cpuPercent);
            sqlite3_bind_int64(s, 5, sample.workingSetBytes);
            sqlite3_bind_int64(s, 6, sample.processIoReadBytes);
            sqlite3_bind_int64(s, 7, sample.processIoWriteBytes);
            sqlite3_bind_int64(s, 8, sample.networkBytes);
            sqlite3_bind_int64(s, 9, sample.transferredBytes);
            requireDone(m_db, s);
        }
        resetStatement(m_sampleInsertStatement);
        execute("COMMIT;");
        m_pendingSamples.clear();
    } catch (...) {
        execute("ROLLBACK;");
        throw;
    }
}

int64_t BenchmarkStore::upsertMachineLocked(const json& machine) {
    const std::string fingerprint = textValue(machine, "fingerprint");
    if (fingerprint.empty()) {
        return 0;
    }

    Statement insert(
        m_db,
        "INSERT INTO benchmark_machines("
        " fingerprint,os_name,os_version,cpu_name,physical_cores,logical_cores,"
        " ram_bytes,nic_name,nic_link_mbps,storage_model,storage_type,created_at_ms"
        ") VALUES(?,?,?,?,?,?,?,?,?,?,?,?)"
        " ON CONFLICT(fingerprint) DO UPDATE SET"
        " os_name=excluded.os_name,os_version=excluded.os_version,"
        " cpu_name=excluded.cpu_name,physical_cores=excluded.physical_cores,"
        " logical_cores=excluded.logical_cores,ram_bytes=excluded.ram_bytes,"
        " nic_name=excluded.nic_name,nic_link_mbps=excluded.nic_link_mbps,"
        " storage_model=excluded.storage_model,storage_type=excluded.storage_type;");
    auto* s = insert.get();
    bindText(s, 1, fingerprint);
    bindText(s, 2, textValue(machine, "osName"));
    bindText(s, 3, textValue(machine, "osVersion"));
    bindText(s, 4, textValue(machine, "cpuName"));
    sqlite3_bind_int64(s, 5, integerValue(machine, "physicalCores"));
    sqlite3_bind_int64(s, 6, integerValue(machine, "logicalCores"));
    sqlite3_bind_int64(s, 7, integerValue(machine, "ramBytes"));
    bindText(s, 8, textValue(machine, "nicName"));
    sqlite3_bind_double(s, 9, doubleValue(machine, "nicLinkMbps"));
    bindText(s, 10, textValue(machine, "storageModel"));
    bindText(s, 11, textValue(machine, "storageType"));
    sqlite3_bind_int64(s, 12, unixTimeMilliseconds());
    requireDone(m_db, s);

    Statement select(m_db, "SELECT id FROM benchmark_machines WHERE fingerprint=?;");
    bindText(select.get(), 1, fingerprint);
    if (sqlite3_step(select.get()) == SQLITE_ROW) {
        return sqlite3_column_int64(select.get(), 0);
    }
    return 0;
}

std::string BenchmarkStore::generateId() {
    std::random_device rd;
    std::mt19937_64 generator(rd());
    std::ostringstream stream;
    stream << std::hex << std::setfill('0')
           << std::setw(16) << generator()
           << std::setw(16) << generator();
    return stream.str();
}

int64_t BenchmarkStore::unixTimeMilliseconds() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
}
