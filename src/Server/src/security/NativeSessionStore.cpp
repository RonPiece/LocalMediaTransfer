#include "security/NativeSessionStore.hpp"

#include "ipc/PipeServer.hpp"
#include "security/PairingStore.hpp"

#include <algorithm>
#include <cctype>
#include <climits>
#include <iomanip>
#include <limits>
#include <openssl/crypto.h>
#include <openssl/evp.h>
#include <openssl/hmac.h>
#include <openssl/rand.h>
#include <spdlog/spdlog.h>
#include <sstream>
#include <winsock2.h>
#include <ws2tcpip.h>
#include <iphlpapi.h>

using json = nlohmann::json;

namespace {
constexpr size_t MaxPairingRequests = 5;
constexpr size_t MaxTransferRequests = 10;
constexpr size_t MaxTransferFiles = 1000;
constexpr unsigned long long MaxFileBytes = 100ULL * 1024ULL * 1024ULL * 1024ULL;
constexpr auto PairingLifetime = std::chrono::minutes(2);
constexpr auto TransferIdleLifetime = std::chrono::minutes(30);
constexpr auto TransferAbsoluteLifetime = std::chrono::hours(24);

void logNativeDiagnostic(const json& value) {
    // The payload is deliberately allow-listed at each call site. Never add
    // addresses, names, credentials, codes, pins, IDs, filenames, or manifests.
    spdlog::info("[native_windows_diagnostic] {}", value.dump());
    spdlog::default_logger()->flush();
}

std::string hmacHex(const std::string& key, const std::string& data) {
    unsigned char digest[EVP_MAX_MD_SIZE]{};
    unsigned int length = 0;
    if (!HMAC(EVP_sha256(), key.data(), static_cast<int>(key.size()),
            reinterpret_cast<const unsigned char*>(data.data()), data.size(),
            digest, &length)) {
        throw std::runtime_error("Unable to compute HMAC");
    }
    std::ostringstream output;
    output << std::hex << std::setfill('0');
    for (unsigned int index = 0; index < length; ++index) {
        output << std::setw(2) << static_cast<int>(digest[index]);
    }
    OPENSSL_cleanse(digest, sizeof(digest));
    return output.str();
}

std::string decodeHex(const std::string& value) {
    std::string output;
    output.reserve(value.size() / 2);
    for (size_t index = 0; index + 1 < value.size(); index += 2) {
        output.push_back(static_cast<char>(std::stoul(value.substr(index, 2), nullptr, 16)));
    }
    return output;
}

bool isLocalSubnetAddress(std::string ip) {
    if (ip.rfind("::ffff:", 0) == 0) ip = ip.substr(7);
    if (ip == "127.0.0.1" || ip == "::1") return true;
    IN_ADDR remote{};
    if (InetPtonA(AF_INET, ip.c_str(), &remote) != 1) return false;
    const uint32_t remoteHost = ntohl(remote.S_un.S_addr);
    const unsigned first = remoteHost >> 24;
    const unsigned second = (remoteHost >> 16) & 0xff;
    const bool privateAddress = first == 10 ||
        (first == 172 && second >= 16 && second <= 31) ||
        (first == 192 && second == 168) ||
        (first == 169 && second == 254);
    if (!privateAddress) return false;

    ULONG size = 0;
    GetAdaptersAddresses(AF_INET,
        GAA_FLAG_SKIP_DNS_SERVER | GAA_FLAG_SKIP_MULTICAST,
        nullptr, nullptr, &size);
    if (size == 0) return false;
    std::vector<unsigned char> storage(size);
    auto* adapters = reinterpret_cast<IP_ADAPTER_ADDRESSES*>(storage.data());
    if (GetAdaptersAddresses(AF_INET,
            GAA_FLAG_SKIP_DNS_SERVER | GAA_FLAG_SKIP_MULTICAST,
            nullptr, adapters, &size) != NO_ERROR) return false;
    for (auto* adapter = adapters; adapter; adapter = adapter->Next) {
        if (adapter->OperStatus != IfOperStatusUp ||
            adapter->IfType == IF_TYPE_SOFTWARE_LOOPBACK ||
            adapter->IfType == IF_TYPE_TUNNEL) continue;
        for (auto* address = adapter->FirstUnicastAddress; address;
             address = address->Next) {
            if (!address->Address.lpSockaddr ||
                address->Address.lpSockaddr->sa_family != AF_INET ||
                address->OnLinkPrefixLength > 32) continue;
            auto* local = reinterpret_cast<sockaddr_in*>(address->Address.lpSockaddr);
            const uint32_t localHost = ntohl(local->sin_addr.S_un.S_addr);
            const uint32_t mask = address->OnLinkPrefixLength == 0 ? 0 :
                0xffffffffu << (32 - address->OnLinkPrefixLength);
            if ((localHost & mask) == (remoteHost & mask)) return true;
        }
    }
    return false;
}
}

