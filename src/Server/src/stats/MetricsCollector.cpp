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
constexpr double MaxNativeProgressBytes = 8.0 * 1024.0 * 1024.0;

std::chrono::milliseconds speedLifetime(double bytesPerSecond) {
    if (bytesPerSecond <= 0.0) return std::chrono::milliseconds(5000);
    const auto milliseconds = 2.0 * MaxNativeProgressBytes / bytesPerSecond * 1000.0;
    return std::chrono::milliseconds(static_cast<int64_t>(
        std::clamp(milliseconds, 5000.0, 30000.0)));
}
}

MetricsCollector::MetricsCollector() {
    m_lastHistoryUpdate = std::chrono::steady_clock::now();
}

void MetricsCollector::startSession(const std::string& clientIp, const std::string& sessionId) {
    std::lock_guard<std::mutex> lock(m_mutex);

    const auto now = std::chrono::steady_clock::now();
    if (m_activeSessions.empty()) {
        m_hasTransferStarted = false;
        m_sessionStart = now;
        m_sessionEnd = now;
        m_firstTransferTime = now;
        m_totalBytes = 0;
        m_filesTransferred = 0;
        m_peakSpeedMBps = 0.0;
        m_speedHistory.clear();
        m_lastHistoryUpdate = now;
    }
    if (m_activeSessions.find(sessionId) == m_activeSessions.end() &&
        m_activeSessions.size() >= 32) {
        auto oldest = std::min_element(m_activeSessions.begin(), m_activeSessions.end(),
            [](const auto& left, const auto& right) {
                return left.second.startedAt < right.second.startedAt;
            });
        m_activeSessions.erase(oldest);
    }
    ClientRate newRate{};
    newRate.startedAt = now;
    m_activeSessions[sessionId] = newRate;
    m_clientIp = clientIp;

    spdlog::info("Session started for {} ({})", clientIp,
                 sessionId.empty() ? "legacy" : sessionId);
}

bool MetricsCollector::endSession(const std::string& sessionId) {
    std::lock_guard<std::mutex> lock(m_mutex);

    auto session = m_activeSessions.find(sessionId);
    if (session == m_activeSessions.end() && sessionId.empty() &&
        m_activeSessions.size() == 1) session = m_activeSessions.begin();
    if (session == m_activeSessions.end()) {
        spdlog::debug("Ignoring stale session completion for {}", sessionId);
        return false;
    }

    m_activeSessions.erase(session);
    if (m_activeSessions.empty()) {
        auto now = std::chrono::steady_clock::now();
        m_sessionEnd = now;
        const int64_t duration = m_hasTransferStarted
            ? std::chrono::duration_cast<std::chrono::seconds>(
                now - m_firstTransferTime).count() : 0;
        spdlog::info("Receiver activity ended: {} files, {} bytes, {} seconds",
                     m_filesTransferred, m_totalBytes, duration);
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
    auto session = m_activeSessions.find(sessionId);
    if (session == m_activeSessions.end() && sessionId.empty() &&
        m_activeSessions.size() == 1) session = m_activeSessions.begin();
    if (session == m_activeSessions.end()) {
        spdlog::debug("Ignoring stale speed sample for {}", sessionId);
        return false;
    }

    auto now = std::chrono::steady_clock::now();
    session->second.speedMBps = bytesPerSecond / BytesPerMegabyte;
    session->second.receivedAt = now;
    session->second.hasSample = true;
    double aggregateSpeedMBps = 0.0;
    for (const auto& [id, rate] : m_activeSessions) {
        if (rate.hasSample && now - rate.receivedAt <
            speedLifetime(rate.speedMBps * BytesPerMegabyte)) {
            aggregateSpeedMBps += rate.speedMBps;
        }
    }
    m_peakSpeedMBps = std::max(m_peakSpeedMBps, aggregateSpeedMBps);

    if (!m_hasTransferStarted && bytesPerSecond > 0.0) {
        m_hasTransferStarted = true;
        m_firstTransferTime = now;
    }

    if (now - m_lastHistoryUpdate >= std::chrono::seconds(1)) {
        auto historyBase = m_hasTransferStarted ? m_firstTransferTime : m_sessionStart;
        auto sessionSeconds = std::chrono::duration_cast<std::chrono::seconds>(
            now - historyBase).count();
        m_speedHistory.push_back({sessionSeconds, aggregateSpeedMBps});
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
    for (const auto& [id, rate] : m_activeSessions) {
        if (!rate.hasSample) continue;
        const auto lifetime = speedLifetime(rate.speedMBps * BytesPerMegabyte);
        const auto age = std::chrono::duration_cast<std::chrono::milliseconds>(
            now - rate.receivedAt);
        if (age >= lifetime) continue;
        const auto freshForMs = static_cast<uint32_t>((lifetime - age).count());
        metrics.rateComponents.push_back({rate.speedMBps, freshForMs});
        metrics.currentSpeedMBps += rate.speedMBps;
        metrics.speedFreshForMs = metrics.speedFreshForMs == 0
            ? freshForMs : std::min(metrics.speedFreshForMs, freshForMs);
    }
    metrics.speedAvailable = !metrics.rateComponents.empty();
    metrics.filesTransferred = m_filesTransferred;
    metrics.totalBytes = m_totalBytes;
    metrics.isActive = !m_activeSessions.empty();
    
    if (metrics.isActive && m_hasTransferStarted) {
        metrics.sessionDurationSeconds = std::chrono::duration_cast<std::chrono::seconds>(
            now - m_firstTransferTime).count();
    }
    
    return metrics;
}

bool MetricsCollector::isSessionActive() const {
    std::lock_guard<std::mutex> lock(m_mutex);
    return !m_activeSessions.empty();
}
