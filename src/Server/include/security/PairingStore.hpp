#pragma once

#include <chrono>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

struct TrustedDevice {
    std::string id;
    std::string name;
    std::string credentialHash;
    std::string lastIp;
    long long lastSeenUnix = 0;
    std::string clientType = "ios";
    std::string authorizationMode = "direct_upload";
};

class PairingStore {
public:
    enum class Status { Pending, Approved, Denied };

    explicit PairingStore(std::string path);
    void load();
    Status request(const std::string& id, const std::string& name,
                   const std::string& credential, const std::string& ip,
                   bool autoApproveKnown);
    Status status(const std::string& id, const std::string& credential) const;
    bool validateCredential(const std::string& credential) const;
    std::optional<TrustedDevice> findDeviceByCredential(
        const std::string& credential) const;
    bool trustCredentialHash(const std::string& id, const std::string& name,
        const std::string& credentialHash, const std::string& ip,
        const std::string& clientType,
        const std::string& authorizationMode);
    bool approve(const std::string& id);
    bool deny(const std::string& id);
    bool revoke(const std::string& id);
    void revokeAll();
    std::string devicesJson() const;

private:
    struct PendingDevice {
        std::string id;
        std::string name;
        std::string credentialHash;
        std::string lastIp;
        std::chrono::steady_clock::time_point expiresAt;
        bool denied = false;
        std::string clientType = "ios";
        std::string authorizationMode = "direct_upload";
    };

    static std::string hashCredential(const std::string& credential);
    void saveLocked() const;
    void pruneLocked() const;

    std::string m_path;
    mutable std::mutex m_mutex;
    mutable std::vector<PendingDevice> m_pending;
    std::vector<TrustedDevice> m_trusted;
};