NativeSessionStore::NativeSessionStore(
    std::shared_ptr<PairingStore> pairingStore,
    std::shared_ptr<PipeServer> pipeServer,
    std::string serverId,
    std::string certificateFingerprint,
    std::string environment)
    : m_pairingStore(std::move(pairingStore))
    , m_pipeServer(std::move(pipeServer))
    , m_serverId(std::move(serverId))
    , m_certificateFingerprint(std::move(certificateFingerprint))
    , m_environment(std::move(environment))
    , m_grantMaster(randomHex(32)) {}

NativeSessionStore::~NativeSessionStore() {
    if (!m_grantMaster.empty()) {
        OPENSSL_cleanse(m_grantMaster.data(), m_grantMaster.size());
    }
}

NativeSessionStore::Result NativeSessionStore::error(
    int status, const std::string& code, const std::string& message,
    bool retryable) {
    return {status, json{{"error", code}, {"message", message},
        {"retryable", retryable}}};
}

std::string NativeSessionStore::randomHex(size_t bytes) {
    std::vector<unsigned char> buffer(bytes);
    if (RAND_bytes(buffer.data(), static_cast<int>(buffer.size())) != 1) {
        throw std::runtime_error("Secure random generation failed");
    }
    std::ostringstream output;
    output << std::hex << std::setfill('0');
    for (unsigned char value : buffer) output << std::setw(2) << static_cast<int>(value);
    OPENSSL_cleanse(buffer.data(), buffer.size());
    return output.str();
}

std::string NativeSessionStore::sha256Hex(const std::string& value) {
    unsigned char digest[EVP_MAX_MD_SIZE]{};
    unsigned int length = 0;
    EVP_MD_CTX* context = EVP_MD_CTX_new();
    if (!context || EVP_DigestInit_ex(context, EVP_sha256(), nullptr) != 1 ||
        EVP_DigestUpdate(context, value.data(), value.size()) != 1 ||
        EVP_DigestFinal_ex(context, digest, &length) != 1) {
        if (context) EVP_MD_CTX_free(context);
        throw std::runtime_error("Unable to compute SHA-256");
    }
    EVP_MD_CTX_free(context);
    std::ostringstream output;
    output << std::hex << std::setfill('0');
    for (unsigned int index = 0; index < length; ++index) {
        output << std::setw(2) << static_cast<int>(digest[index]);
    }
    OPENSSL_cleanse(digest, sizeof(digest));
    return output.str();
}

bool NativeSessionStore::constantTimeEqual(
    const std::string& left, const std::string& right) {
    return left.size() == right.size() && !left.empty() &&
        CRYPTO_memcmp(left.data(), right.data(), left.size()) == 0;
}

bool NativeSessionStore::isHex(const std::string& value, size_t length) {
    return value.size() == length &&
        std::all_of(value.begin(), value.end(), [](unsigned char character) {
            return std::isxdigit(character) != 0;
        });
}

bool NativeSessionStore::isSafeIdentifier(
    const std::string& value, size_t maxLength) {
    return !value.empty() && value.size() <= maxLength &&
        std::all_of(value.begin(), value.end(), [](unsigned char character) {
            return std::isalnum(character) != 0 || character == '-' ||
                character == '_' || character == '.';
        });
}

