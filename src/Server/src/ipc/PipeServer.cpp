/**
 * Named Pipe Server Implementation
 * 
 * IPC with C# WinUI 3 GUI via Windows Named Pipes.
 */

#include "ipc/PipeServer.hpp"

#include <spdlog/spdlog.h>
#include <nlohmann/json.hpp>
#include <algorithm>
#include <vector>

#ifdef _WIN32
#include <sddl.h>
#endif

using json = nlohmann::json;

#ifdef _WIN32
namespace {

bool createPipeSecurity(
    SECURITY_ATTRIBUTES& attributes,
    PSECURITY_DESCRIPTOR& descriptor) {
    HANDLE token = nullptr;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) {
        return false;
    }

    DWORD required = 0;
    GetTokenInformation(token, TokenGroups, nullptr, 0, &required);
    if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || required == 0) {
        CloseHandle(token);
        return false;
    }

    std::vector<unsigned char> storage(required);
    auto* groups = reinterpret_cast<TOKEN_GROUPS*>(storage.data());
    if (!GetTokenInformation(token, TokenGroups, groups, required, &required)) {
        CloseHandle(token);
        return false;
    }
    CloseHandle(token);

    PSID logonSid = nullptr;
    for (DWORD index = 0; index < groups->GroupCount; ++index) {
        if ((groups->Groups[index].Attributes & SE_GROUP_LOGON_ID) == SE_GROUP_LOGON_ID) {
            logonSid = groups->Groups[index].Sid;
            break;
        }
    }
    if (!logonSid) {
        SetLastError(ERROR_NO_SUCH_LOGON_SESSION);
        return false;
    }

    LPSTR sidText = nullptr;
    if (!ConvertSidToStringSidA(logonSid, &sidText)) {
        return false;
    }
    const std::string sddl =
        "D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;" + std::string(sidText) + ")";
    LocalFree(sidText);

    if (!ConvertStringSecurityDescriptorToSecurityDescriptorA(
            sddl.c_str(),
            SDDL_REVISION_1,
            &descriptor,
            nullptr)) {
        return false;
    }

    attributes = {};
    attributes.nLength = sizeof(attributes);
    attributes.lpSecurityDescriptor = descriptor;
    attributes.bInheritHandle = FALSE;
    return true;
}

} // namespace
#endif

PipeServer::PipeServer(const std::string& pipeName)
    : m_pipeName("\\\\.\\pipe\\" + pipeName)
{
}

PipeServer::~PipeServer() {
    stop();
}

void PipeServer::run(std::atomic<bool>& running) {
    m_running = true;
    
#ifdef _WIN32
    SECURITY_ATTRIBUTES pipeSecurity{};
    PSECURITY_DESCRIPTOR pipeDescriptor = nullptr;
    if (!createPipeSecurity(pipeSecurity, pipeDescriptor)) {
        spdlog::error(
            "Unable to create the current-logon named-pipe ACL: {}",
            GetLastError());
        running = false;
        m_running = false;
        return;
    }

    // Capture thread handle with permission to cancel IO
    m_threadHandle = OpenThread(THREAD_TERMINATE | THREAD_QUERY_INFORMATION | THREAD_SET_INFORMATION, FALSE, GetCurrentThreadId());
#endif

    spdlog::info("Starting Named Pipe server: {}", m_pipeName);
    
    while (running && m_running) {
#ifdef _WIN32
        // Create named pipe
        m_pipe = CreateNamedPipeA(
            m_pipeName.c_str(),
            PIPE_ACCESS_DUPLEX,
            PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT |
                PIPE_REJECT_REMOTE_CLIENTS,
            1,              // Max instances
            4096,           // Out buffer
            4096,           // In buffer
            0,              // Timeout
            &pipeSecurity
        );
        
        if (m_pipe == INVALID_HANDLE_VALUE) {
            spdlog::error("CreateNamedPipe failed: {}", GetLastError());
            std::this_thread::sleep_for(std::chrono::seconds(1));
            continue;
        }
        
        spdlog::info("Waiting for GUI connection...");
        
        // Wait for client connection
        if (ConnectNamedPipe(m_pipe, nullptr) || GetLastError() == ERROR_PIPE_CONNECTED) {
            m_sessionAuthenticated = !m_authenticationRequired;
            m_connected = true;
            spdlog::info("GUI connected to pipe");
            
            // Process messages while connected
            while (running && m_running && m_connected) {
                processIncoming();
                
                // Never hold the queue mutex across blocking pipe I/O. Upload
                // threads may publish progress while a slow GUI is reading.
                while (running && m_running && m_connected) {
                    OutboundMessage message;
                    {
                        std::lock_guard<std::mutex> lock(m_queueMutex);
                        if (m_outQueue.empty()) break;
                        message = std::move(m_outQueue.front());
                        m_outQueue.pop_front();
                    }
                    DWORD written;
                    if (!WriteFile(
                            m_pipe,
                            message.payload.c_str(),
                            static_cast<DWORD>(message.payload.size()),
                            &written,
                            nullptr)) {
                        spdlog::warn("WriteFile failed: {}", GetLastError());
                        {
                            std::lock_guard<std::mutex> lock(m_queueMutex);
                            m_outQueue.push_front(std::move(message));
                        }
                        m_connected = false;
                        break;
                    }
                }
                
                std::this_thread::sleep_for(std::chrono::milliseconds(10));
            }
            
            DisconnectNamedPipe(m_pipe);
        }
        
        CloseHandle(m_pipe);
        m_pipe = INVALID_HANDLE_VALUE;
        m_connected = false;
        m_sessionAuthenticated = false;
#else
        // Unix named pipes / sockets would go here
        std::this_thread::sleep_for(std::chrono::seconds(1));
#endif
    }
    
    m_running = false;
#ifdef _WIN32
    if (m_threadHandle) {
        CloseHandle(m_threadHandle);
        m_threadHandle = nullptr;
    }
    if (pipeDescriptor) {
        LocalFree(pipeDescriptor);
    }
#endif
    spdlog::info("Named Pipe server stopped");
}

