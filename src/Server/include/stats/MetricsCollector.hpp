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
     * Record the browser's upload-progress speed so the web UI and desktop GUI
     * display the same live measurement.
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
     * Get current session stats
     */
    lmt::SessionStats getSessionStats() const;
    
    /**
     * Get transfer speed history (last 5 minutes)
     * @return Vector of (timestamp_seconds, speed_mbps) pairs
     */
    std::vector<std::pair<int64_t, double>> getSpeedHistory() const;
    
    /**
     * Check if session is active
     */
    bool isSessionActive() const;

private:
    mutable std::mutex m_mutex;
    
    // Session state
    bool m_sessionActive = false;
    bool m_hasTransferStarted = false;
    std::string m_sessionId;
    std::string m_clientIp;
    std::chrono::steady_clock::time_point m_sessionStart;
    std::chrono::steady_clock::time_point m_sessionEnd;
    std::chrono::steady_clock::time_point m_firstTransferTime;
    
    // Counters
    uint64_t m_totalBytes = 0;
    uint64_t m_filesTransferred = 0;
    
    // Live speed has one source: session-scoped client acknowledgements.
    double m_clientSpeedMBps = 0.0;
    double m_peakSpeedMBps = 0.0;
    bool m_hasClientSpeed = false;
    std::chrono::steady_clock::time_point m_lastClientSpeedUpdate;
    
    // History for graph (every second, last 5 minutes)
    std::deque<std::pair<int64_t, double>> m_speedHistory;
    std::chrono::steady_clock::time_point m_lastHistoryUpdate;
};