void NativeSessionStore::appendCanonical(
    std::string& output, const std::string& value) {
    const uint32_t length = static_cast<uint32_t>(value.size());
    output.push_back(static_cast<char>((length >> 24) & 0xff));
    output.push_back(static_cast<char>((length >> 16) & 0xff));
    output.push_back(static_cast<char>((length >> 8) & 0xff));
    output.push_back(static_cast<char>(length & 0xff));
    output.append(value);
}

std::string NativeSessionStore::computeSecurityCode(
    const std::string& environment, const std::string& serverId,
    const std::string& fingerprint, const std::string& clientId,
    const std::string& clientNonce, const std::string& requestId) {
    std::string canonical;
    for (const auto* value : {"LMT-WINDOWS-PAIR-V1", environment.c_str(),
            serverId.c_str(), fingerprint.c_str(), clientId.c_str(),
            clientNonce.c_str(), requestId.c_str()}) {
        appendCanonical(canonical, value);
    }
    const std::string digest = sha256Hex(canonical);
    const uint32_t prefix = static_cast<uint32_t>(std::stoul(digest.substr(0, 8), nullptr, 16));
    const uint32_t numeric = prefix % 100000000U;
    std::ostringstream code;
    code << std::setw(8) << std::setfill('0') << numeric;
    const std::string raw = code.str();
    return raw.substr(0, 4) + " " + raw.substr(4);
}

std::string NativeSessionStore::confirmationProof(
    const std::string& credential, const std::string& requestId,
    const std::string& clientNonce) {
    std::string canonical;
    appendCanonical(canonical, "LMT-WINDOWS-PAIR-CONFIRM-V1");
    appendCanonical(canonical, requestId);
    appendCanonical(canonical, clientNonce);
    std::string key = decodeHex(credential);
    const std::string proof = hmacHex(key, canonical);
    OPENSSL_cleanse(key.data(), key.size());
    return proof;
}

void NativeSessionStore::beginPairingWindow() {
    std::lock_guard lock(m_mutex);
    m_pairingWindowExpiresAt = std::chrono::steady_clock::now() + PairingLifetime;
    logNativeDiagnostic(json{{"event", "pairing_window_opened"}});
}

void NativeSessionStore::endPairingWindow() {
    std::lock_guard lock(m_mutex);
    m_pairingWindowExpiresAt = {};
    logNativeDiagnostic(json{{"event", "pairing_window_closed"}});
}

bool NativeSessionStore::pairingAvailable() const {
    std::lock_guard lock(m_mutex);
    return std::chrono::steady_clock::now() < m_pairingWindowExpiresAt;
}

json NativeSessionStore::identity() const {
    return json{
        {"protocolVersion", 1},
        {"serverId", m_serverId},
        {"environment", m_environment},
        {"certificateFingerprint", m_certificateFingerprint},
        {"pairingAvailable", pairingAvailable()}
    };
}

void NativeSessionStore::pruneLocked() {
    const auto now = std::chrono::steady_clock::now();
    for (auto it = m_pairings.begin(); it != m_pairings.end();) {
        if (now > it->second.expiresAt) {
            if (it->second.state == PairState::Pending ||
                it->second.state == PairState::Confirmed) {
                logNativeDiagnostic(json{{"event", "pairing_expired"}});
            }
            it = m_pairings.erase(it);
        } else ++it;
    }
    for (auto it = m_transfers.begin(); it != m_transfers.end();) {
        const bool pendingExpired = it->second.state == TransferState::Pending &&
            now > it->second.expiresAt;
        const bool activeExpired = it->second.state == TransferState::Approved &&
            (now - it->second.lastActivity > TransferIdleLifetime ||
             now - it->second.createdAt > TransferAbsoluteLifetime);
        if (pendingExpired || activeExpired ||
            it->second.state == TransferState::Cancelled) {
            if (pendingExpired || activeExpired) {
                logNativeDiagnostic(json{{"event", "transfer_expired"}});
            }
            it = m_transfers.erase(it);
        } else ++it;
    }
    for (auto& attempts : m_pairingAttempts) {
        attempts.second.erase(std::remove_if(attempts.second.begin(), attempts.second.end(),
            [now](auto time) { return now - time > std::chrono::minutes(10); }),
            attempts.second.end());
    }
}