void PipeServer::processIncoming() {
#ifdef _WIN32
    static constexpr size_t MaxIncomingCommandBytes = 64 * 1024;
    char buffer[4096];
    DWORD bytesAvailable;
    
    // Check if data available (non-blocking)
    if (!PeekNamedPipe(m_pipe, nullptr, 0, nullptr, &bytesAvailable, nullptr)) {
        if (GetLastError() == ERROR_BROKEN_PIPE) {
            m_connected = false;
            spdlog::info("GUI disconnected");
        }
        return;
    }
    
    if (bytesAvailable == 0) return;
    
    std::string payload;
    while (true) {
        DWORD bytesRead = 0;
        const BOOL complete = ReadFile(
            m_pipe,
            buffer,
            static_cast<DWORD>(sizeof(buffer)),
            &bytesRead,
            nullptr);
        if (bytesRead > 0) {
            payload.append(buffer, bytesRead);
            if (payload.size() > MaxIncomingCommandBytes) {
                spdlog::warn("Rejected oversized pipe command");
                m_connected = false;
                return;
            }
        }
        if (complete) break;
        if (GetLastError() != ERROR_MORE_DATA) {
            m_connected = false;
            return;
        }
    }

    if (!payload.empty()) {
        try {
            auto msg = json::parse(payload);
            std::string type = msg.value("type", "");
            std::string data = msg.value("data", "");
            std::string requestId = msg.value("requestId", "");

            const bool controlMessage =
                type == "session_auth" ||
                type == "ownership_probe" ||
                type == "ownership_shutdown";
            if (m_authenticationRequired &&
                !m_sessionAuthenticated &&
                !controlMessage) {
                spdlog::warn("Rejected unauthenticated pipe command: {}", type);
                return;
            }
            
            if (m_commandCallback) {
                CommandResult result = m_commandCallback(type, data);
                if (!requestId.empty() && requestId.size() <= 64) {
                    sendControlResponse("command_result", json{
                        {"requestId", requestId},
                        {"success", result.success},
                        {"error", result.success ? "" : result.error}
                    }.dump());
                }
            }
            
            spdlog::debug("Received command: {}", type);
        } catch (const std::exception& e) {
            spdlog::warn("Failed to parse pipe message: {}", e.what());
        }
    }
#endif
}

void PipeServer::stop() {
    m_running = false;
    m_connected = false;
    
#ifdef _WIN32
    // Safely break the pipe thread out of ConnectNamedPipe or ReadFile
    if (m_threadHandle) {
        // Must use dynamic loading or fallback if older Windows, but CancelSynchronousIo is Vista+ so it's fine.
        CancelSynchronousIo(m_threadHandle);
    }
    // We DO NOT close m_pipe here. The run() loop will exit and close it safely.
#endif
}

