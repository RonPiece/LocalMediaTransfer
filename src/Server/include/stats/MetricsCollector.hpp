#pragma once

/**
 * Metrics Collector
 * 
 * Collects and calculates real-time transfer statistics.
 */

#include <chrono>
#include <vector>
#include <mutex>
#include <deque>
#include <unordered_map>

#include "common/Types.hpp"

class MetricsCollector {
public:
    MetricsCollector();
    ~MetricsCollector() = default;
    
    /**
     * Start a new session
     * @param clientIp Client IP address
     */
    void startSession(const std::string& clientIp, const std::string& sessionId = {});
    
    /**
     * End the current session
     */
    bool endSession(const std::string& sessionId = {});
    
    /**
     * Record bytes transferred
     * @param bytes Number of bytes
     */
    void recordBytes(uint64_t bytes);

    /**
     * Record the active client's reported live rate. Native clients report
     * acknowledged media bytes; browsers report XHR sent bytes.
     */
    bool recordClientSpeed(double bytesPerSecond, const std::string& sessionId = {});
    
    /**
     * Record a completed file transfer
     * @param stats File transfer stats
     */
    void recordFileComplete(const lmt::FileTransferStats& stats);
    
    /**
     * Get current real-time metrics
     */
    lmt::RealtimeMetrics getRealtimeMetrics() const;
    
    /**
     * Check if session is active
     */
    bool isSessionActive() const;

private:
    mutable std::mutex m_mutex;
    
    // Session state
    bool m_hasTransferStarted = false;
    std::string m_clientIp;
    std::chrono::steady_clock::time_point m_sessionStart;
    std::chrono::steady_clock::time_point m_sessionEnd;
    std::chrono::steady_clock::time_point m_firstTransferTime;
    
    // Counters
    uint64_t m_totalBytes = 0;
    uint64_t m_filesTransferred = 0;
    
    struct ClientRate {
        double speedMBps = 0.0;
        bool hasSample = false;
        std::chrono::steady_clock::time_point startedAt;
        std::chrono::steady_clock::time_point receivedAt;
    };

    // Each active sender owns its own latest sample and freshness lease.
    std::unordered_map<std::string, ClientRate> m_activeSessions;
    double m_peakSpeedMBps = 0.0;
    
    // History for graph (every second, last 5 minutes)
    std::deque<std::pair<int64_t, double>> m_speedHistory;
    std::chrono::steady_clock::time_point m_lastHistoryUpdate;
};