bool NativeSessionStore::pairingRateLimitedLocked(const std::string& ip) {
    auto& attempts = m_pairingAttempts[ip];
    if (attempts.size() >= 5) return true;
    attempts.push_back(std::chrono::steady_clock::now());
    return false;
}

NativeSessionStore::Result NativeSessionStore::requestPairing(
    const json& body, const std::string& ip) {
    const std::string environment = body.value("environment", "");
    const std::string serverId = body.value("serverId", "");
    const std::string deviceId = body.value("clientId", "");
    const std::string deviceName = body.value("clientName", "Windows computer");
    const std::string nonce = body.value("clientNonce", "");
    const std::string credential = body.value("credential", "");
    if (!isLocalSubnetAddress(ip)) {
        return error(403, "source_not_local",
            "Windows pairing is limited to this computer's local subnets.");
    }
    if (body.value("protocolVersion", 0) != 1 || environment != m_environment ||
        serverId != m_serverId || !isSafeIdentifier(deviceId, 128) ||
        deviceName.empty() || deviceName.size() > 128 ||
        !isHex(nonce, 64) || !isHex(credential, 64)) {
        return error(400, "invalid_pairing_request", "The pairing request is invalid.");
    }

    std::lock_guard lock(m_mutex);
    pruneLocked();
    if (std::chrono::steady_clock::now() >= m_pairingWindowExpiresAt) {
        return error(403, "pairing_window_closed",
            "Windows pairing is not currently enabled.");
    }
    if (pairingRateLimitedLocked(ip)) {
        return error(429, "pairing_rate_limited",
            "Too many pairing requests. Try again later.", true);
    }
    if (m_pairings.size() >= MaxPairingRequests ||
        std::any_of(m_pairings.begin(), m_pairings.end(), [&](const auto& item) {
            return item.second.deviceId == deviceId;
        })) {
        return error(409, "pairing_already_pending",
            "A pairing request for this computer is already pending.");
    }

    PairingRequest request;
    request.requestId = randomHex(16);
    request.deviceId = deviceId;
    request.deviceName = deviceName;
    request.ip = ip;
    request.clientNonce = nonce;
    request.credentialHash = sha256Hex(credential);
    request.expectedProof = confirmationProof(credential, request.requestId, nonce);
    request.securityCode = computeSecurityCode(m_environment, m_serverId,
        m_certificateFingerprint, deviceId, nonce, request.requestId);
    request.expiresAt = std::chrono::steady_clock::now() + PairingLifetime;
    const std::string requestId = request.requestId;
    m_pairings.emplace(requestId, std::move(request));
    logNativeDiagnostic(json{{"event", "pairing_requested"}});
    return {202, json{{"requestId", requestId}, {"status", "pending"},
        {"expiresInSeconds", 120}, {"environment", m_environment}}};
}

NativeSessionStore::Result NativeSessionStore::confirmPairing(
    const std::string& requestId, const json& body) {
    const std::string proof = body.value("proof", "");
    std::lock_guard lock(m_mutex);
    pruneLocked();
    auto item = m_pairings.find(requestId);
    if (item == m_pairings.end()) {
        return error(404, "pairing_request_expired", "The pairing request has expired.");
    }
    if (!constantTimeEqual(proof, item->second.expectedProof)) {
        item->second.state = PairState::Denied;
        return error(403, "pairing_confirmation_rejected",
            "The pairing confirmation was rejected.");
    }
    item->second.state = PairState::Confirmed;
    logNativeDiagnostic(json{{"event", "pairing_confirmed"}});
    if (m_pipeServer) {
        m_pipeServer->sendNativePairingRequest(json{
            {"requestId", item->second.requestId},
            {"deviceId", item->second.deviceId},
            {"deviceName", item->second.deviceName},
            {"ip", item->second.ip},
            {"securityCode", item->second.securityCode}
        }.dump());
    }
    return {200, json{{"status", "confirmed"}, {"environment", m_environment}}};
}