void PipeServer::sendMetrics(const lmt::RealtimeMetrics& metrics) {
    json msg = {
        {"type", "metrics"},
        {"data", {
            {"speedMBps", metrics.currentSpeedMBps},
            {"speedAvailable", metrics.speedAvailable},
            {"filesTransferred", metrics.filesTransferred},
            {"totalBytes", metrics.totalBytes},
            {"durationSeconds", metrics.sessionDurationSeconds},
            {"isActive", metrics.isActive}
        }}
    };
    
    sendMessage("metrics", msg.dump());
}

void PipeServer::sendLog(const std::string& level, const std::string& message) {
    json msg = {
        {"type", "log"},
        {"data", {
            {"level", level},
            {"message", message},
            {"timestamp", std::time(nullptr)}
        }}
    };
    
    sendMessage("log", msg.dump());
}

void PipeServer::sendTransferHistory(const std::string& sessionsJson) {
    json sessions = json::array();
    try {
        sessions = json::parse(sessionsJson);
    } catch (...) {
        return;
    }
    if (!sessions.is_array()) {
        return;
    }
    constexpr std::size_t maxGuiHistoryEntries = 120;
    while (sessions.size() > maxGuiHistoryEntries) {
        sessions.erase(sessions.end() - 1);
    }
    for (auto& session : sessions) {
        if (session.is_object()) {
            // The WinUI activity page consumes session totals only. Per-file
            // details can exceed the pipe's bounded frame after a large run
            // and remain available through the authenticated HTTP history API.
            session.erase("files");
        }
    }
    json msg = {
        {"type", "transfer_history"},
        {"data", sessions}
    };
    sendMessage("transfer_history", msg.dump());
}

void PipeServer::sendPairingRequest(const std::string& requestJson) {
    try {
        sendMessage("pairing_request", json{{"type", "pairing_request"}, {"data", json::parse(requestJson)}}.dump());
    } catch (...) {}
}

void PipeServer::sendNativePairingRequest(const std::string& requestJson) {
    try {
        sendMessage("native_pairing_request", json{
            {"type", "native_pairing_request"},
            {"data", json::parse(requestJson)}
        }.dump());
    } catch (...) {}
}

void PipeServer::sendNativeTransferRequest(const std::string& requestJson) {
    try {
        sendMessage("native_transfer_request", json{
            {"type", "native_transfer_request"},
            {"data", json::parse(requestJson)}
        }.dump());
    } catch (...) {}
}

void PipeServer::sendTrustedDevices(const std::string& devicesJson) {
    try {
        sendMessage("trusted_devices", json{{"type", "trusted_devices"}, {"data", json::parse(devicesJson)}}.dump());
    } catch (...) {}
}

void PipeServer::sendMessage(const std::string& type, const std::string& payload) {
    if (!m_connected) return;
    if (m_authenticationRequired &&
        !m_sessionAuthenticated &&
        type != "ownership_proof" &&
        type != "session_ready" &&
        type != "session_rejected") {
        return;
    }

    std::lock_guard<std::mutex> lock(m_queueMutex);
    if (isCoalescibleMessage(type)) {
        const auto pending = std::find_if(
            m_outQueue.begin(),
            m_outQueue.end(),
            [&type](const OutboundMessage& message) {
                return message.type == type;
            });
        if (pending != m_outQueue.end()) {
            pending->payload = payload;
            return;
        }
    }

    const bool bestEffortLog = type == "log";
    if (bestEffortLog &&
        m_outQueue.size() >= MaxQueuedMessages - ReservedImportantMessages) {
        if (++m_droppedLogMessages == 1) {
            spdlog::warn(
                "Named-pipe client is falling behind; dropping best-effort log messages");
        }
        return;
    }

    // Leave one slot for a message that must be requeued after a failed write.
    if (m_outQueue.size() >= MaxQueuedMessages - 1) {
        const auto disposable = std::find_if(
            m_outQueue.begin(),
            m_outQueue.end(),
            [](const OutboundMessage& message) {
                return message.type == "log" ||
                    PipeServer::isCoalescibleMessage(message.type);
            });
        if (disposable != m_outQueue.end()) {
            m_outQueue.erase(disposable);
        } else {
            spdlog::warn(
                "Named-pipe queue is full; dropping '{}' message",
                type);
            return;
        }
    }

    m_outQueue.push_back({type, payload});
}

void PipeServer::sendControlResponse(
    const std::string& type,
    const std::string& dataJson) {
    try {
        sendMessage(type, json{{"type", type}, {"data", json::parse(dataJson)}}.dump());
    } catch (...) {
    }
}

bool PipeServer::isCoalescibleMessage(const std::string& type) {
    return type == "metrics" ||
        type == "transfer_history" ||
        type == "trusted_devices";
}
