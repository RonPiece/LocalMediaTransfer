#include "security/PairingStore.hpp"

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <openssl/sha.h>
#include <nlohmann/json.hpp>
#include <windows.h>

using json = nlohmann::json;

namespace {
long long unixNow() {
    return std::chrono::duration_cast<std::chrono::seconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
}
}

PairingStore::PairingStore(std::string path) : m_path(std::move(path)) {}

std::string PairingStore::hashCredential(const std::string& credential) {
    unsigned char digest[SHA256_DIGEST_LENGTH];
    SHA256(reinterpret_cast<const unsigned char*>(credential.data()), credential.size(), digest);
    static constexpr char hex[] = "0123456789abcdef";
    std::string result(SHA256_DIGEST_LENGTH * 2, '0');
    for (size_t i = 0; i < SHA256_DIGEST_LENGTH; ++i) {
        result[i * 2] = hex[digest[i] >> 4];
        result[i * 2 + 1] = hex[digest[i] & 0xf];
    }
    return result;
}

void PairingStore::load() {
    std::lock_guard lock(m_mutex);
    m_trusted.clear();
    std::ifstream input(m_path);
    if (!input) return;
    try {
        const auto root = json::parse(input);
        for (const auto& value : root.value("devices", json::array())) {
            m_trusted.push_back({
                value.value("id", ""), value.value("name", "iPhone"),
                value.value("credentialHash", ""), value.value("lastIp", ""),
                value.value("lastSeenUnix", 0LL),
                value.value("clientType", "ios"),
                value.value("authorizationMode", "direct_upload")});
        }
    } catch (...) {
        m_trusted.clear();
    }
}

void PairingStore::pruneLocked() const {
    const auto now = std::chrono::steady_clock::now();
    m_pending.erase(std::remove_if(m_pending.begin(), m_pending.end(), [now](const PendingDevice& item) {
        return item.expiresAt < now;
    }), m_pending.end());
}

PairingStore::Status PairingStore::request(
    const std::string& id, const std::string& name, const std::string& credential,
    const std::string& ip, bool autoApproveKnown) {
    if (id.empty() || credential.size() < 32 || id.size() > 128 || name.size() > 128) {
        return Status::Denied;
    }
    std::lock_guard lock(m_mutex);
    pruneLocked();
    const auto hash = hashCredential(credential);
    auto trusted = std::find_if(m_trusted.begin(), m_trusted.end(), [&](const auto& item) {
        return item.id == id && item.credentialHash == hash;
    });
    if (trusted != m_trusted.end()) {
        trusted->name = name;
        trusted->lastIp = ip;
        trusted->lastSeenUnix = unixNow();
        saveLocked();
        if (autoApproveKnown) return Status::Approved;
        auto pending = std::find_if(m_pending.begin(), m_pending.end(), [&](const auto& item) { return item.id == id; });
        if (pending == m_pending.end()) {
            m_pending.push_back({id, name, hash, ip,
                std::chrono::steady_clock::now() + std::chrono::minutes(2), false,
                trusted->clientType, trusted->authorizationMode});
        }
        return Status::Pending;
    }
    auto pending = std::find_if(m_pending.begin(), m_pending.end(), [&](const auto& item) {
        return item.id == id;
    });
    if (pending == m_pending.end()) {
        m_pending.push_back({id, name, hash, ip,
            std::chrono::steady_clock::now() + std::chrono::minutes(2), false,
            "ios", "direct_upload"});
        return Status::Pending;
    }
    if (pending->credentialHash != hash) {
        pending->name = name;
        pending->credentialHash = hash;
        pending->lastIp = ip;
        pending->expiresAt = std::chrono::steady_clock::now() + std::chrono::minutes(2);
        pending->denied = false;
        return Status::Pending;
    }
    return pending->denied ? Status::Denied : Status::Pending;
}

PairingStore::Status PairingStore::status(const std::string& id, const std::string& credential) const {
    std::lock_guard lock(m_mutex);
    pruneLocked();
    const auto hash = hashCredential(credential);
    auto pending = std::find_if(m_pending.begin(), m_pending.end(), [&](const auto& item) {
        return item.id == id && item.credentialHash == hash;
    });
    if (pending != m_pending.end()) return pending->denied ? Status::Denied : Status::Pending;
    if (std::any_of(m_trusted.begin(), m_trusted.end(), [&](const auto& item) {
            return item.id == id && item.credentialHash == hash;
        })) return Status::Approved;
    return Status::Denied;
}

