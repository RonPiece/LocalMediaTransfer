#include "ipc/ServerOwnership.hpp"

#include <array>
#include <cctype>
#include <limits>
#include <sstream>
#include <utility>

#include <nlohmann/json.hpp>
#include <openssl/crypto.h>
#include <openssl/evp.h>
#include <openssl/hmac.h>
#include <openssl/rand.h>

#ifdef _WIN32
#include <windows.h>
#endif

using json = nlohmann::json;

namespace {

constexpr int ProtocolVersion = 1;
constexpr size_t ControlKeyBytes = 32;
constexpr size_t NonceBytes = 16;
constexpr auto ChallengeLifetime = std::chrono::seconds(15);

bool isHex(const std::string& value, size_t expectedLength) {
    if (value.size() != expectedLength) return false;
    for (const unsigned char character : value) {
        if (!std::isxdigit(character)) return false;
    }
    return true;
}

std::vector<unsigned char> decodeHex(const std::string& value) {
    std::vector<unsigned char> result;
    result.reserve(value.size() / 2);
    for (size_t index = 0; index < value.size(); index += 2) {
        result.push_back(static_cast<unsigned char>(
            std::stoul(value.substr(index, 2), nullptr, 16)));
    }
    return result;
}

std::string encodeHex(const unsigned char* bytes, size_t size) {
    static constexpr char Hex[] = "0123456789abcdef";
    std::string result;
    result.reserve(size * 2);
    for (size_t index = 0; index < size; ++index) {
        result.push_back(Hex[bytes[index] >> 4]);
        result.push_back(Hex[bytes[index] & 0x0f]);
    }
    return result;
}

std::string generateNonce() {
    std::array<unsigned char, NonceBytes> bytes{};
    if (RAND_priv_bytes(bytes.data(), static_cast<int>(bytes.size())) != 1) {
        return {};
    }
    return encodeHex(bytes.data(), bytes.size());
}

std::string sha256Hex(const std::vector<unsigned char>& data) {
    std::array<unsigned char, EVP_MAX_MD_SIZE> digest{};
    unsigned int digestLength = 0;
    if (EVP_Digest(
            data.data(),
            data.size(),
            digest.data(),
            &digestLength,
            EVP_sha256(),
            nullptr) != 1) {
        return {};
    }
    return encodeHex(digest.data(), digestLength);
}

} // namespace

ServerOwnershipController::ServerOwnershipController(
    ServerOwnershipIdentity identity,
    const std::string& controlTokenHex)
    : m_identity(std::move(identity)) {
    if (isValidControlToken(controlTokenHex)) {
        m_controlKey = decodeHex(controlTokenHex);
        m_credentialId = sha256Hex(m_controlKey);
    }
}

ServerOwnershipController::~ServerOwnershipController() {
    if (!m_controlKey.empty()) {
        OPENSSL_cleanse(m_controlKey.data(), m_controlKey.size());
    }
}

bool ServerOwnershipController::enabled() const {
    return m_controlKey.size() == ControlKeyBytes && !m_credentialId.empty();
}

bool ServerOwnershipController::isValidControlToken(const std::string& tokenHex) {
    return isHex(tokenHex, ControlKeyBytes * 2);
}

uint64_t ServerOwnershipController::currentProcessStartTimeUtcFileTime() {
#ifdef _WIN32
    FILETIME creation{}, exit{}, kernel{}, user{};
    if (!GetProcessTimes(GetCurrentProcess(), &creation, &exit, &kernel, &user)) {
        return 0;
    }
    ULARGE_INTEGER value{};
    value.LowPart = creation.dwLowDateTime;
    value.HighPart = creation.dwHighDateTime;
    return value.QuadPart;
#else
    return 0;
#endif
}

