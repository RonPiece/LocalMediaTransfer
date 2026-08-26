#pragma once

#include <chrono>
#include <cstdint>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

struct ServerOwnershipIdentity {
    uint32_t serverProcessId = 0;
    uint64_t serverProcessStartTimeUtcFileTime = 0;
    uint32_t ownerProcessId = 0;
    uint64_t ownerProcessStartTimeUtcFileTime = 0;
    std::string environment;
    std::string runtimeInstanceId;
    std::string controlInstanceId;
    std::string pipeName;
};

struct ServerOwnershipResponse {
    std::string type;
    std::string dataJson;
};

class ServerOwnershipController {
public:
    ServerOwnershipController(
        ServerOwnershipIdentity identity,
        const std::string& controlTokenHex);
    ~ServerOwnershipController();

    ServerOwnershipController(const ServerOwnershipController&) = delete;
    ServerOwnershipController& operator=(const ServerOwnershipController&) = delete;

    bool enabled() const;
    std::optional<ServerOwnershipResponse> handleProbe(const std::string& dataJson);
    std::optional<ServerOwnershipResponse> authenticateSession(
        const std::string& dataJson);
    bool authorizeShutdown(const std::string& dataJson);

    static bool isValidControlToken(const std::string& tokenHex);
    static uint64_t currentProcessStartTimeUtcFileTime();

private:
    struct PendingChallenge {
        std::string clientNonce;
        std::string serverNonce;
        std::chrono::steady_clock::time_point expiresAt;
    };

    std::string proofPayload(
        const std::string& clientNonce,
        const std::string& serverNonce) const;
    std::string shutdownPayload(
        const std::string& clientNonce,
        const std::string& serverNonce) const;
    std::string sessionRequestPayload(const std::string& clientNonce) const;
    std::string sessionProofPayload(
        const std::string& clientNonce,
        const std::string& serverNonce) const;
    std::string computeHmacHex(const std::string& payload) const;
    bool verifyHmac(const std::string& payload, const std::string& suppliedHex) const;

    ServerOwnershipIdentity m_identity;
    std::vector<unsigned char> m_controlKey;
    std::string m_credentialId;
    std::optional<PendingChallenge> m_pendingChallenge;
    mutable std::mutex m_mutex;
};