NativeSessionStore::Result NativeSessionStore::pairingStatus(
    const std::string& requestId, const json& body) {
    const std::string deviceId = body.value("clientId", "");
    const std::string credential = body.value("credential", "");
    std::lock_guard lock(m_mutex);
    pruneLocked();
    auto item = m_pairings.find(requestId);
    if (item == m_pairings.end() || item->second.deviceId != deviceId ||
        !constantTimeEqual(item->second.credentialHash, sha256Hex(credential))) {
        return error(404, "pairing_request_expired", "The pairing request has expired.");
    }
    const char* status = item->second.state == PairState::Approved ? "approved" :
        item->second.state == PairState::Denied ? "denied" : "pending";
    return {item->second.state == PairState::Denied ? 403 : 200,
        json{{"status", status}, {"environment", m_environment}}};
}

bool NativeSessionStore::approvePairing(const std::string& requestId) {
    std::lock_guard lock(m_mutex);
    pruneLocked();
    auto item = m_pairings.find(requestId);
    if (item == m_pairings.end() || item->second.state != PairState::Confirmed) return false;
    if (!m_pairingStore->trustCredentialHash(item->second.deviceId,
            item->second.deviceName, item->second.credentialHash, item->second.ip,
            "windows", "approval_required")) return false;
    item->second.state = PairState::Approved;
    logNativeDiagnostic(json{{"event", "pairing_approved"}});
    return true;
}

bool NativeSessionStore::denyPairing(const std::string& requestId) {
    std::lock_guard lock(m_mutex);
    auto item = m_pairings.find(requestId);
    if (item == m_pairings.end()) return false;
    item->second.state = PairState::Denied;
    logNativeDiagnostic(json{{"event", "pairing_denied"}});
    return true;
}

NativeSessionStore::Result NativeSessionStore::requestTransfer(
    const json& body, const std::string& credential, const std::string& ip) {
    if (!isLocalSubnetAddress(ip)) {
        return error(403, "source_not_local",
            "Native Windows transfer is limited to local subnets.");
    }
    auto device = m_pairingStore->findDeviceByCredential(credential);
    if (!device || device->clientType != "windows" ||
        device->authorizationMode != "approval_required") {
        return error(401, "credential_rejected", "The trusted-device credential was rejected.");
    }
    const std::string clientSessionId = body.value("clientSessionId", "");
    if (body.value("protocolVersion", 0) != 1 ||
        clientSessionId.size() != 36 || clientSessionId.rfind("win-", 0) != 0 ||
        !isHex(clientSessionId.substr(4), 32) ||
        !body.contains("files") || !body["files"].is_array() ||
        body["files"].empty() || body["files"].size() > MaxTransferFiles) {
        return error(400, "invalid_transfer_request", "The transfer manifest is invalid.");
    }

    TransferRequest request;
    request.requestId = randomHex(16);
    request.transferId = clientSessionId.substr(4);
    request.deviceId = device->id;
    request.deviceName = device->name;
    request.ip = ip;
    request.skipExactDuplicates = body.value("skipExactDuplicates", true);
    unsigned long long totalBytes = 0;
    for (const auto& value : body["files"]) {
        TransferFile file{value.value("fileId", ""), value.value("name", ""),
            value.value("sizeBytes", 0ULL), false};
        if (!isSafeIdentifier(file.fileId, 128) ||
            file.fileId.rfind(clientSessionId + "-", 0) != 0 || file.name.empty() ||
            file.name.size() > 200 || file.sizeBytes == 0 || file.sizeBytes > MaxFileBytes ||
            totalBytes > std::numeric_limits<unsigned long long>::max() - file.sizeBytes ||
            std::any_of(request.files.begin(), request.files.end(), [&](const auto& existing) {
                return existing.fileId == file.fileId;
            })) {
            return error(400, "invalid_transfer_manifest", "A transfer file entry is invalid.");
        }
        totalBytes += file.sizeBytes;
        request.files.push_back(std::move(file));
    }

    std::lock_guard lock(m_mutex);
    pruneLocked();
    if (m_transfers.size() >= MaxTransferRequests ||
        std::any_of(m_transfers.begin(), m_transfers.end(), [&](const auto& item) {
            return item.second.deviceId == device->id &&
                item.second.state == TransferState::Pending;
        })) {
        return error(409, "transfer_already_pending",
            "A transfer request from this computer is already pending.");
    }
    request.createdAt = request.lastActivity = std::chrono::steady_clock::now();
    request.expiresAt = request.createdAt + PairingLifetime;
    std::string tokenMaterial;
    appendCanonical(tokenMaterial, "LMT-WINDOWS-TRANSFER-GRANT-V1");
    appendCanonical(tokenMaterial, request.requestId);
    appendCanonical(tokenMaterial, request.transferId);
    appendCanonical(tokenMaterial, request.deviceId);
    const std::string token = hmacHex(m_grantMaster, tokenMaterial);
    request.tokenHash = sha256Hex(token);
    const std::string requestId = request.requestId;
    const std::string transferId = request.transferId;

    json names = json::array();
    for (size_t index = 0; index < std::min<size_t>(5, request.files.size()); ++index) {
        names.push_back(request.files[index].name);
    }
    const std::string displaySummary = json{
            {"requestId", requestId}, {"deviceId", request.deviceId},
            {"deviceName", request.deviceName}, {"ip", ip},
            {"fileCount", request.files.size()}, {"totalBytes", totalBytes},
            {"sampleNames", names}
        }.dump();
    m_transfers.emplace(requestId, std::move(request));
    logNativeDiagnostic(json{{"event", "transfer_requested"},
        {"fileCount", body["files"].size()}, {"totalBytes", totalBytes}});
    // Publish only after the request is addressable by an immediate GUI
    // approval command. The pipe consumer may respond before this HTTP request
    // has returned to the sender.
    if (m_pipeServer) m_pipeServer->sendNativeTransferRequest(displaySummary);
    return {202, json{{"requestId", requestId}, {"transferId", transferId},
        {"status", "pending"}, {"expiresInSeconds", 120}}};
}

