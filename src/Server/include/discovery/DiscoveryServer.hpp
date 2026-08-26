#pragma once

#include <atomic>
#include <string>

class DiscoveryServer {
public:
    DiscoveryServer(std::string serverId, std::string serverName, int httpsPort,
        std::string certificateFingerprint, int httpPort,
        unsigned short discoveryPort, bool discoveryAllowed,
        std::string runtimeEnvironment);
    void run(std::atomic<bool>& running);
    void setEnabled(bool enabled);
    void setNativePairingAvailable(bool available);
    void stop();

private:
    std::string m_serverId;
    std::string m_serverName;
    int m_httpsPort;
    std::string m_certificateFingerprint;
    int m_httpPort;
    unsigned short m_discoveryPort;
    bool m_discoveryAllowed;
    std::string m_runtimeEnvironment;
    std::atomic<bool> m_running{false};
    std::atomic<bool> m_enabled{false};
    std::atomic<long long> m_nativePairingExpiresAtUnix{0};
};
