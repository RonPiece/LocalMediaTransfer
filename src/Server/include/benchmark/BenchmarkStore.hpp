#pragma once

#include <cstdint>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

struct sqlite3;
struct sqlite3_stmt;

class BenchmarkStore {
public:
    BenchmarkStore() = default;
    ~BenchmarkStore();

    BenchmarkStore(const BenchmarkStore&) = delete;
    BenchmarkStore& operator=(const BenchmarkStore&) = delete;

    void open(const std::string& databasePath);
    bool isOpen() const;

    std::optional<std::string> startRun(const nlohmann::json& payload);
    bool addSample(const std::string& runId, const nlohmann::json& payload);
    bool addFileResult(
        const std::string& runId,
        const std::string& fileId,
        const nlohmann::json& payload);
    bool finishRun(const std::string& runId, const nlohmann::json& payload);
    std::optional<nlohmann::json> getRun(const std::string& runId);

private:
    struct PendingSample {
        std::string runId;
        int64_t elapsedMs = 0;
        double throughputMBps = 0.0;
        double cpuPercent = 0.0;
        int64_t workingSetBytes = 0;
        int64_t processIoReadBytes = 0;
        int64_t processIoWriteBytes = 0;
        int64_t networkBytes = 0;
        int64_t transferredBytes = 0;
    };

    void execute(const char* sql);
    void createSchema();
    void prepareStatements();
    void finalizeStatements();
    void flushSamplesLocked();
    int64_t upsertMachineLocked(const nlohmann::json& machine);
    static std::string generateId();
    static int64_t unixTimeMilliseconds();

    mutable std::mutex m_mutex;
    sqlite3* m_db = nullptr;
    sqlite3_stmt* m_sampleInsertStatement = nullptr;
    sqlite3_stmt* m_fileUpsertStatement = nullptr;
    std::string m_activeRunId;
    std::vector<PendingSample> m_pendingSamples;
};