std::optional<std::string> NativeSessionStore::transferTokenLocked(
    const TransferRequest& transfer) const {
    std::string material;
    appendCanonical(material, "LMT-WINDOWS-TRANSFER-GRANT-V1");
    appendCanonical(material, transfer.requestId);
    appendCanonical(material, transfer.transferId);
    appendCanonical(material, transfer.deviceId);
    const std::string token = hmacHex(m_grantMaster, material);
    return constantTimeEqual(sha256Hex(token), transfer.tokenHash)
        ? std::optional<std::string>(token) : std::nullopt;
}

NativeSessionStore::Result NativeSessionStore::transferStatus(
    const std::string& requestId, const std::string& credential) {
    auto device = m_pairingStore->findDeviceByCredential(credential);
    if (!device) return error(401, "credential_rejected", "The trusted-device credential was rejected.");
    std::lock_guard lock(m_mutex);
    pruneLocked();
    auto item = m_transfers.find(requestId);
    if (item == m_transfers.end() || item->second.deviceId != device->id) {
        return error(404, "transfer_request_expired", "The transfer request has expired.");
    }
    if (item->second.state == TransferState::Denied) {
        return error(403, "transfer_denied", "The receiver declined the transfer.");
    }
    if (item->second.state != TransferState::Approved) {
        return {200, json{{"status", "pending"}}};
    }
    auto token = transferTokenLocked(item->second);
    if (!token) return error(500, "grant_unavailable", "The transfer grant is unavailable.");
    return {200, json{{"status", "approved"},
        {"transferId", item->second.transferId}, {"token", *token}}};
}

bool NativeSessionStore::approveTransfer(const std::string& requestId) {
    std::lock_guard lock(m_mutex);
    pruneLocked();
    auto item = m_transfers.find(requestId);
    if (item == m_transfers.end() || item->second.state != TransferState::Pending) return false;
    item->second.state = TransferState::Approved;
    item->second.lastActivity = std::chrono::steady_clock::now();
    logNativeDiagnostic(json{{"event", "transfer_approved"}});
    return true;
}

