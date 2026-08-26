/**
 * Metrics Collector Implementation
 * 
 * Real-time transfer statistics and speed calculation.
 */

#include "stats/MetricsCollector.hpp"

#include <spdlog/spdlog.h>

#include <numeric>
#include <algorithm>
#include <cmath>

namespace {
constexpr double BytesPerMegabyte = 1'000'000.0;
}

MetricsCollector::MetricsCollector() {
    m_lastHistoryUpdate = std::chrono::steady_clock::now();
}

void MetricsCollector::startSession(const std::string& clientIp, const std::string& sessionId) {
    std::lock_guard<std::mutex> lock(m_mutex);
    
    m_sessionActive = true;
    m_hasTransferStarted = false;
    m_sessionId = sessionId;
    m_clientIp = clientIp;
    m_sessionStart = std::chrono::steady_clock::now();
    m_sessionEnd = m_sessionStart;
    m_firstTransferTime = m_sessionStart;
    m_totalBytes = 0;
    m_filesTransferred = 0;
    m_clientSpeedMBps = 0.0;
    m_hasClientSpeed = false;
    m_peakSpeedMBps = 0.0;
    m_speedHistory.clear();
    
    spdlog::info("Session started for {} ({})", clientIp,
                 sessionId.empty() ? "legacy" : sessionId);
}

bool MetricsCollector::endSession(const std::string& sessionId) {
    std::lock_guard<std::mutex> lock(m_mutex);

    if (!sessionId.empty() && !m_sessionId.empty() && sessionId != m_sessionId) {
        spdlog::debug("Ignoring stale session completion for {} (active {})",
                      sessionId, m_sessionId);
        return false;
    }
    
    if (m_sessionActive) {
        auto now = std::chrono::steady_clock::now();
        m_sessionEnd = now;
        int64_t duration = 0;
        if (m_hasTransferStarted) {
            duration = std::chrono::duration_cast<std::chrono::seconds>(
                now - m_firstTransferTime).count();
        }
        
        spdlog::info("Session ended: {} files, {} bytes, {} seconds",
                     m_filesTransferred, m_totalBytes, duration);
        
        m_sessionActive = false;
        m_clientSpeedMBps = 0.0;
        m_hasClientSpeed = false;
    }
    return true;
}

void MetricsCollector::recordBytes(uint64_t bytes) {
    std::lock_guard<std::mutex> lock(m_mutex);
    
    auto now = std::chrono::steady_clock::now();

    if (!m_hasTransferStarted && bytes > 0) {
        m_hasTransferStarted = true;
        m_firstTransferTime = now;
    }
    
    m_totalBytes += bytes;
}

bool MetricsCollector::recordClientSpeed(double bytesPerSecond, const std::string& sessionId) {
    std::lock_guard<std::mutex> lock(m_mutex);

    if (!std::isfinite(bytesPerSecond) || bytesPerSecond < 0.0) {
        return false;
    }
    if (!sessionId.empty() && !m_sessionId.empty() && sessionId != m_sessionId) {
        spdlog::debug("Ignoring stale speed sample for {} (active {})",
                      sessionId, m_sessionId);
        return false;
    }

    auto now = std::chrono::steady_clock::now();
    m_clientSpeedMBps = bytesPerSecond / BytesPerMegabyte;
    m_lastClientSpeedUpdate = now;
    m_hasClientSpeed = true;
    m_peakSpeedMBps = std::max(m_peakSpeedMBps, m_clientSpeedMBps);

    if (!m_hasTransferStarted && bytesPerSecond > 0.0) {
        m_hasTransferStarted = true;
        m_firstTransferTime = now;
    }

    if (now - m_lastHistoryUpdate >= std::chrono::seconds(1)) {
        auto historyBase = m_hasTransferStarted ? m_firstTransferTime : m_sessionStart;
        auto sessionSeconds = std::chrono::duration_cast<std::chrono::seconds>(
            now - historyBase).count();
        m_speedHistory.push_back({sessionSeconds, m_clientSpeedMBps});
        while (m_speedHistory.size() > 300) {
            m_speedHistory.pop_front();
        }
        m_lastHistoryUpdate = now;
    }
    return true;
}

void MetricsCollector::recordFileComplete(const lmt::FileTransferStats& stats) {
    std::lock_guard<std::mutex> lock(m_mutex);
    
    m_filesTransferred++;
    spdlog::debug("File complete: {}, {} bytes", stats.originalName, stats.sizeBytes);
}

lmt::RealtimeMetrics MetricsCollector::getRealtimeMetrics() const {
    std::lock_guard<std::mutex> lock(m_mutex);
    
    lmt::RealtimeMetrics metrics;
    const auto now = std::chrono::steady_clock::now();
    const bool clientSpeedIsFresh =
        m_hasClientSpeed &&
        now - m_lastClientSpeedUpdate < std::chrono::seconds(2);
    metrics.speedAvailable = m_sessionActive && clientSpeedIsFresh;
    metrics.currentSpeedMBps = metrics.speedAvailable ? m_clientSpeedMBps : 0.0;
    metrics.filesTransferred = m_filesTransferred;
    metrics.totalBytes = m_totalBytes;
    metrics.isActive = m_sessionActive;
    
    if (m_sessionActive && m_hasTransferStarted) {
        metrics.sessionDurationSeconds = std::chrono::duration_cast<std::chrono::seconds>(
            now - m_firstTransferTime).count();
    }
    
    return metrics;
}

lmt::SessionStats MetricsCollector::getSessionStats() const {
    std::lock_guard<std::mutex> lock(m_mutex);
    
    lmt::SessionStats stats;
    stats.clientIp = m_clientIp;
    stats.sessionId = m_sessionId;
    stats.startTime = m_sessionStart;
    stats.filesTransferred = m_filesTransferred;
    stats.totalBytes = m_totalBytes;
    const auto averageEnd = m_sessionActive ? std::chrono::steady_clock::now() : m_sessionEnd;
    const auto durationSeconds = m_hasTransferStarted
        ? std::chrono::duration<double>(averageEnd - m_firstTransferTime).count()
        : 0.0;
    stats.averageSpeedMBps = durationSeconds > 0.0
        ? (m_totalBytes / BytesPerMegabyte) / durationSeconds
        : 0.0;
    stats.peakSpeedMBps = m_peakSpeedMBps;
    
    return stats;
}

bool MetricsCollector::isSessionActive() const {
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_sessionActive;
}

std::vector<std::pair<int64_t, double>> MetricsCollector::getSpeedHistory() const {
    std::lock_guard<std::mutex> lock(m_mutex);
    return std::vector<std::pair<int64_t, double>>(
        m_speedHistory.begin(), m_speedHistory.end());
}
