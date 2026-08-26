#pragma once

/**
 * Named Pipe Server
 * 
 * IPC communication with C# WinUI 3 GUI.
 * Sends real-time metrics and receives commands.
 */

#include <string>
#include <atomic>
#include <functional>
#include <deque>
#include <mutex>

#ifdef _WIN32
#include <windows.h>
#endif

#include "common/Types.hpp"

class PipeServer {
public:
    explicit PipeServer(const std::string& pipeName);
    ~PipeServer();
    
    /**
     * Start the pipe server (blocking)
     * @param running Atomic flag for shutdown
     */
    void run(std::atomic<bool>& running);
    
    /**
     * Stop the pipe server
     */
    void stop();
    
    /**
     * Send metrics to connected GUI
     * @param metrics Real-time metrics
     */
    void sendMetrics(const lmt::RealtimeMetrics& metrics);
    
    /**
     * Send log message to GUI
     * @param level Log level (INFO, WARN, ERROR)
     * @param message Log message
     */
    void sendLog(const std::string& level, const std::string& message);
    void sendTransferHistory(const std::string& sessionsJson);
    void sendPairingRequest(const std::string& requestJson);
    void sendNativePairingRequest(const std::string& requestJson);
    void sendNativeTransferRequest(const std::string& requestJson);
    void sendTrustedDevices(const std::string& devicesJson);
    void sendControlResponse(const std::string& type, const std::string& dataJson);
    
    /**
     * Check if GUI is connected
     */
    bool isConnected() const { return m_connected; }
    
    /**
     * Set callback for commands from GUI
     */
    struct CommandResult {
        bool success = false;
        std::string error;
    };
    using CommandCallback = std::function<CommandResult(
        const std::string& command,
        const std::string& data)>;
    void setCommandCallback(CommandCallback cb) { m_commandCallback = std::move(cb); }
    void setAuthenticationRequired(bool required) {
        m_authenticationRequired = required;
    }
    void markSessionAuthenticated() { m_sessionAuthenticated = true; }

private:
    struct OutboundMessage {
        std::string type;
        std::string payload;
    };

    void processIncoming();
    void sendMessage(const std::string& type, const std::string& payload);
    static bool isCoalescibleMessage(const std::string& type);
    
    std::string m_pipeName;
    std::atomic<bool> m_connected{false};
    std::atomic<bool> m_running{false};
    std::atomic<bool> m_authenticationRequired{false};
    std::atomic<bool> m_sessionAuthenticated{false};
    CommandCallback m_commandCallback;
    
#ifdef _WIN32
    HANDLE m_pipe = INVALID_HANDLE_VALUE;
    HANDLE m_threadHandle = nullptr;
#else
    int m_pipe = -1;
#endif
    
    static constexpr size_t MaxQueuedMessages = 256;
    static constexpr size_t ReservedImportantMessages = 32;
    std::deque<OutboundMessage> m_outQueue;
    std::mutex m_queueMutex;
    size_t m_droppedLogMessages = 0;
};