std::optional<ServerOwnershipResponse> ServerOwnershipController::handleProbe(
    const std::string& dataJson) {
    if (!enabled()) return std::nullopt;

    try {
        const json request = json::parse(dataJson);
        if (request.value("protocolVersion", 0) != ProtocolVersion) {
            return std::nullopt;
        }
        const std::string clientNonce = request.value("clientNonce", "");
        if (!isHex(clientNonce, NonceBytes * 2)) return std::nullopt;

        const std::string serverNonce = generateNonce();
        if (serverNonce.empty()) return std::nullopt;

        {
            std::lock_guard<std::mutex> lock(m_mutex);
            m_pendingChallenge = PendingChallenge{
                clientNonce,
                serverNonce,
                std::chrono::steady_clock::now() + ChallengeLifetime};
        }

        const json response = {
            {"protocolVersion", ProtocolVersion},
            {"serverProcessId", m_identity.serverProcessId},
            {"serverProcessStartTimeUtcFileTime",
                std::to_string(m_identity.serverProcessStartTimeUtcFileTime)},
            {"ownerProcessId", m_identity.ownerProcessId},
            {"ownerProcessStartTimeUtcFileTime",
                std::to_string(m_identity.ownerProcessStartTimeUtcFileTime)},
            {"environment", m_identity.environment},
            {"runtimeInstanceId", m_identity.runtimeInstanceId},
            {"controlInstanceId", m_identity.controlInstanceId},
            {"pipeName", m_identity.pipeName},
            {"clientNonce", clientNonce},
            {"serverNonce", serverNonce},
            {"credentialId", m_credentialId},
            {"proof", computeHmacHex(proofPayload(clientNonce, serverNonce))}
        };
        return ServerOwnershipResponse{"ownership_proof", response.dump()};
    } catch (...) {
        return std::nullopt;
    }
}

bool ServerOwnershipController::authorizeShutdown(const std::string& dataJson) {
    if (!enabled()) return false;

    try {
        const json request = json::parse(dataJson);
        if (request.value("protocolVersion", 0) != ProtocolVersion) return false;
        const std::string clientNonce = request.value("clientNonce", "");
        const std::string serverNonce = request.value("serverNonce", "");
        const std::string authorization = request.value("authorization", "");

        std::lock_guard<std::mutex> lock(m_mutex);
        if (!m_pendingChallenge ||
            std::chrono::steady_clock::now() > m_pendingChallenge->expiresAt ||
            clientNonce != m_pendingChallenge->clientNonce ||
            serverNonce != m_pendingChallenge->serverNonce) {
            m_pendingChallenge.reset();
            return false;
        }

        const bool authorized = verifyHmac(
            shutdownPayload(clientNonce, serverNonce),
            authorization);
        if (authorized) m_pendingChallenge.reset();
        return authorized;
    } catch (...) {
        return false;
    }
}

std::optional<ServerOwnershipResponse>
ServerOwnershipController::authenticateSession(const std::string& dataJson) {
    if (!enabled()) return std::nullopt;

    try {
        const json request = json::parse(dataJson);
        if (request.value("protocolVersion", 0) != ProtocolVersion) {
            return std::nullopt;
        }

        const std::string clientNonce = request.value("clientNonce", "");
        const std::string authorization = request.value("authorization", "");
        if (!isHex(clientNonce, NonceBytes * 2) ||
            request.value("ownerProcessId", 0U) != m_identity.ownerProcessId ||
            request.value("ownerProcessStartTimeUtcFileTime", "") !=
                std::to_string(m_identity.ownerProcessStartTimeUtcFileTime) ||
            request.value("environment", "") != m_identity.environment ||
            request.value("runtimeInstanceId", "") != m_identity.runtimeInstanceId ||
            request.value("controlInstanceId", "") != m_identity.controlInstanceId ||
            request.value("pipeName", "") != m_identity.pipeName ||
            !verifyHmac(sessionRequestPayload(clientNonce), authorization)) {
            return std::nullopt;
        }

        const std::string serverNonce = generateNonce();
        if (serverNonce.empty()) return std::nullopt;

        const json response = {
            {"protocolVersion", ProtocolVersion},
            {"serverProcessId", m_identity.serverProcessId},
            {"serverProcessStartTimeUtcFileTime",
                std::to_string(m_identity.serverProcessStartTimeUtcFileTime)},
            {"ownerProcessId", m_identity.ownerProcessId},
            {"ownerProcessStartTimeUtcFileTime",
                std::to_string(m_identity.ownerProcessStartTimeUtcFileTime)},
            {"environment", m_identity.environment},
            {"runtimeInstanceId", m_identity.runtimeInstanceId},
            {"controlInstanceId", m_identity.controlInstanceId},
            {"pipeName", m_identity.pipeName},
            {"clientNonce", clientNonce},
            {"serverNonce", serverNonce},
            {"credentialId", m_credentialId},
            {"proof", computeHmacHex(
                sessionProofPayload(clientNonce, serverNonce))}
        };
        return ServerOwnershipResponse{"session_ready", response.dump()};
    } catch (...) {
        return std::nullopt;
    }
}

