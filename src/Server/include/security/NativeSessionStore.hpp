#pragma once

#include <chrono>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

#include <nlohmann/json.hpp>

class PairingStore;
class PipeServer;

class NativeSessionStore {
public:
    struct Result {
        int status = 200;
        nlohmann::json body;
    };

    NativeSessionStore(std::shared_ptr<PairingStore> pairingStore,
        std::shared_ptr<PipeServer> pipeServer, std::string serverId,
        std::string certificateFingerprint, std::string environment);
    ~NativeSessionStore();

    void beginPairingWindow();
    void endPairingWindow();
    bool pairingAvailable() const;
    nlohmann::json identity() const;

    Result requestPairing(const nlohmann::json& body, const std::string& ip);
    Result confirmPairing(const std::string& requestId,
        const nlohmann::json& body);
    Result pairingStatus(const std::string& requestId,
        const nlohmann::json& body);
    bool approvePairing(const std::string& requestId);
    bool denyPairing(const std::string& requestId);

    Result requestTransfer(const nlohmann::json& body,
        const std::string& credential, const std::string& ip);
    Result transferStatus(const std::string& requestId,
        const std::string& credential);
    bool approveTransfer(const std::string& requestId);
    bool denyTransfer(const std::string& requestId);
    Result cancelTransfer(const std::string& transferId,
        const std::string& token);

    bool authorizeTransfer(const std::string& token,
        const std::string& transferId);
    bool authorizeFile(const std::string& token,
        const std::string& transferId, const std::string& fileId,
        const std::string& name, unsigned long long sizeBytes,
        bool skipExactDuplicates);
    void markFileTerminal(const std::string& transferId,
        const std::string& fileId);
    void revokeDevice(const std::string& deviceId);
    void revokeAll();

    static std::string computeSecurityCode(const std::string& environment,
        const std::string& serverId, const std::string& fingerprint,
        const std::string& clientId, const std::string& clientNonce,
        const std::string& requestId);
    static std::string confirmationProof(const std::string& credential,
        const std::string& requestId, const std::string& clientNonce);

private:
    enum class PairState { Pending, Confirmed, Approved, Denied };
    enum class TransferState { Pending, Approved, Denied, Cancelled };

    struct PairingRequest {
        std::string requestId;
        std::string deviceId;
        std::string deviceName;
        std::string ip;
        std::string clientNonce;
        std::string credentialHash;
        std::string expectedProof;
        std::string securityCode;
        std::chrono::steady_clock::time_point expiresAt;
        PairState state = PairState::Pending;
    };

    struct TransferFile {
        std::string fileId;
        std::string name;
        unsigned long long sizeBytes = 0;
        bool terminal = false;
    };

    struct TransferRequest {
        std::string requestId;
        std::string transferId;
        std::string deviceId;
        std::string deviceName;
        std::string ip;
        std::string tokenHash;
        bool skipExactDuplicates = true;
        std::vector<TransferFile> files;
        std::chrono::steady_clock::time_point createdAt;
        std::chrono::steady_clock::time_point lastActivity;
        std::chrono::steady_clock::time_point expiresAt;
        TransferState state = TransferState::Pending;
    };

    static Result error(int status, const std::string& code,
        const std::string& message, bool retryable = false);
    static std::string randomHex(size_t bytes);
    static std::string sha256Hex(const std::string& value);
    static bool constantTimeEqual(const std::string& left,
        const std::string& right);
    static bool isHex(const std::string& value, size_t length);
    static bool isSafeIdentifier(const std::string& value, size_t maxLength);
    static void appendCanonical(std::string& output,
        const std::string& value);
    void pruneLocked();
    bool pairingRateLimitedLocked(const std::string& ip);
    std::optional<std::string> transferTokenLocked(
        const TransferRequest& transfer) const;

    std::shared_ptr<PairingStore> m_pairingStore;
    std::shared_ptr<PipeServer> m_pipeServer;
    std::string m_serverId;
    std::string m_certificateFingerprint;
    std::string m_environment;
    std::string m_grantMaster;
    mutable std::mutex m_mutex;
    std::chrono::steady_clock::time_point m_pairingWindowExpiresAt{};
    std::unordered_map<std::string, PairingRequest> m_pairings;
    std::unordered_map<std::string, TransferRequest> m_transfers;
    std::unordered_map<std::string,
        std::vector<std::chrono::steady_clock::time_point>> m_pairingAttempts;
};