bool NativeSessionStore::denyTransfer(const std::string& requestId) {
    std::lock_guard lock(m_mutex);
    auto item = m_transfers.find(requestId);
    if (item == m_transfers.end()) return false;
    item->second.state = TransferState::Denied;
    logNativeDiagnostic(json{{"event", "transfer_denied"}});
    return true;
}

bool NativeSessionStore::authorizeTransfer(
    const std::string& token, const std::string& transferId) {
    if (!isHex(token, 64) || !isHex(transferId, 32)) return false;
    std::lock_guard lock(m_mutex);
    pruneLocked();
    auto item = std::find_if(m_transfers.begin(), m_transfers.end(), [&](const auto& value) {
        return value.second.transferId == transferId &&
            value.second.state == TransferState::Approved &&
            constantTimeEqual(value.second.tokenHash, sha256Hex(token));
    });
    if (item == m_transfers.end()) return false;
    item->second.lastActivity = std::chrono::steady_clock::now();
    return true;
}

bool NativeSessionStore::authorizeFile(
    const std::string& token, const std::string& transferId,
    const std::string& fileId, const std::string& name,
    unsigned long long sizeBytes, bool skipExactDuplicates) {
    std::lock_guard lock(m_mutex);
    pruneLocked();
    auto transfer = std::find_if(m_transfers.begin(), m_transfers.end(), [&](const auto& value) {
        return value.second.transferId == transferId &&
            value.second.state == TransferState::Approved &&
            constantTimeEqual(value.second.tokenHash, sha256Hex(token));
    });
    if (transfer == m_transfers.end() ||
        transfer->second.skipExactDuplicates != skipExactDuplicates) return false;
    auto file = std::find_if(transfer->second.files.begin(), transfer->second.files.end(),
        [&](const auto& value) {
            return value.fileId == fileId && value.name == name &&
                value.sizeBytes == sizeBytes;
        });
    if (file == transfer->second.files.end()) return false;
    transfer->second.lastActivity = std::chrono::steady_clock::now();
    return true;
}

void NativeSessionStore::markFileTerminal(
    const std::string& transferId, const std::string& fileId) {
    std::lock_guard lock(m_mutex);
    auto transfer = std::find_if(m_transfers.begin(), m_transfers.end(), [&](const auto& value) {
        return value.second.transferId == transferId;
    });
    if (transfer == m_transfers.end()) return;
    auto file = std::find_if(transfer->second.files.begin(), transfer->second.files.end(),
        [&](const auto& value) { return value.fileId == fileId; });
    if (file != transfer->second.files.end()) file->terminal = true;
    // Keep a completed grant alive until the sender performs authenticated
    // cleanup. This preserves idempotent final-chunk retries when the response
    // is lost after the receiver has committed the file.
}

NativeSessionStore::Result NativeSessionStore::cancelTransfer(
    const std::string& transferId, const std::string& token) {
    std::lock_guard lock(m_mutex);
    auto item = std::find_if(m_transfers.begin(), m_transfers.end(), [&](const auto& value) {
        return value.second.transferId == transferId &&
            constantTimeEqual(value.second.tokenHash, sha256Hex(token));
    });
    if (item == m_transfers.end()) {
        return error(401, "transfer_grant_rejected", "The transfer grant was rejected.");
    }
    item->second.state = TransferState::Cancelled;
    logNativeDiagnostic(json{{"event", "transfer_cancelled"}});
    return {200, json{{"ok", true}}};
}

void NativeSessionStore::revokeDevice(const std::string& deviceId) {
    std::lock_guard lock(m_mutex);
    for (auto& item : m_transfers) {
        if (item.second.deviceId == deviceId) item.second.state = TransferState::Cancelled;
    }
    logNativeDiagnostic(json{{"event", "device_revoked"}});
}

void NativeSessionStore::revokeAll() {
    std::lock_guard lock(m_mutex);
    m_pairings.clear();
    m_transfers.clear();
    m_pairingWindowExpiresAt = {};
    logNativeDiagnostic(json{{"event", "all_devices_revoked"}});
}