bool PairingStore::validateCredential(const std::string& credential) const {
    if (credential.empty()) return false;
    const auto hash = hashCredential(credential);
    std::lock_guard lock(m_mutex);
    return std::any_of(m_trusted.begin(), m_trusted.end(), [&](const auto& item) {
        return item.credentialHash == hash &&
            item.authorizationMode == "direct_upload";
    });
}

std::optional<TrustedDevice> PairingStore::findDeviceByCredential(
    const std::string& credential) const {
    if (credential.empty()) return std::nullopt;
    const auto hash = hashCredential(credential);
    std::lock_guard lock(m_mutex);
    auto item = std::find_if(m_trusted.begin(), m_trusted.end(),
        [&](const auto& value) { return value.credentialHash == hash; });
    return item == m_trusted.end() ? std::nullopt
                                   : std::optional<TrustedDevice>(*item);
}

bool PairingStore::trustCredentialHash(
    const std::string& id,
    const std::string& name,
    const std::string& credentialHash,
    const std::string& ip,
    const std::string& clientType,
    const std::string& authorizationMode) {
    if (id.empty() || id.size() > 128 || name.size() > 128 ||
        credentialHash.size() != SHA256_DIGEST_LENGTH * 2 ||
        clientType != "windows" || authorizationMode != "approval_required") {
        return false;
    }
    std::lock_guard lock(m_mutex);
    m_trusted.erase(std::remove_if(m_trusted.begin(), m_trusted.end(),
        [&](const auto& value) { return value.id == id; }), m_trusted.end());
    m_trusted.push_back({id, name, credentialHash, ip, unixNow(),
        clientType, authorizationMode});
    saveLocked();
    return true;
}

bool PairingStore::approve(const std::string& id) {
    std::lock_guard lock(m_mutex);
    pruneLocked();
    auto item = std::find_if(m_pending.begin(), m_pending.end(), [&](const auto& value) { return value.id == id; });
    if (item == m_pending.end()) return false;
    m_trusted.erase(std::remove_if(m_trusted.begin(), m_trusted.end(), [&](const auto& value) { return value.id == id; }), m_trusted.end());
    m_trusted.push_back({item->id, item->name, item->credentialHash, item->lastIp,
        unixNow(), item->clientType, item->authorizationMode});
    m_pending.erase(item);
    saveLocked();
    return true;
}

bool PairingStore::deny(const std::string& id) {
    std::lock_guard lock(m_mutex);
    auto item = std::find_if(m_pending.begin(), m_pending.end(), [&](const auto& value) { return value.id == id; });
    if (item == m_pending.end()) return false;
    item->denied = true;
    return true;
}

bool PairingStore::revoke(const std::string& id) {
    std::lock_guard lock(m_mutex);
    const auto oldSize = m_trusted.size();
    m_trusted.erase(std::remove_if(m_trusted.begin(), m_trusted.end(),
        [&](const auto& value) { return value.id == id; }), m_trusted.end());
    if (m_trusted.size() == oldSize) return false;
    saveLocked();
    return true;
}

void PairingStore::revokeAll() {
    std::lock_guard<std::mutex> lock(m_mutex);
    m_trusted.clear();
    m_pending.clear();
    saveLocked();
}

std::string PairingStore::devicesJson() const {
    std::lock_guard lock(m_mutex);
    json devices = json::array();
    for (const auto& item : m_trusted) {
        devices.push_back({{"id", item.id}, {"name", item.name},
            {"lastIp", item.lastIp}, {"lastSeenUnix", item.lastSeenUnix},
            {"clientType", item.clientType},
            {"authorizationMode", item.authorizationMode}});
    }
    return devices.dump();
}

void PairingStore::saveLocked() const {
    const std::filesystem::path path(m_path);
    std::filesystem::create_directories(path.parent_path());
    json devices = json::array();
    for (const auto& item : m_trusted) {
        devices.push_back({{"id", item.id}, {"name", item.name},
            {"credentialHash", item.credentialHash}, {"lastIp", item.lastIp},
            {"lastSeenUnix", item.lastSeenUnix},
            {"clientType", item.clientType},
            {"authorizationMode", item.authorizationMode}});
    }
    const auto temp = path.string() + ".tmp";
    { std::ofstream output(temp, std::ios::trunc); output << json{{"version", 2}, {"devices", devices}}.dump(2); }
    if (!MoveFileExW(std::filesystem::path(temp).c_str(), path.c_str(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
        std::error_code ec;
        std::filesystem::remove(temp, ec);
        throw std::runtime_error("Unable to persist trusted devices");
    }
}
