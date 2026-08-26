#pragma once

/**
 * HTTP Server
 * 
 * High-performance HTTP server using Crow framework.
 * Handles file upload endpoints and health checks.
 */

#include <string>
#include <memory>
#include <atomic>
#include <functional>
#include <chrono>
#include <mutex>

class HashEngine;
class BenchmarkStore;
class TransferHistoryStore;
class PairingStore;
class NativeSessionStore;

// Include Crow - required for crow::App (template alias can't be forward declared)
#include <crow.h>
#include <crow/middlewares/cors.h>

#include "common/Types.hpp"

// Forward declarations
class MetricsCollector;
class PipeServer;
class FileWriter;

class HttpServer {
public:
    HttpServer(int httpsPort,
               int httpPort,
               bool allowInsecureHttp,
               std::string certificatePem,
               std::string privateKeyPem,
               std::string runtimeEnvironment,
               const std::string& uploadDir,
               const std::string& staticDir,
               const std::string& defaultToken,
               std::shared_ptr<MetricsCollector> metrics,
               std::shared_ptr<PipeServer> pipeServer,
               std::shared_ptr<HashEngine> hashEngine,
               std::shared_ptr<BenchmarkStore> benchmarkStore = nullptr,
               std::shared_ptr<TransferHistoryStore> historyStore = nullptr,
               std::shared_ptr<PairingStore> pairingStore = nullptr,
               std::shared_ptr<NativeSessionStore> nativeSessionStore = nullptr,
               lmt::FilenameConflictPolicy filenameConflictPolicy =
                   lmt::FilenameConflictPolicy::KeepBoth);
    
    ~HttpServer();
    
    /**
     * Start the HTTP server (blocking)
     * @param running Atomic flag to control shutdown
     */
    void run(std::atomic<bool>& running);
    
    /**
     * Stop the server gracefully
     */
    void stop();
    
    /**
     * Set session token for authentication
     */
    void setToken(const std::string& token);
    bool setBrowserBootstrap(const std::string& bootstrap);
    void setAutoApproveKnown(bool enabled) { m_autoApproveKnown = enabled; }
    void beginNativePairingWindow();
    void endNativePairingWindow();
    bool approveNativePairing(const std::string& requestId);
    bool denyNativePairing(const std::string& requestId);
    bool approveNativeTransfer(const std::string& requestId);
    bool denyNativeTransfer(const std::string& requestId);
    void revokeNativeDevice(const std::string& deviceId);
    void revokeAllNativeSessions();
    
    /**
     * Get current server configuration
     */
    const lmt::ServerConfig& getConfig() const { return m_config; }

private:
    static constexpr int BrowserBootstrapLifetimeSeconds = 5 * 60;
    using CrowApp = crow::App<crow::CORSHandler>;
    void setupRoutes(CrowApp& app);
    void setupCORS(CrowApp& app);
    static asio::ssl::context createTlsContext(
        const std::string& certificatePem,
        const std::string& privateKeyPem);
    bool validateToken(const std::string& token) const;
    bool validateSessionToken(const std::string& token) const;
    bool exchangeBrowserBootstrap(
        const std::string& bootstrap,
        std::string& token);
    bool validateRequestToken(const crow::request& req) const;
    bool validateAnyToken(const std::string& token) const;
    bool validateUploadAuthorization(const crow::request& req) const;
    std::string getTokenFromRequest(const crow::request& req) const;
    
    lmt::ServerConfig m_config;
    CrowApp m_httpsApp;
    CrowApp m_httpApp;
    int m_httpsPort = 8443;
    int m_httpPort = 8080;
    bool m_allowInsecureHttp = false;
    std::string m_certificatePem;
    std::string m_privateKeyPem;
    std::string m_runtimeEnvironment;
    std::shared_ptr<MetricsCollector> m_metrics;
    std::shared_ptr<PipeServer> m_pipeServer;
    std::shared_ptr<BenchmarkStore> m_benchmarkStore;
    std::shared_ptr<TransferHistoryStore> m_historyStore;
    std::shared_ptr<PairingStore> m_pairingStore;
    std::shared_ptr<NativeSessionStore> m_nativeSessionStore;
    std::unique_ptr<FileWriter> m_fileWriter;  // Memory-mapped file I/O
    std::atomic<bool> m_running{false};
    std::atomic<bool> m_autoApproveKnown{false};
    mutable std::mutex m_authMutex;
    std::string m_browserBootstrap;
    std::chrono::steady_clock::time_point m_browserBootstrapExpiresAt{};
    std::string m_settingsJson = R"({"autoDelete": false, "darkMode": true})";
};
