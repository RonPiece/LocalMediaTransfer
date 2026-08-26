#include "discovery/DiscoveryServer.hpp"

#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>
#include <winsock2.h>
#include <ws2tcpip.h>
#include <chrono>
#include <thread>

using json = nlohmann::json;

DiscoveryServer::DiscoveryServer(std::string serverId, std::string serverName, int httpsPort,
    std::string certificateFingerprint, int httpPort,
    unsigned short discoveryPort, bool discoveryAllowed,
    std::string runtimeEnvironment)
    : m_serverId(std::move(serverId)), m_serverName(std::move(serverName))
    , m_httpsPort(httpsPort), m_certificateFingerprint(std::move(certificateFingerprint))
    , m_httpPort(httpPort), m_discoveryPort(discoveryPort)
    , m_discoveryAllowed(discoveryAllowed)
    , m_runtimeEnvironment(std::move(runtimeEnvironment)) {}

void DiscoveryServer::run(std::atomic<bool>& running) {
    m_running = true;
    while (running && m_running) {
        if (!m_enabled) {
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
            continue;
        }

        SOCKET socketHandle = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
        if (socketHandle == INVALID_SOCKET) {
            std::this_thread::sleep_for(std::chrono::milliseconds(500));
            continue;
        }
        DWORD timeout = 250;
        setsockopt(socketHandle, SOL_SOCKET, SO_RCVTIMEO,
            reinterpret_cast<const char*>(&timeout), sizeof(timeout));
        sockaddr_in address{};
        address.sin_family = AF_INET;
        address.sin_addr.s_addr = htonl(INADDR_ANY);
        address.sin_port = htons(m_discoveryPort);
        if (bind(socketHandle, reinterpret_cast<sockaddr*>(&address), sizeof(address)) == SOCKET_ERROR) {
            spdlog::warn("UDP discovery port {} unavailable", m_discoveryPort);
            closesocket(socketHandle);
            std::this_thread::sleep_for(std::chrono::milliseconds(500));
            continue;
        }
        spdlog::info("Nearby desktop discovery enabled on UDP port {}", m_discoveryPort);

        while (running && m_running && m_enabled) {
            char buffer[512];
            sockaddr_in remote{};
            int remoteSize = sizeof(remote);
            const int received = recvfrom(socketHandle, buffer, sizeof(buffer), 0,
                reinterpret_cast<sockaddr*>(&remote), &remoteSize);
            if (received <= 0) continue;
            try {
                const auto request = json::parse(buffer, buffer + received);
                if (request.value("type", "") != "lmt-discovery-query" ||
                    request.value("version", 0) != 2) continue;
                json responseObject{{"type", "lmt-discovery-response"}, {"version", 2},
                    {"serverId", m_serverId}, {"name", m_serverName},
                    {"httpsPort", m_httpsPort},
                    {"certificateFingerprint", m_certificateFingerprint},
                    {"approvalRequired", true}, {"environment", m_runtimeEnvironment},
                    {"capabilities", json::object()}};
                responseObject["capabilities"]["nativeWindowsTransfer"] = {
                    {"version", 1},
                    {"pairingAvailable",
                        std::chrono::duration_cast<std::chrono::seconds>(
                            std::chrono::system_clock::now().time_since_epoch()).count() <
                        m_nativePairingExpiresAtUnix.load()}
                };
                if (m_httpPort > 0) responseObject["httpPort"] = m_httpPort;
                const auto response = responseObject.dump();
                sendto(socketHandle, response.data(), static_cast<int>(response.size()), 0,
                    reinterpret_cast<sockaddr*>(&remote), remoteSize);
            } catch (...) {}
        }
        closesocket(socketHandle);
        spdlog::info("Nearby desktop discovery disabled");
    }
}

void DiscoveryServer::setEnabled(bool enabled) {
    if (enabled && !m_discoveryAllowed) {
        spdlog::warn("Nearby discovery is disabled in this environment");
        m_enabled = false;
        return;
    }
    m_enabled = enabled;
}

void DiscoveryServer::setNativePairingAvailable(bool available) {
    if (!available) {
        m_nativePairingExpiresAtUnix = 0;
        return;
    }
    m_nativePairingExpiresAtUnix =
        std::chrono::duration_cast<std::chrono::seconds>(
            std::chrono::system_clock::now().time_since_epoch()).count() + 120;
}

void DiscoveryServer::stop() { m_running = false; }
