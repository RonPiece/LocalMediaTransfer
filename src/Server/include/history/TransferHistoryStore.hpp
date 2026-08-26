#pragma once

#include <mutex>
#include <string>

struct sqlite3;

class TransferHistoryStore {
public:
    TransferHistoryStore() = default;
    ~TransferHistoryStore();

    void open(const std::string& dbPath);
    void recordSession(const std::string& payloadJson, const std::string& clientIp);
    std::string recentSessionsJson(int limit = 200) const;
    void clear();

private:
    mutable std::mutex m_mutex;
    sqlite3* m_db = nullptr;
};