std::string ServerOwnershipController::proofPayload(
    const std::string& clientNonce,
    const std::string& serverNonce) const {
    std::ostringstream output;
    output << "lmt-ownership-proof-v1\n"
           << clientNonce << '\n'
           << serverNonce << '\n'
           << m_identity.serverProcessId << '\n'
           << m_identity.serverProcessStartTimeUtcFileTime << '\n'
           << m_identity.ownerProcessId << '\n'
           << m_identity.ownerProcessStartTimeUtcFileTime << '\n'
           << m_identity.environment << '\n'
           << m_identity.runtimeInstanceId << '\n'
           << m_identity.controlInstanceId << '\n'
           << m_identity.pipeName << '\n'
           << m_credentialId;
    return output.str();
}

std::string ServerOwnershipController::shutdownPayload(
    const std::string& clientNonce,
    const std::string& serverNonce) const {
    std::ostringstream output;
    output << "lmt-shutdown-v1\n"
           << clientNonce << '\n'
           << serverNonce << '\n'
           << m_identity.serverProcessId << '\n'
           << m_identity.serverProcessStartTimeUtcFileTime << '\n'
           << m_identity.environment << '\n'
           << m_identity.runtimeInstanceId << '\n'
           << m_identity.controlInstanceId << '\n'
           << m_identity.pipeName;
    return output.str();
}

std::string ServerOwnershipController::sessionRequestPayload(
    const std::string& clientNonce) const {
    std::ostringstream output;
    output << "lmt-pipe-session-request-v1\n"
           << clientNonce << '\n'
           << m_identity.ownerProcessId << '\n'
           << m_identity.ownerProcessStartTimeUtcFileTime << '\n'
           << m_identity.environment << '\n'
           << m_identity.runtimeInstanceId << '\n'
           << m_identity.controlInstanceId << '\n'
           << m_identity.pipeName;
    return output.str();
}

std::string ServerOwnershipController::sessionProofPayload(
    const std::string& clientNonce,
    const std::string& serverNonce) const {
    std::ostringstream output;
    output << "lmt-pipe-session-proof-v1\n"
           << clientNonce << '\n'
           << serverNonce << '\n'
           << m_identity.serverProcessId << '\n'
           << m_identity.serverProcessStartTimeUtcFileTime << '\n'
           << m_identity.ownerProcessId << '\n'
           << m_identity.ownerProcessStartTimeUtcFileTime << '\n'
           << m_identity.environment << '\n'
           << m_identity.runtimeInstanceId << '\n'
           << m_identity.controlInstanceId << '\n'
           << m_identity.pipeName << '\n'
           << m_credentialId;
    return output.str();
}

std::string ServerOwnershipController::computeHmacHex(const std::string& payload) const {
    std::array<unsigned char, EVP_MAX_MD_SIZE> digest{};
    unsigned int digestLength = 0;
    if (!HMAC(
            EVP_sha256(),
            m_controlKey.data(),
            static_cast<int>(m_controlKey.size()),
            reinterpret_cast<const unsigned char*>(payload.data()),
            payload.size(),
            digest.data(),
            &digestLength)) {
        return {};
    }
    return encodeHex(digest.data(), digestLength);
}

bool ServerOwnershipController::verifyHmac(
    const std::string& payload,
    const std::string& suppliedHex) const {
    if (!isHex(suppliedHex, 64)) return false;
    const std::vector<unsigned char> supplied = decodeHex(suppliedHex);
    const std::vector<unsigned char> expected = decodeHex(computeHmacHex(payload));
    return supplied.size() == expected.size() &&
        CRYPTO_memcmp(supplied.data(), expected.data(), expected.size()) == 0;
}
