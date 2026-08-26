/**
 * HTTP Server Implementation
 * 
 * Uses Crow framework for high-performance HTTP handling.
 * Ported from legacy Python Flask server with full feature parity.
 */

#include "server/HttpServer.hpp"
#include "security/PairingStore.hpp"
#include "security/NativeSessionStore.hpp"
#include "io/FileWriter.hpp"
#include "io/HashEngine.hpp"
#include "ipc/PipeServer.hpp"
#include "stats/MetricsCollector.hpp"
#include "benchmark/BenchmarkStore.hpp"
#include "history/TransferHistoryStore.hpp"
#include "common/Version.hpp"

// Crow HTTP framework (vcpkg)
#include <crow.h>

#include <spdlog/spdlog.h>
#include <nlohmann/json.hpp>

#include <filesystem>
#include <fstream>
#include <sstream>
#include <ctime>
#include <regex>
#include <cctype>
#include <iomanip>
#include <memory>
#include <vector>
#include <cmath>
#include <algorithm>
#include <future>
#include <thread>

#include <openssl/evp.h>
#include <openssl/crypto.h>
#include <openssl/ssl.h>

using json = nlohmann::json;
namespace fs = std::filesystem;

static std::vector<unsigned char> decodeBase64(const std::string& encoded) {
    if (encoded.empty()) return {};
    // Keep input immutable; EVP_DecodeUpdate ignores wrapped whitespace.
    std::vector<unsigned char> decoded(encoded.size());

    EVP_ENCODE_CTX* ctx = EVP_ENCODE_CTX_new();
    if (!ctx) throw std::runtime_error("Failed to allocate EVP_ENCODE_CTX");

    EVP_DecodeInit(ctx);

    int outl = 0, outl2 = 0;
    int res = EVP_DecodeUpdate(ctx, decoded.data(), &outl,
        reinterpret_cast<const unsigned char*>(encoded.data()), static_cast<int>(encoded.size()));

    if (res < 0) {
        EVP_ENCODE_CTX_free(ctx);
        throw std::invalid_argument("Invalid base64 chunk");
    }

    int final_res = EVP_DecodeFinal(ctx, decoded.data() + outl, &outl2);
    EVP_ENCODE_CTX_free(ctx);

    if (final_res < 0) {
        throw std::invalid_argument("Invalid base64 chunk padding/length");
    }

    decoded.resize(outl + outl2);
    return decoded;
}

// ─── Helper: get MIME type from file extension ───
static std::string getMimeType(const std::string& ext) {
    if (ext == ".html" || ext == ".htm") return "text/html; charset=utf-8";
    if (ext == ".css") return "text/css; charset=utf-8";
    if (ext == ".js")  return "application/javascript";
    if (ext == ".json") return "application/json; charset=utf-8";
    if (ext == ".png") return "image/png";
    if (ext == ".jpg" || ext == ".jpeg") return "image/jpeg";
    if (ext == ".gif") return "image/gif";
    if (ext == ".svg") return "image/svg+xml";
    if (ext == ".ico") return "image/x-icon";
    if (ext == ".woff") return "font/woff";
    if (ext == ".woff2") return "font/woff2";
    if (ext == ".ttf") return "font/ttf";
    return "application/octet-stream";
}

// ─── Helper: decode URL-encoded header values (encodeURIComponent-compatible) ───
static std::string urlDecode(const std::string& input) {
    std::string out;
    out.reserve(input.size());

    for (size_t i = 0; i < input.size(); ++i) {
        unsigned char c = static_cast<unsigned char>(input[i]);
        if (c == '%' && i + 2 < input.size()) {
            unsigned char h1 = static_cast<unsigned char>(input[i + 1]);
            unsigned char h2 = static_cast<unsigned char>(input[i + 2]);
            if (std::isxdigit(h1) && std::isxdigit(h2)) {
                auto hexToNibble = [](unsigned char ch) -> int {
                    if (ch >= '0' && ch <= '9') return ch - '0';
                    if (ch >= 'a' && ch <= 'f') return 10 + (ch - 'a');
                    if (ch >= 'A' && ch <= 'F') return 10 + (ch - 'A');
                    return 0;
                };
                char decoded = static_cast<char>((hexToNibble(h1) << 4) | hexToNibble(h2));
                out.push_back(decoded);
                i += 2;
                continue;
            }
        }
        out.push_back(static_cast<char>(c));
    }

    return out;
}

static bool skipExactDuplicatesForRequest(const crow::request& req) {
    std::string value = req.get_header_value("X-Skip-Duplicates");
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char character) {
        return static_cast<char>(std::tolower(character));
    });
    if (value.empty() || value == "true" || value == "1") {
        return true;
    }
    if (value == "false" || value == "0") {
        return false;
    }
    throw std::invalid_argument("Invalid X-Skip-Duplicates value");
}

static std::string sanitizeLogField(const std::string& value, size_t maxLength) {
    std::string sanitized;
    sanitized.reserve(std::min(value.size(), maxLength));
    for (const unsigned char character : value) {
        if (sanitized.size() >= maxLength) break;
        if (character == '\r' || character == '\n' || character == '\t' ||
            character < 0x20 || character == 0x7f) {
            sanitized.push_back(' ');
        } else {
            sanitized.push_back(static_cast<char>(character));
        }
    }
    return sanitized;
}

static bool isSensitiveLogDataKey(const std::string& key) {
    std::string normalized = key;
    std::transform(normalized.begin(), normalized.end(), normalized.begin(),
        [](unsigned char character) { return static_cast<char>(std::tolower(character)); });
    return normalized == "token" || normalized == "credential" ||
        normalized == "password" || normalized == "secret" ||
        normalized == "url" || normalized == "path" ||
        normalized == "filename" || normalized == "transferfilename" ||
        normalized == "savedfilename" || normalized == "assetid" ||
        normalized == "deviceid" || normalized == "serverid" ||
        normalized == "certificatefingerprint";
}

static json sanitizeLogData(const json& data) {
    json result = json::object();
    if (!data.is_object()) return result;

    size_t count = 0;
    for (auto item = data.begin(); item != data.end() && count < 64; ++item, ++count) {
        const std::string key = sanitizeLogField(item.key(), 64);
        if (key.empty()) continue;
        if (isSensitiveLogDataKey(key)) {
            result[key] = "[redacted]";
        } else if (item->is_boolean() || item->is_number()) {
            result[key] = *item;
        } else if (item->is_string()) {
            result[key] = sanitizeLogField(item->get<std::string>(), 256);
        }
    }
    return result;
}

static std::string computeFileSha256(const fs::path& path) {
    std::ifstream file(path, std::ios::binary);
    if (!file.is_open()) {
        throw std::runtime_error("Unable to open uploaded file for integrity verification");
    }

    std::unique_ptr<EVP_MD_CTX, decltype(&EVP_MD_CTX_free)> context(
        EVP_MD_CTX_new(),
        EVP_MD_CTX_free);
    if (!context) {
        throw std::runtime_error("Unable to allocate SHA-256 context");
    }

    std::vector<char> buffer(1024 * 1024);
    unsigned char digest[EVP_MAX_MD_SIZE];
    unsigned int digestLength = 0;

    if (EVP_DigestInit_ex(context.get(), EVP_sha256(), nullptr) != 1) {
        throw std::runtime_error("Unable to initialize SHA-256");
    }

    while (file.good()) {
        file.read(buffer.data(), static_cast<std::streamsize>(buffer.size()));
        const auto count = file.gcount();
        if (count > 0 &&
            EVP_DigestUpdate(context.get(), buffer.data(), static_cast<size_t>(count)) != 1) {
            throw std::runtime_error("Unable to update SHA-256");
        }
    }

    if (EVP_DigestFinal_ex(context.get(), digest, &digestLength) != 1) {
        throw std::runtime_error("Unable to finalize SHA-256");
    }

    std::ostringstream output;
    output << std::hex << std::setfill('0');
    for (unsigned int i = 0; i < digestLength; ++i) {
        output << std::setw(2) << static_cast<int>(digest[i]);
    }
    return output.str();
}

// Serializes the final append only; timestamp and line construction happen outside it.
static std::mutex g_metadataMutex;

// ─── Helper: ensure _dont_delete metadata folder exists ───
static std::string ensureMetadataFolder(const std::string& uploadDir) {
    fs::path metaDir = fs::path(uploadDir) / "_dont_delete";
    fs::create_directories(metaDir);

    // Create README if it doesn't exist
    fs::path readmePath = metaDir / "README.txt";
    if (!fs::exists(readmePath)) {
        std::ofstream readme(readmePath);
        if (readme.is_open()) {
            readme << "Local Network Media Transfer - Metadata Files\n"
                   << "===============================================\n\n"
                   << "hashes.db    - SQLite database for duplicate detection (SHA-256 hashes)\n"
                   << "_index.txt   - Upload history log\n\n"
                   << "DO NOT DELETE these files.\n";
        }
    }
    return metaDir.string();
}

// ─── Helper: append upload metadata ───
static void appendUploadMetadata(const std::string& uploadDir,
                                  const std::string& savedName,
                                  const std::string& originalName,
                                  const std::string& uploaderIp) {
    try {
        auto now = std::chrono::system_clock::now();
        auto time_t = std::chrono::system_clock::to_time_t(now);
        std::tm tm_buf;
#ifdef _WIN32
        localtime_s(&tm_buf, &time_t);
#else
        localtime_r(&time_t, &tm_buf);
#endif
        char timeBuf[64];
        std::strftime(timeBuf, sizeof(timeBuf), "%Y-%m-%dT%H:%M:%SZ", &tm_buf);

        std::ostringstream line;
        line << timeBuf << "\t" << originalName << "\t"
             << savedName << "\t" << uploaderIp << "\n";

        // A short lock is still required so concurrent append operations cannot
        // interleave bytes in the shared history file.
        std::lock_guard<std::mutex> lock(g_metadataMutex);
        fs::path indexPath = fs::path(uploadDir) / "_dont_delete" / "_index.txt";
        std::ofstream f(indexPath, std::ios::app);
        if (f.is_open()) {
            f << line.str();
        }
    } catch (...) {
        spdlog::warn("Failed to write upload metadata");
    }
}

// Hash database functions have been moved to FileWriter for thread-safety and centralization.


HttpServer::HttpServer(int httpsPort,
                       int httpPort,
                       bool allowInsecureHttp,
                       std::string certificatePem,
                       std::string privateKeyPem,
                       std::string runtimeEnvironment,
                       const std::string& uploadDir,
                       const std::string& staticDir,
                       const std::string& defaultToken,
                       std::shared_ptr<MetricsCollector> metrics,
                       std::shared_ptr<PipeServer> pipeServer,
                       std::shared_ptr<HashEngine> hashEngine,
                       std::shared_ptr<BenchmarkStore> benchmarkStore,
                       std::shared_ptr<TransferHistoryStore> historyStore,
                       std::shared_ptr<PairingStore> pairingStore,
                       std::shared_ptr<NativeSessionStore> nativeSessionStore,
                       lmt::FilenameConflictPolicy filenameConflictPolicy)
    : m_httpsPort(httpsPort)
    , m_httpPort(httpPort)
    , m_allowInsecureHttp(allowInsecureHttp)
    , m_certificatePem(std::move(certificatePem))
    , m_privateKeyPem(std::move(privateKeyPem))
    , m_runtimeEnvironment(std::move(runtimeEnvironment))
    , m_metrics(std::move(metrics))
    , m_pipeServer(std::move(pipeServer))
    , m_benchmarkStore(std::move(benchmarkStore))
    , m_historyStore(std::move(historyStore))
    , m_pairingStore(std::move(pairingStore))
    , m_nativeSessionStore(std::move(nativeSessionStore))
    , m_fileWriter(std::make_unique<FileWriter>(
          uploadDir,
          std::move(hashEngine),
          filenameConflictPolicy))
{
    m_config.port = httpsPort;
    m_config.uploadDir = uploadDir;
    m_config.staticDir = staticDir;
    m_config.token = defaultToken;
    m_config.filenameConflictPolicy = filenameConflictPolicy;

    // Ensure upload directory exists
    fs::create_directories(m_config.uploadDir);
    ensureMetadataFolder(m_config.uploadDir);

    // Suppress Crow's built-in INFO logging to prevent fmt 12.x assertion crash.
    // Crow's response logger formats content_length (int, can be -1) which triggers
    // "assertion failed: negative value" in fmt/base.h:440. Our spdlog handles logging.
    m_httpsApp.loglevel(crow::LogLevel::Warning);
    setupCORS(m_httpsApp);
    setupRoutes(m_httpsApp);
    if (m_allowInsecureHttp) {
        m_httpApp.loglevel(crow::LogLevel::Warning);
        setupCORS(m_httpApp);
        setupRoutes(m_httpApp);
    }
}

HttpServer::~HttpServer() {
    stop();
}

void HttpServer::setupCORS(CrowApp& app) {
    // Configure Crow's built-in CORS middleware.
    // This handles OPTIONS preflight and adds headers to all responses automatically.
    auto& cors = app.get_middleware<crow::CORSHandler>();
    cors.global()
        .headers("Content-Type", "X-Session-Token", "X-Upload-Token",
                 "X-Device-Credential", "X-Transfer-Id",
                 "X-File-Id", "X-Filename",
                 "X-Chunk-Index", "X-Total-Chunks", "X-File-Size",
                 "X-Skip-Duplicates")
        .methods("GET"_method, "POST"_method, "OPTIONS"_method)
        .origin("*")
        .max_age(86400);  // Cache preflight for 24h — eliminates OPTIONS spam from Safari
}

void HttpServer::setupRoutes(CrowApp& app) {

    auto pairingResponse = [this](PairingStore::Status status) {
        if (status == PairingStore::Status::Approved) {
            return json{{"status", "approved"}, {"environment", m_runtimeEnvironment}};
        }
        if (status == PairingStore::Status::Denied) {
            return json{{"status", "denied"}, {"environment", m_runtimeEnvironment}};
        }
        return json{{"status", "pending"}, {"expiresInSeconds", 120},
            {"environment", m_runtimeEnvironment}};
    };

    auto nativeResponse = [](const NativeSessionStore::Result& result) {
        crow::response response;
        response.code = result.status;
        response.add_header("Content-Type", "application/json; charset=utf-8");
        response.add_header("Cache-Control", "no-store, max-age=0");
        if (result.status == 429) response.add_header("Retry-After", "600");
        response.body = result.body.dump();
        return response;
    };

    CROW_ROUTE(app, "/native/v1/identity").methods("GET"_method)
    ([this]() {
        crow::response response;
        response.add_header("Content-Type", "application/json; charset=utf-8");
        response.add_header("Cache-Control", "no-store, max-age=0");
        if (!m_nativeSessionStore) {
            response.code = 404;
            response.body = json{{"error", "native_transfer_unavailable"},
                {"message", "Native Windows transfer is unavailable."},
                {"retryable", false}}.dump();
        } else {
            response.code = 200;
            response.body = m_nativeSessionStore->identity().dump();
        }
        return response;
    });

    CROW_ROUTE(app, "/native/v1/pairing/requests").methods("POST"_method)
    ([this, nativeResponse](const crow::request& req) {
        if (!m_nativeSessionStore || req.body.size() > 16 * 1024) {
            return nativeResponse(NativeSessionStore::Result{413,
                json{{"error", "pairing_request_too_large"},
                     {"message", "The pairing request is too large."},
                     {"retryable", false}}});
        }
        try {
            return nativeResponse(m_nativeSessionStore->requestPairing(
                json::parse(req.body), req.remote_ip_address));
        } catch (...) {
            return nativeResponse(NativeSessionStore::Result{400,
                json{{"error", "invalid_pairing_request"},
                     {"message", "The pairing request is invalid."},
                     {"retryable", false}}});
        }
    });

    CROW_ROUTE(app, "/native/v1/pairing/requests/<string>/confirm")
    .methods("POST"_method)
    ([this, nativeResponse](const crow::request& req, std::string requestId) {
        try {
            return nativeResponse(m_nativeSessionStore->confirmPairing(
                requestId, json::parse(req.body)));
        } catch (...) {
            return nativeResponse(NativeSessionStore::Result{400,
                json{{"error", "invalid_pairing_confirmation"},
                     {"message", "The pairing confirmation is invalid."},
                     {"retryable", false}}});
        }
    });

    CROW_ROUTE(app, "/native/v1/pairing/requests/<string>/status")
    .methods("POST"_method)
    ([this, nativeResponse](const crow::request& req, std::string requestId) {
        try {
            return nativeResponse(m_nativeSessionStore->pairingStatus(
                requestId, json::parse(req.body)));
        } catch (...) {
            return nativeResponse(NativeSessionStore::Result{400,
                json{{"error", "invalid_pairing_status_request"},
                     {"message", "The pairing status request is invalid."},
                     {"retryable", false}}});
        }
    });

    CROW_ROUTE(app, "/native/v1/pairing/requests/<string>")
    .methods("DELETE"_method)
    ([this, nativeResponse](const crow::request&, std::string requestId) {
        const bool denied = m_nativeSessionStore &&
            m_nativeSessionStore->denyPairing(requestId);
        return nativeResponse(denied
            ? NativeSessionStore::Result{200, json{{"ok", true}}}
            : NativeSessionStore::Result{404, json{{"error", "pairing_request_expired"},
                {"message", "The pairing request has expired."},
                {"retryable", false}}});
    });

    CROW_ROUTE(app, "/native/v1/transfers/requests").methods("POST"_method)
    ([this, nativeResponse](const crow::request& req) {
        if (!m_nativeSessionStore || req.body.size() > 512 * 1024) {
            return nativeResponse(NativeSessionStore::Result{413,
                json{{"error", "transfer_manifest_too_large"},
                     {"message", "The transfer manifest is too large."},
                     {"retryable", false}}});
        }
        try {
            return nativeResponse(m_nativeSessionStore->requestTransfer(
                json::parse(req.body),
                req.get_header_value("X-Device-Credential"),
                req.remote_ip_address));
        } catch (...) {
            return nativeResponse(NativeSessionStore::Result{400,
                json{{"error", "invalid_transfer_request"},
                     {"message", "The transfer request is invalid."},
                     {"retryable", false}}});
        }
    });

    CROW_ROUTE(app, "/native/v1/transfers/requests/<string>/status")
    .methods("POST"_method)
    ([this, nativeResponse](const crow::request& req, std::string requestId) {
        return nativeResponse(m_nativeSessionStore->transferStatus(
            requestId, req.get_header_value("X-Device-Credential")));
    });

    CROW_ROUTE(app, "/native/v1/transfers/<string>/cancel")
    .methods("POST"_method)
    ([this, nativeResponse](const crow::request& req, std::string transferId) {
        auto result = m_nativeSessionStore->cancelTransfer(
            transferId, getTokenFromRequest(req));
        if (result.status == 200) {
            result.body["cancelledFiles"] =
                m_fileWriter->abortFilesWithPrefix("win-" + transferId + "-");
        }
        return nativeResponse(result);
    });

    CROW_ROUTE(app, "/pair/request").methods("POST"_method)
    ([this, pairingResponse](const crow::request& req) {
        crow::response res;
        res.add_header("Content-Type", "application/json; charset=utf-8");
        if (!validateSessionToken(getTokenFromRequest(req))) {
            spdlog::warn("Unauthorized request: token mismatch for {} from {}",
                         req.url, req.remote_ip_address);
            res.code = 401;
            res.body = json{{"status", "denied"},
                {"error", "valid QR session token required"},
                {"environment", m_runtimeEnvironment}}.dump();
            return res;
        }
        try {
            const auto body = json::parse(req.body);
            const auto id = body.value("deviceId", "");
            const auto name = body.value("deviceName", "iPhone");
            const auto credential = body.value("credential", "");
            const auto status = m_pairingStore
                ? m_pairingStore->request(id, name, credential, req.remote_ip_address, m_autoApproveKnown.load())
                : PairingStore::Status::Denied;
            if (status == PairingStore::Status::Pending && m_pipeServer) {
                m_pipeServer->sendPairingRequest(json{{"deviceId", id}, {"deviceName", name},
                    {"ip", req.remote_ip_address}}.dump());
            }
            res.code = status == PairingStore::Status::Denied ? 403 : 200;
            res.body = pairingResponse(status).dump();
        } catch (...) {
            res.code = 400;
            res.body = json{{"status", "denied"},
                {"error", "invalid pairing request"},
                {"environment", m_runtimeEnvironment}}.dump();
        }
        return res;
    });

    CROW_ROUTE(app, "/pair/status").methods("POST"_method)
    ([this, pairingResponse](const crow::request& req) {
        crow::response res;
        res.add_header("Content-Type", "application/json; charset=utf-8");
        try {
            const auto body = json::parse(req.body);
            const auto status = m_pairingStore
                ? m_pairingStore->status(body.value("deviceId", ""), body.value("credential", ""))
                : PairingStore::Status::Denied;
            res.code = status == PairingStore::Status::Denied ? 403 : 200;
            res.body = pairingResponse(status).dump();
        } catch (...) {
            res.code = 400;
            res.body = json{{"status", "denied"},
                {"environment", m_runtimeEnvironment}}.dump();
        }
        return res;
    });

    // ─── Health check ───
    CROW_ROUTE(app, "/_health")
    ([this]() {
        json response = {
            {"status", "ok"},
            {"version", lmt::Version},
            {"environment", m_runtimeEnvironment}
        };
        crow::response res(200);
        res.add_header("Content-Type", "application/json; charset=utf-8");
        res.add_header("Access-Control-Allow-Origin", "*");
        res.body = response.dump();
        return res;
    });

    // ─── Verify token ───
    CROW_ROUTE(app, "/verify_token")
    .methods("POST"_method)
    ([this](const crow::request& req) {
        json response;
        crow::response res;
        res.add_header("Content-Type", "application/json; charset=utf-8");
        res.add_header("Access-Control-Allow-Origin", "*");

        if (validateAnyToken(getTokenFromRequest(req))) {
            response = {{"valid", true}, {"environment", m_runtimeEnvironment}};
            res.code = 200;
        } else {
            response = {{"valid", false}, {"error", "Invalid token"},
                {"environment", m_runtimeEnvironment}};
            res.code = 403;
        }

        res.body = response.dump();
        return res;
    });

    // ─── Client telemetry log intake ───
    CROW_ROUTE(app, "/client_log")
    .methods("POST"_method)
    ([this](const crow::request& req) {
        crow::response res;
        res.add_header("Content-Type", "application/json; charset=utf-8");
        res.add_header("Access-Control-Allow-Origin", "*");

        if (!validateRequestToken(req)) {
            res.code = 401;
            res.body = R"({"ok":false,"error":"Unauthorized"})";
            return res;
        }

        if (req.body.size() > 64 * 1024) {
            res.code = 413;
            res.body = R"({"ok":false,"error":"payload too large"})";
            return res;
        }

        try {
            auto body = json::parse(req.body);

            const std::string session = sanitizeLogField(
                body.value("session", "unknown"), 128);
            const std::string level = sanitizeLogField(
                body.value("level", "INFO"), 16);
            const std::string event = sanitizeLogField(
                body.value("event", "client_event"), 128);
            const std::string message = sanitizeLogField(
                body.value("message", ""), 512);
            const std::string details = body.contains("data")
                ? sanitizeLogField(sanitizeLogData(body["data"]).dump(), 4096)
                : "{}";

            if (m_metrics &&
                (event == "transfer_started" || event == "upload_started")) {
                m_metrics->startSession(req.remote_ip_address, session);
                if (m_pipeServer) {
                    m_pipeServer->sendMetrics(m_metrics->getRealtimeMetrics());
                }
            }

            if (level == "ERROR") {
                spdlog::error("[CLIENT][{}] {} | {} | {}", session, event, message, details);
            } else if (level == "WARN") {
                spdlog::warn("[CLIENT][{}] {} | {} | {}", session, event, message, details);
            } else {
                spdlog::info("[CLIENT][{}] {} | {} | {}", session, event, message, details);
            }
            if (m_pipeServer) {
                m_pipeServer->sendLog(level, "[Client " + session + "] " + event + " | " + message);
            }
            if (m_metrics &&
                (event == "transfer_completed" || event == "transfer_cancelled" ||
                 event == "transfer_failed" || event == "transfer_exception" ||
                 event == "upload_finished")) {
                const bool ended = m_metrics->endSession(session);
                if (ended && m_pipeServer) {
                    m_pipeServer->sendMetrics(m_metrics->getRealtimeMetrics());
                }
            }

            res.code = 200;
            res.body = R"({"ok":true})";
            return res;
        } catch (const std::exception& e) {
            spdlog::warn("/client_log parse failed: {}", e.what());
            res.code = 400;
            res.body = R"({"ok":false,"error":"invalid json"})";
            return res;
        }
    });

    // ─── Configuration ───
    CROW_ROUTE(app, "/client_metrics")
    .methods("POST"_method)
    ([this](const crow::request& req) {
        crow::response res;
        res.add_header("Content-Type", "application/json; charset=utf-8");
        res.add_header("Access-Control-Allow-Origin", "*");

        if (!validateRequestToken(req)) {
            res.code = 403;
            res.body = json{{"error", "Invalid token"}}.dump();
            return res;
        }

        try {
            const auto body = json::parse(req.body);
            if (!body.contains("bytesPerSecond") ||
                !body["bytesPerSecond"].is_number()) {
                throw std::invalid_argument("bytesPerSecond is required");
            }

            const double bytesPerSecond = body["bytesPerSecond"].get<double>();
            const std::string sessionId = body.value("sessionId", "");
            if (!std::isfinite(bytesPerSecond) ||
                bytesPerSecond < 0.0 ||
                bytesPerSecond > 100.0 * 1024.0 * 1024.0 * 1024.0) {
                throw std::invalid_argument("bytesPerSecond is out of range");
            }

            if (m_metrics) {
                const bool accepted = m_metrics->recordClientSpeed(bytesPerSecond, sessionId);
                if (accepted && m_pipeServer) {
                    m_pipeServer->sendMetrics(m_metrics->getRealtimeMetrics());
                }
                res.code = 202;
                res.body = json{{"ok", true}, {"accepted", accepted}}.dump();
                return res;
            }

            res.code = 202;
            res.body = R"({"ok":true,"accepted":false})";
        } catch (const std::exception& e) {
            res.code = 400;
            res.body = json{{"error", e.what()}}.dump();
        }
        return res;
    });

    CROW_ROUTE(app, "/config")
    ([this]() {
        crow::response res;
        res.add_header("Content-Type", "application/json; charset=utf-8");
        res.add_header("Access-Control-Allow-Origin", "*");

        json config = {
            {"version", lmt::Version},
            {"environment", m_runtimeEnvironment},
            {"browserBootstrapLifetimeSeconds",
             BrowserBootstrapLifetimeSeconds},
            {"mobile", {
                {"chunkSizeBytes", 4 * 1024 * 1024},
                {"parallelFiles", 5},
                {"sequentialChunksPerFile", true},
            }},
            {"desktop", {
                {"chunkSizeBytes", 8 * 1024 * 1024},
                {"parallelFiles", 6},
                {"sequentialChunksPerFile", true},
            }},
            {"shared", {
                {"singleFileMaxBytes", 100 * 1024 * 1024},
                {"maxQueuedFiles", 1000},
                {"maxFileSizeBytes", 100ULL * 1024 * 1024 * 1024}
            }},
            {"features", {
                {"duplicateDetection", true},
                {"hashAlgorithm", "sha256"},
                {"hashScope", "candidate-preflight-and-server-verified"},
                {"preflightDuplicateDetection", true},
                {"filenameCollisionPolicy",
                 m_config.filenameConflictPolicy ==
                         lmt::FilenameConflictPolicy::Reject
                     ? "reject"
                     : "keep-both"}
            }}
            ,{"capabilities", {
                {"nativeWindowsTransfer", {
                    {"version", 1},
                    {"pairingAvailable", m_nativeSessionStore &&
                        m_nativeSessionStore->pairingAvailable()}
                }}
            }}
        };

        res.code = 200;
        res.body = config.dump();
        return res;
    });

    CROW_ROUTE(app, "/upload/preflight")
    .methods("POST"_method)
    ([this](const crow::request& req) {
        crow::response res;
        res.add_header("Content-Type", "application/json; charset=utf-8");
        res.add_header("Access-Control-Allow-Origin", "*");
        if (!validateUploadAuthorization(req)) {
            res.code = 403;
            res.body = json{{"error", "Invalid token"}}.dump();
            return res;
        }

        try {
            const auto body = json::parse(req.body);
            if (!body.contains("files") || !body["files"].is_array() ||
                body["files"].size() > 1000) {
                throw std::invalid_argument(
                    "files must be an array containing at most 1000 entries");
            }

            json results = json::array();
            const std::string nativeTransferId =
                req.get_header_value("X-Transfer-Id");
            const std::string nativeToken = getTokenFromRequest(req);
            const bool skipExactDuplicates = skipExactDuplicatesForRequest(req);
            for (const auto& file : body["files"]) {
                const std::string id = file.value("id", "");
                const std::string name = file.value("name", "");
                const uint64_t size = file.value("size", 0ULL);
                if (id.empty() || name.empty()) {
                    throw std::invalid_argument(
                        "Each file requires a non-empty id and name");
                }
                if (!nativeTransferId.empty() &&
                    !m_nativeSessionStore->authorizeFile(nativeToken,
                        nativeTransferId, id, name, size,
                        skipExactDuplicates)) {
                    res.code = 403;
                    res.body = json{{"error", "transfer_manifest_mismatch"}}.dump();
                    return res;
                }
                const bool candidate =
                    m_fileWriter->hasPreflightCandidate(name, size);
                results.push_back({
                    {"id", id},
                    {"action", candidate ? "hash_required" : "upload"}
                });
            }
            res.code = 200;
            res.body = json{{"files", results}}.dump();
        } catch (const std::exception& e) {
            res.code = 400;
            res.body = json{{"error", e.what()}}.dump();
        }
        return res;
    });

    CROW_ROUTE(app, "/upload/preflight/verify")
    .methods("POST"_method)
    ([this](const crow::request& req) {
        crow::response res;
        res.add_header("Content-Type", "application/json; charset=utf-8");
        res.add_header("Access-Control-Allow-Origin", "*");
        if (!validateUploadAuthorization(req)) {
            res.code = 403;
            res.body = json{{"error", "Invalid token"}}.dump();
            return res;
        }

        try {
            const auto body = json::parse(req.body);
            if (!body.contains("files") || !body["files"].is_array() ||
                body["files"].size() > 1000) {
                throw std::invalid_argument(
                    "files must be an array containing at most 1000 entries");
            }

            json results = json::array();
            const std::string nativeTransferId =
                req.get_header_value("X-Transfer-Id");
            const std::string nativeToken = getTokenFromRequest(req);
            const bool skipExactDuplicates = skipExactDuplicatesForRequest(req);
            PreflightHashCache hashCache;
            for (const auto& file : body["files"]) {
                const std::string id = file.value("id", "");
                const std::string name = file.value("name", "");
                std::string hash = file.value("sha256", "");
                const uint64_t size = file.value("size", 0ULL);
                std::transform(
                    hash.begin(),
                    hash.end(),
                    hash.begin(),
                    [](unsigned char ch) {
                        return static_cast<char>(std::tolower(ch));
                    });
                if (id.empty() || name.empty() || hash.size() != 64 ||
                    !std::all_of(
                        hash.begin(),
                        hash.end(),
                        [](unsigned char ch) {
                            return std::isxdigit(ch) != 0;
                        })) {
                    throw std::invalid_argument(
                        "Each file requires id, name, size, and full SHA-256");
                }
                if (!nativeTransferId.empty() &&
                    !m_nativeSessionStore->authorizeFile(nativeToken,
                        nativeTransferId, id, name, size,
                        skipExactDuplicates)) {
                    res.code = 403;
                    res.body = json{{"error", "transfer_manifest_mismatch"}}.dump();
                    return res;
                }

                const auto result = m_fileWriter->verifyPreflight(
                    name,
                    size,
                    hash,
                    &hashCache);
                std::string action = "upload";
                if (result.disposition == PreflightDisposition::Skip) {
                    action = "skip";
                } else if (
                    result.disposition ==
                    PreflightDisposition::UploadNameConflict) {
                    action = "upload_name_conflict";
                }
                json responseFile = {
                    {"id", id},
                    {"action", action},
                    {"filename", result.filename}
                };
                if (result.disposition == PreflightDisposition::Inconclusive) {
                    responseFile["verification"] = "inconclusive";
                }
                results.push_back(std::move(responseFile));
                if (!nativeTransferId.empty() && action == "skip") {
                    m_nativeSessionStore->markFileTerminal(nativeTransferId, id);
                }
            }
            res.code = 200;
            res.body = json{{"files", results}}.dump();
        } catch (const std::exception& e) {
            res.code = 400;
            res.body = json{{"error", e.what()}}.dump();
        }
        return res;
    });

    CROW_ROUTE(app, "/transfer_history")
    .methods("POST"_method, "DELETE"_method)
    ([this](const crow::request& req) {
        crow::response res;
        res.add_header("Content-Type", "application/json; charset=utf-8");
        res.add_header("Access-Control-Allow-Origin", "*");
        if (!validateRequestToken(req)) {
            res.code = 403;
            res.body = json{{"error", "Invalid token"}}.dump();
            return res;
        }
        if (!m_historyStore) {
            res.code = 503;
            res.body = json{{"error", "Transfer history unavailable"}}.dump();
            return res;
        }
        if (req.method == "DELETE"_method) {
            m_historyStore->clear();
            if (m_pipeServer) {
                m_pipeServer->sendTransferHistory(
                    m_historyStore->recentSessionsJson());
            }
            res.code = 200;
            res.body = R"({"ok":true})";
            return res;
        }
        if (req.body.size() > 2 * 1024 * 1024) {
            res.code = 413;
            res.body = json{{"error", "Transfer history payload too large"}}.dump();
            return res;
        }
        try {
            m_historyStore->recordSession(
                req.body,
                req.remote_ip_address);
            if (m_pipeServer) {
                m_pipeServer->sendTransferHistory(
                    m_historyStore->recentSessionsJson());
            }
            res.code = 201;
            res.body = R"({"ok":true})";
        } catch (const std::exception& e) {
            res.code = 400;
            res.body = json{{"error", e.what()}}.dump();
        }
        return res;
    });

    CROW_ROUTE(app, "/transfer_history/recent")
    ([this](const crow::request& req) {
        crow::response res;
        res.add_header("Content-Type", "application/json; charset=utf-8");
        if (!validateRequestToken(req)) {
            res.code = 403;
            res.body = json{{"error", "Invalid token"}}.dump();
            return res;
        }
        res.code = m_historyStore ? 200 : 503;
        res.body = m_historyStore
            ? m_historyStore->recentSessionsJson()
            : json{{"error", "Transfer history unavailable"}}.dump();
        return res;
    });

    CROW_ROUTE(app, "/settings")
    .methods("GET"_method, "POST"_method)
    ([this](const crow::request& req) {
        crow::response res;
        res.add_header("Content-Type", "application/json; charset=utf-8");
        res.add_header("Access-Control-Allow-Origin", "*");
        if (!validateRequestToken(req)) {
            res.code = 403;
            res.body = json{{"error", "Invalid token"}}.dump();
            return res;
        }

        if (req.method == "POST"_method) {
            try {
                // Validate it's proper JSON
                auto j = json::parse(req.body);
                m_settingsJson = j.dump();
                res.code = 200;
                res.body = R"({"ok":true})";
            } catch (const std::exception& e) {
                res.code = 400;
                res.body = json{{"error", "Invalid JSON"}}.dump();
            }
        } else {
            res.code = 200;
            res.body = m_settingsJson;
        }
        return res;
    });

    if (m_benchmarkStore) {
        CROW_ROUTE(app, "/_dev/benchmark/runs/start")
        .methods("POST"_method)
        ([this](const crow::request& req) {
            crow::response res;
            res.add_header("Content-Type", "application/json; charset=utf-8");
            res.add_header("Access-Control-Allow-Origin", "*");
            if (!validateRequestToken(req)) {
                res.code = 401;
                res.body = json{{"error", "Unauthorized"}}.dump();
                return res;
            }

            try {
                auto payload = json::parse(req.body);
                auto runId = m_benchmarkStore->startRun(payload);
                if (!runId) {
                    res.code = 409;
                    res.body = json{{"error", "A benchmark run is already active"}}.dump();
                    return res;
                }
                res.code = 201;
                res.body = json{{"runId", *runId}}.dump();
            } catch (const std::exception& e) {
                res.code = 400;
                res.body = json{{"error", e.what()}}.dump();
            }
            return res;
        });

        CROW_ROUTE(app, "/_dev/benchmark/runs/<string>/samples")
        .methods("POST"_method)
        ([this](const crow::request& req, const std::string& runId) {
            crow::response res;
            res.add_header("Content-Type", "application/json; charset=utf-8");
            res.add_header("Access-Control-Allow-Origin", "*");
            if (!validateRequestToken(req)) {
                res.code = 401;
                res.body = json{{"error", "Unauthorized"}}.dump();
                return res;
            }
            try {
                auto payload = json::parse(req.body);
                if (!m_benchmarkStore->addSample(runId, payload)) {
                    res.code = 409;
                    res.body = json{{"error", "Run is not active"}}.dump();
                    return res;
                }
                res.code = 202;
                res.body = json{{"ok", true}}.dump();
            } catch (const std::exception& e) {
                res.code = 400;
                res.body = json{{"error", e.what()}}.dump();
            }
            return res;
        });

        CROW_ROUTE(app, "/_dev/benchmark/runs/<string>/files/<string>/verify")
        .methods("POST"_method)
        ([this](const crow::request& req, const std::string& runId, const std::string& fileId) {
            crow::response res;
            res.add_header("Content-Type", "application/json; charset=utf-8");
            res.add_header("Access-Control-Allow-Origin", "*");
            if (!validateRequestToken(req)) {
                res.code = 401;
                res.body = json{{"error", "Unauthorized"}}.dump();
                return res;
            }

            try {
                auto payload = json::parse(req.body);
                const std::string savedName = payload.value("savedName", "");
                const std::string expected = payload.value("expectedSha256", "");
                const std::string uploadError = payload.value("error", "");

                if (!uploadError.empty()) {
                    payload["actualSha256"] = "";
                    payload["integrityOk"] = false;
                    if (!m_benchmarkStore->addFileResult(runId, fileId, payload)) {
                        res.code = 409;
                        res.body = json{{"error", "Run is not active"}}.dump();
                        return res;
                    }
                    res.code = 200;
                    res.body = json{{"integrityOk", false}, {"recorded", true}}.dump();
                    return res;
                }

                if (savedName.empty() || expected.empty()) {
                    throw std::runtime_error(
                        "savedName and expectedSha256 are required for successful uploads");
                }

                const fs::path safeName = fs::u8path(savedName).filename();
                const fs::path savedPath = fs::u8path(m_config.uploadDir) / safeName;
                const std::string actual = computeFileSha256(savedPath);
                const bool integrityOk = actual == expected;
                payload["savedName"] = safeName.u8string();
                payload["actualSha256"] = actual;
                payload["integrityOk"] = integrityOk;

                if (!m_benchmarkStore->addFileResult(runId, fileId, payload)) {
                    res.code = 409;
                    res.body = json{{"error", "Run is not active"}}.dump();
                    return res;
                }

                res.code = integrityOk ? 200 : 422;
                res.body = json{
                    {"integrityOk", integrityOk},
                    {"expectedSha256", expected},
                    {"actualSha256", actual}
                }.dump();
            } catch (const std::exception& e) {
                res.code = 400;
                res.body = json{{"error", e.what()}}.dump();
            }
            return res;
        });

        CROW_ROUTE(app, "/_dev/benchmark/runs/<string>/finish")
        .methods("POST"_method)
        ([this](const crow::request& req, const std::string& runId) {
            crow::response res;
            res.add_header("Content-Type", "application/json; charset=utf-8");
            res.add_header("Access-Control-Allow-Origin", "*");
            if (!validateRequestToken(req)) {
                res.code = 401;
                res.body = json{{"error", "Unauthorized"}}.dump();
                return res;
            }
            try {
                auto payload = json::parse(req.body);
                if (!m_benchmarkStore->finishRun(runId, payload)) {
                    res.code = 409;
                    res.body = json{{"error", "Run is not active"}}.dump();
                    return res;
                }
                res.code = 200;
                res.body = json{{"ok", true}}.dump();
            } catch (const std::exception& e) {
                res.code = 400;
                res.body = json{{"error", e.what()}}.dump();
            }
            return res;
        });

        CROW_ROUTE(app, "/_dev/benchmark/runs/<string>")
        .methods("GET"_method)
        ([this](const crow::request& req, const std::string& runId) {
            crow::response res;
            res.add_header("Content-Type", "application/json; charset=utf-8");
            res.add_header("Access-Control-Allow-Origin", "*");
            if (!validateRequestToken(req)) {
                res.code = 401;
                res.body = json{{"error", "Unauthorized"}}.dump();
                return res;
            }
            auto run = m_benchmarkStore->getRun(runId);
            if (!run) {
                res.code = 404;
                res.body = json{{"error", "Benchmark run not found"}}.dump();
                return res;
            }
            res.code = 200;
            res.body = run->dump();
            return res;
        });
    }

    // ─── Single file upload (multipart) ───
    CROW_ROUTE(app, "/upload_single")
    .methods("POST"_method)
    ([this](const crow::request& req) {
        const std::string encodedHeaderFilename = req.get_header_value("X-Filename");
        const std::string headerFilename = urlDecode(encodedHeaderFilename);

        crow::response res;
        res.add_header("Access-Control-Allow-Origin", "*");
        res.add_header("Content-Type", "application/json; charset=utf-8");

        // Validate token
        if (!req.get_header_value("X-Transfer-Id").empty() ||
            !validateRequestToken(req)) {
            json err = {{"error", "Unauthorized"}, {"code", 401}};
            res.code = 401;
            res.body = err.dump();
            res.add_header("Connection", "close");
            return res;
        }

        spdlog::info("Upload request from {} (body size: {} bytes)", 
                     req.remote_ip_address, req.body.size());

        // Wrap ALL multipart parsing in try-catch to prevent abort()
        try {
            const bool skipExactDuplicates =
                skipExactDuplicatesForRequest(req);
            crow::multipart::message msg(req);

            spdlog::info("Multipart message parsed, {} parts found", msg.parts.size());

            for (const auto& part : msg.parts) {
                std::string partName;
                std::string filename = "unknown";
                bool hasFilenameParam = false;

                auto it = part.headers.find("Content-Disposition");
                if (it != part.headers.end()) {
                    auto namePos = it->second.params.find("name");
                    if (namePos != it->second.params.end()) {
                        partName = namePos->second;
                        if (partName.size() >= 2 && partName.front() == '"' && partName.back() == '"') {
                            partName = partName.substr(1, partName.size() - 2);
                        }
                    }
                    auto filenamePos = it->second.params.find("filename");
                    if (filenamePos != it->second.params.end()) {
                        hasFilenameParam = true;
                        filename = filenamePos->second;
                        if (filename.size() >= 2 && filename.front() == '"' && filename.back() == '"') {
                            filename = filename.substr(1, filename.size() - 2);
                        }
                    }
                }

                if (!headerFilename.empty()) {
                    filename = headerFilename;
                }

                spdlog::info("Part: name='{}', filename='{}', body_size={}", 
                            partName, filename, part.body.size());

                bool isTargetPart = (partName == "file");

                // Crow can corrupt multipart part-name parsing for some UTF-8 filenames.
                // If there's only one part with file-like metadata, treat it as the file payload.
                // This keeps malformed/non-ASCII multipart headers from causing hard failures.
                if (!isTargetPart && msg.parts.size() == 1 && !part.body.empty() && (!headerFilename.empty() || hasFilenameParam)) {
                    spdlog::warn("Multipart part-name mismatch ('{}'); accepting single-part file fallback", partName);
                    isTargetPart = true;
                }

                if (!isTargetPart) continue;

                if (part.body.empty()) {
                    spdlog::warn("Empty file body for '{}'", filename);
                    json err = {{"error", "Empty file"}, {"code", 400}};
                    res.code = 400;
                    res.body = err.dump();
                    return res;
                }

                try {
                    // Use high-resolution clock + atomic counter for guaranteed unique ID
                    static std::atomic<uint64_t> uploadCounter{0};
                    auto now = std::chrono::high_resolution_clock::now();
                    auto ns = std::chrono::duration_cast<std::chrono::nanoseconds>(
                        now.time_since_epoch()).count();
                    std::string fileId = std::to_string(ns) + "_" + std::to_string(uploadCounter++);

                    spdlog::info("Initializing file '{}' with id '{}', size {} bytes", 
                                filename, fileId, part.body.size());

                    if (m_fileWriter->initFile(
                            fileId,
                            filename,
                            part.body.size(),
                            1,
                            skipExactDuplicates)) {
                        if (m_fileWriter->writeChunk(fileId, 0, part.body.data(), part.body.size()) !=
                            ChunkWriteStatus::Success) {
                            spdlog::error("writeChunk failed for '{}'", filename);
                            json err = {{"error", "Failed to write file data"}, {"code", 500}};
                            res.code = 500;
                            res.body = err.dump();
                            return res;
                        }

                        FileFinalizeResult finalizeResult =
                            m_fileWriter->finalizeFileResult(fileId);
                        if (finalizeResult.disposition ==
                            FileFinalizeDisposition::NameConflict) {
                            json err = {
                                {"error", "A different file already uses this filename"},
                                {"code", "filename_conflict"},
                                {"filename", finalizeResult.filename}
                            };
                            res.code = 409;
                            res.body = err.dump();
                            return res;
                        }
                        if (finalizeResult.disposition !=
                                FileFinalizeDisposition::Saved &&
                            finalizeResult.disposition !=
                                FileFinalizeDisposition::Duplicate) {
                            spdlog::error("finalizeFile failed for '{}'", filename);
                            json err = {{"error", "Failed to finalize file"}, {"code", 500}};
                            res.code = 500;
                            res.body = err.dump();
                            return res;
                        }
                        const std::string& savedName = finalizeResult.filename;
                        const bool skipped =
                            finalizeResult.disposition ==
                            FileFinalizeDisposition::Duplicate;

                        // Update metrics
                        if (m_metrics) {
                            m_metrics->recordBytes(part.body.size());

                            if (!skipped) {
                                lmt::FileTransferStats stats;
                                stats.originalName = filename;
                                stats.savedName = savedName;
                                stats.sizeBytes = static_cast<uint64_t>(part.body.size());
                                stats.completed = true;
                                stats.hash = finalizeResult.sha256;
                                m_metrics->recordFileComplete(stats);
                            }

                            if (m_pipeServer) {
                                m_pipeServer->sendMetrics(m_metrics->getRealtimeMetrics());
                            }
                        }

                        if (!skipped) {
                            appendUploadMetadata(
                                m_config.uploadDir,
                                savedName,
                                filename,
                                req.remote_ip_address);
                        }

                        // Log to pipe
                        if (m_pipeServer) {
                            m_pipeServer->sendLog(
                                "INFO",
                                skipped
                                    ? "Skipped exact duplicate: " + savedName
                                    : "Saved: " + savedName);
                        }

                        spdlog::info(
                            "{} file: {} ({} bytes)",
                            skipped ? "Skipped duplicate" : "Saved",
                            savedName,
                            part.body.size());

                        json success = {
                            {"success", true},
                            {"filename", savedName},
                            {"size", part.body.size()},
                            {"skipped", skipped},
                            {"sha256", finalizeResult.sha256}
                        };
                        res.code = 200;
                        res.body = success.dump();
                        return res;
                    } else {
                        spdlog::error("initFile failed for '{}' (id: {})", filename, fileId);
                        json err = {{"error", "Failed to initialize file on server"}, {"code", 500}};
                        res.code = 500;
                        res.body = err.dump();
                        return res;
                    }
                } catch (const std::exception& e) {
                    spdlog::error("Failed to save file {}: {}", filename, e.what());
                    json err = {{"error", "Failed to save file"}, {"code", 500}};
                    res.code = 500;
                    res.body = err.dump();
                    return res;
                }
            }

            spdlog::warn("No 'file' part found in multipart request");
            json err = {{"error", "No file in request"}, {"code", 400}};
            res.code = 400;
            res.body = err.dump();
            return res;

        } catch (const std::exception& e) {
            spdlog::error("Multipart parsing failed: {}", e.what());
            json err = {{"error", "Invalid multipart request"}, {"code", 400}};
            res.code = 400;
            res.body = err.dump();
            return res;
        }
    });

    // ─── Chunked upload (large files) ───
    CROW_ROUTE(app, "/upload_session/cancel")
    .methods("POST"_method)
    ([this](const crow::request& req) {
        crow::response res;
        res.add_header("Access-Control-Allow-Origin", "*");
        res.add_header("Content-Type", "application/json; charset=utf-8");
        if (!validateUploadAuthorization(req)) {
            res.code = 401;
            res.body = json{{"error", "Unauthorized"}}.dump();
            return res;
        }
        try {
            const auto payload = json::parse(req.body);
            const std::string sessionId =
                payload.value("sessionId", std::string{});
            static const std::regex sessionPattern(
                R"(^(ios-[0-9]{10,20}|win-[a-f0-9]{32})$)");
            if (!std::regex_match(sessionId, sessionPattern)) {
                res.code = 400;
                res.body = json{{"error", "Invalid upload session"}}.dump();
                return res;
            }
            const size_t cancelledFiles =
                m_fileWriter->abortFilesWithPrefix(sessionId + "-");
            if (sessionId.rfind("win-", 0) == 0 && m_nativeSessionStore) {
                m_nativeSessionStore->cancelTransfer(
                    sessionId.substr(4), getTokenFromRequest(req));
            }
            res.code = 200;
            res.body = json{
                {"ok", true},
                {"cancelledFiles", cancelledFiles}
            }.dump();
        } catch (const std::exception&) {
            res.code = 400;
            res.body = json{{"error", "Invalid upload session request"}}.dump();
        }
        return res;
    });

    CROW_ROUTE(app, "/exchange_bootstrap")
    .methods("POST"_method)
    ([this](const crow::request& req) {
        crow::response res;
        res.add_header("Content-Type", "application/json; charset=utf-8");
        res.add_header("Cache-Control", "no-store, max-age=0");
        try {
            const json body = json::parse(req.body);
            const std::string bootstrap = body.value("bootstrap", "");
            std::string token;
            if (exchangeBrowserBootstrap(bootstrap, token)) {
                res.code = 200;
                res.body = json{{"token", token},
                    {"environment", m_runtimeEnvironment}}.dump();
            } else {
                res.code = 403;
                res.body = json{{"error", "Invalid or expired bootstrap"},
                    {"environment", m_runtimeEnvironment}}.dump();
            }
        } catch (...) {
            res.code = 400;
            res.body = json{{"error", "Invalid bootstrap request"},
                {"environment", m_runtimeEnvironment}}.dump();
        }
        return res;
    });

    CROW_ROUTE(app, "/upload_chunk")
    .methods("POST"_method)
    ([this](const crow::request& req) {
        crow::response res;
        res.add_header("Access-Control-Allow-Origin", "*");
        res.add_header("Content-Type", "application/json; charset=utf-8");

        if (!validateUploadAuthorization(req)) {
            res.code = 401;
            res.body = json{{"error", "Unauthorized"}}.dump();
            res.add_header("Connection", "close");
            return res;
        }

        try {
            std::string fileId = req.get_header_value("X-File-Id");
            std::string filename = urlDecode(req.get_header_value("X-Filename"));
            std::string chunkIndexHeader = req.get_header_value("X-Chunk-Index");
            std::string totalChunksHeader = req.get_header_value("X-Total-Chunks");
            std::string fileSizeHeader = req.get_header_value("X-File-Size");

            if (fileId.empty() || filename.empty() ||
                chunkIndexHeader.empty() || totalChunksHeader.empty() || fileSizeHeader.empty()) {
                res.code = 400;
                res.body = json{{"error", "Missing required chunk metadata"}}.dump();
                return res;
            }

            uint64_t chunkIndex = std::stoull(chunkIndexHeader);
            uint64_t totalChunks = std::stoull(totalChunksHeader);
            uint64_t fileSize = std::stoull(fileSizeHeader);
            const bool skipExactDuplicates =
                skipExactDuplicatesForRequest(req);

            const std::string nativeTransferId =
                req.get_header_value("X-Transfer-Id");
            if (!nativeTransferId.empty() &&
                !m_nativeSessionStore->authorizeFile(getTokenFromRequest(req),
                    nativeTransferId, fileId, filename, fileSize,
                    skipExactDuplicates)) {
                res.code = 403;
                res.body = json{{"error", "transfer_manifest_mismatch"}}.dump();
                return res;
            }

            if (totalChunks == 0 || chunkIndex >= totalChunks || fileSize == 0 || req.body.empty()) {
                res.code = 400;
                res.body = json{{"error", "Invalid chunk metadata or empty body"}}.dump();
                return res;
            }

            if (chunkIndex == 0) {
                if (!m_fileWriter->initFile(
                        fileId,
                        filename,
                        fileSize,
                        totalChunks,
                        skipExactDuplicates)) {
                    res.code = 409;
                    res.body = json{{"error", "File session already exists or could not be initialized"}}.dump();
                    return res;
                }
            }

            std::vector<unsigned char> decodedChunk;
            const bool base64Encoded =
                req.get_header_value("X-Content-Transfer-Encoding") == "base64";
            const char* chunkData = req.body.data();
            size_t chunkSize = req.body.size();
            if (base64Encoded) {
                decodedChunk = decodeBase64(req.body);
                chunkData = reinterpret_cast<const char*>(decodedChunk.data());
                chunkSize = decodedChunk.size();
            }

            const auto writeStarted = std::chrono::steady_clock::now();
            auto writeStatus = m_fileWriter->writeChunk(
                fileId,
                chunkIndex,
                chunkData,
                chunkSize);
            const double writeDurationMs = std::chrono::duration<double, std::milli>(
                std::chrono::steady_clock::now() - writeStarted).count();
            if (writeStatus != ChunkWriteStatus::Success &&
                writeStatus != ChunkWriteStatus::AlreadyAccepted &&
                writeStatus != ChunkWriteStatus::Completed) {
                if (writeStatus == ChunkWriteStatus::OutOfOrder ||
                    writeStatus == ChunkWriteStatus::UnknownFile) {
                    res.code = 409;
                    res.body = json{{"error", "Chunk is out of order or has no active file session"}}.dump();
                } else if (writeStatus == ChunkWriteStatus::SizeExceeded) {
                    res.code = 400;
                    res.body = json{{"error", "Chunk exceeds declared file size"}}.dump();
                } else if (writeStatus == ChunkWriteStatus::Finalizing) {
                    res.code = 503;
                    res.add_header("Retry-After", "1");
                    res.body = json{{"error", "Upload is still finalizing"}}.dump();
                } else {
                    res.code = 500;
                    res.body = json{{"error", "Failed to write chunk"}}.dump();
                }
                return res;
            }

            if (writeStatus == ChunkWriteStatus::Success && m_metrics) {
                m_metrics->recordBytes(chunkSize);
                if (m_pipeServer) {
                    m_pipeServer->sendMetrics(m_metrics->getRealtimeMetrics());
                }
            }

            FileFinalizeResult finalizeResult;
            bool finalizedNow = false;
            double finalizeDurationMs = 0.0;
            if (chunkIndex == totalChunks - 1 ||
                writeStatus == ChunkWriteStatus::Completed) {
                const auto finalizeStarted = std::chrono::steady_clock::now();
                finalizeResult = m_fileWriter->finalizeFileResult(
                    fileId,
                    &finalizedNow);
                finalizeDurationMs = std::chrono::duration<double, std::milli>(
                    std::chrono::steady_clock::now() - finalizeStarted).count();
                if (finalizeResult.disposition ==
                    FileFinalizeDisposition::Finalizing) {
                        res.code = 503;
                        res.add_header("Retry-After", "1");
                        res.body = json{{"error", "Upload is still finalizing"}}.dump();
                        return res;
                }
                if (finalizeResult.disposition ==
                    FileFinalizeDisposition::NameConflict) {
                    res.code = 409;
                    res.body = json{
                        {"error", "A different file already uses this filename"},
                        {"code", "filename_conflict"},
                        {"filename", finalizeResult.filename}
                    }.dump();
                    return res;
                }
                if (finalizeResult.disposition !=
                        FileFinalizeDisposition::Saved &&
                    finalizeResult.disposition !=
                        FileFinalizeDisposition::Duplicate) {
                    res.code = 400;
                    res.body = json{{"error", "File is incomplete and cannot be finalized"}}.dump();
                    return res;
                }

                if (finalizedNow) {
                    // Only the request that performed finalization records
                    // completion side effects. Retries return the same result.
                    const bool skipped =
                        finalizeResult.disposition ==
                        FileFinalizeDisposition::Duplicate;
                    if (!skipped) {
                        appendUploadMetadata(
                            m_config.uploadDir,
                            finalizeResult.filename,
                            filename,
                            req.remote_ip_address);
                    }

                    if (m_metrics) {
                        if (!skipped) {
                            lmt::FileTransferStats stats;
                            stats.originalName = filename;
                            stats.savedName = finalizeResult.filename;
                            stats.sizeBytes = fileSize;
                            stats.chunksReceived = totalChunks;
                            stats.chunksTotal = totalChunks;
                            stats.completed = true;
                            stats.hash = finalizeResult.sha256;
                            m_metrics->recordFileComplete(stats);
                        }

                        if (m_pipeServer) {
                            m_pipeServer->sendMetrics(m_metrics->getRealtimeMetrics());
                        }
                    }

                    if (m_pipeServer) {
                        m_pipeServer->sendLog(
                            "INFO",
                            skipped
                                ? "Skipped exact duplicate: " + finalizeResult.filename
                                : "Completed: " + finalizeResult.filename);
                    }
                    spdlog::info(
                        "{} file: {} ({} bytes)",
                        skipped ? "Skipped duplicate" : "Completed",
                        finalizeResult.filename,
                        fileSize);
                }
                if (!nativeTransferId.empty()) {
                    m_nativeSessionStore->markFileTerminal(
                        nativeTransferId, fileId);
                }
            }

            json response = {
                {"success", true},
                {"chunkIndex", chunkIndex},
                {"totalChunks", totalChunks},
                {"serverWriteDurationMs", writeDurationMs},
                {"serverFinalizeDurationMs", finalizeDurationMs}
            };
            if (!finalizeResult.filename.empty()) {
                response["filename"] = finalizeResult.filename;
                response["complete"] = true;
                response["skipped"] =
                    finalizeResult.disposition ==
                    FileFinalizeDisposition::Duplicate;
                response["sha256"] = finalizeResult.sha256;
            } else {
                response["complete"] = false;
            }

            res.code = 200;
            res.body = response.dump();
            return res;

        } catch (const std::exception& e) {
            spdlog::error("Chunk upload error: {}", e.what());
            res.code = 400;
            res.body = json{{"error", e.what()}}.dump();
            return res;
        }
    });

    // ─── Check file (hash-based duplicate detection) ───
    CROW_ROUTE(app, "/check_file")
    .methods("POST"_method)
    ([this](const crow::request& req) {
        crow::response res;
        res.add_header("Access-Control-Allow-Origin", "*");
        res.add_header("Content-Type", "application/json; charset=utf-8");

        // Require token for check_file
        if (!validateRequestToken(req)) {
            res.code = 403;
            res.body = json{{"error", "Invalid token"}}.dump();
            return res;
        }

        try {
            auto body = json::parse(req.body);
            std::string hash = body.value("hash", "");

            if (hash.empty()) {
                res.code = 400;
                res.body = json{{"error", "Hash required"}}.dump();
                return res;
            }
            if (hash.size() != 64 ||
                !std::all_of(hash.begin(), hash.end(), [](unsigned char ch) {
                    return std::isxdigit(ch) != 0;
                })) {
                res.code = 400;
                res.body = json{{"error", "A full SHA-256 digest is required"}}.dump();
                return res;
            }

            auto [exists, filename] = m_fileWriter->isDuplicate(hash);

            json response = {
                {"exists", exists},
                {"filename", filename}
            };
            res.code = 200;
            res.body = response.dump();

        } catch (const std::exception& e) {
            json err = {{"error", "Invalid request"}, {"code", 400}};
            res.code = 400;
            res.body = err.dump();
        }

        return res;
    });

    // ─── Serve index.html at root ───
    CROW_ROUTE(app, "/")
    ([this](const crow::request& req) {
        if (m_pipeServer && req.remote_ip_address != "127.0.0.1" && req.remote_ip_address != "::1") {
            m_pipeServer->sendLog("INFO", "Device connected: " + req.remote_ip_address);
        }

        std::filesystem::path indexPath = std::filesystem::path(m_config.staticDir) / "index.html";
        std::ifstream file(indexPath);
        crow::response res;
        if (file.is_open()) {
            std::stringstream buffer;
            buffer << file.rdbuf();
            res.body = buffer.str();
            res.add_header("Content-Type", "text/html; charset=utf-8");
            res.add_header("Cache-Control", "no-store, max-age=0");
            res.add_header("Pragma", "no-cache");
            res.add_header("Referrer-Policy", "no-referrer");
            res.add_header("X-Content-Type-Options", "nosniff");
            res.add_header("Content-Security-Policy",
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
                "img-src 'self' data:; connect-src 'self'; object-src 'none'; "
                "base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
            res.code = 200;
        } else {
            res.code = 404;
            res.body = "Not found";
        }
        return res;
    });




    // Also serve top-level style.css and js files for legacy compatibility
    CROW_ROUTE(app, "/style.css")
    ([this]() {
        std::filesystem::path stylePath = std::filesystem::path(m_config.staticDir) / "style.css";
        std::ifstream file(stylePath);
        crow::response res;
        if (file.is_open()) {
            std::stringstream buffer;
            buffer << file.rdbuf();
            res.body = buffer.str();
            res.add_header("Content-Type", "text/css; charset=utf-8");
            res.code = 200;
        } else {
            res.code = 404;
            res.body = "Not found";
        }
        return res;
    });
}

std::string HttpServer::getTokenFromRequest(const crow::request& req) const {
    // Accept both legacy X-Upload-Token and new X-Session-Token
    auto token = req.get_header_value("X-Upload-Token");
    if (token.empty()) {
        token = req.get_header_value("X-Session-Token");
    }
    // Also try JSON body for verify_token endpoint
    if (token.empty()) {
        try {
            auto body = json::parse(req.body);
            token = body.value("token", "");
        } catch (...) {}
    }
    return token;
}

bool HttpServer::validateToken(const std::string& token) const {
    std::string sessionToken;
    {
        std::lock_guard<std::mutex> lock(m_authMutex);
        sessionToken = m_config.token;
    }
    if (sessionToken.empty()) {
        return false;
    }
    return token == sessionToken ||
        (m_pairingStore && m_pairingStore->validateCredential(token));
}

bool HttpServer::validateAnyToken(const std::string& token) const {
    if (validateToken(token)) return true;
    return m_pairingStore && m_pairingStore->findDeviceByCredential(token).has_value();
}

bool HttpServer::validateUploadAuthorization(const crow::request& req) const {
    const std::string transferId = req.get_header_value("X-Transfer-Id");
    if (!transferId.empty()) {
        return m_nativeSessionStore && m_nativeSessionStore->authorizeTransfer(
            getTokenFromRequest(req), transferId);
    }
    return validateToken(getTokenFromRequest(req));
}

bool HttpServer::validateRequestToken(const crow::request& req) const {
    if (validateToken(getTokenFromRequest(req))) {
        return true;
    }
    spdlog::warn("Unauthorized request: token mismatch for {} from {}",
                 req.url, req.remote_ip_address);
    return false;
}

asio::ssl::context HttpServer::createTlsContext(
    const std::string& certificatePem,
    const std::string& privateKeyPem) {
    asio::ssl::context context(asio::ssl::context::tls_server);
    context.set_verify_mode(asio::ssl::verify_none);
    context.set_options(
        asio::ssl::context::default_workarounds |
        asio::ssl::context::no_sslv2 |
        asio::ssl::context::no_sslv3 |
        asio::ssl::context::no_tlsv1 |
        asio::ssl::context::no_tlsv1_1 |
        asio::ssl::context::no_compression);
    if (SSL_CTX_set_min_proto_version(context.native_handle(), TLS1_2_VERSION) != 1 ||
        SSL_CTX_set_max_proto_version(context.native_handle(), TLS1_3_VERSION) != 1 ||
        SSL_CTX_set_max_early_data(context.native_handle(), 0) != 1) {
        throw std::runtime_error("Unable to configure TLS 1.2/1.3 policy");
    }
    context.use_certificate_chain(asio::buffer(certificatePem));
    context.use_private_key(asio::buffer(privateKeyPem), asio::ssl::context::pem);
    return context;
}

void HttpServer::setToken(const std::string& token) {
    std::lock_guard<std::mutex> lock(m_authMutex);
    m_config.token = token;
    m_browserBootstrap.clear();
    m_browserBootstrapExpiresAt = {};
}

void HttpServer::beginNativePairingWindow() {
    if (m_nativeSessionStore) m_nativeSessionStore->beginPairingWindow();
}

void HttpServer::endNativePairingWindow() {
    if (m_nativeSessionStore) m_nativeSessionStore->endPairingWindow();
}

bool HttpServer::approveNativePairing(const std::string& requestId) {
    return m_nativeSessionStore && m_nativeSessionStore->approvePairing(requestId);
}

bool HttpServer::denyNativePairing(const std::string& requestId) {
    return m_nativeSessionStore && m_nativeSessionStore->denyPairing(requestId);
}

bool HttpServer::approveNativeTransfer(const std::string& requestId) {
    return m_nativeSessionStore && m_nativeSessionStore->approveTransfer(requestId);
}

bool HttpServer::denyNativeTransfer(const std::string& requestId) {
    return m_nativeSessionStore && m_nativeSessionStore->denyTransfer(requestId);
}

void HttpServer::revokeNativeDevice(const std::string& deviceId) {
    if (m_nativeSessionStore) m_nativeSessionStore->revokeDevice(deviceId);
}

void HttpServer::revokeAllNativeSessions() {
    if (m_nativeSessionStore) m_nativeSessionStore->revokeAll();
}

bool HttpServer::validateSessionToken(const std::string& token) const {
    std::lock_guard<std::mutex> lock(m_authMutex);
    return !m_config.token.empty() && token == m_config.token;
}

bool HttpServer::setBrowserBootstrap(const std::string& bootstrap) {
    if (bootstrap.size() != 64 ||
        !std::all_of(bootstrap.begin(), bootstrap.end(), [](unsigned char value) {
            return std::isxdigit(value) != 0;
        })) {
        return false;
    }
    std::lock_guard<std::mutex> lock(m_authMutex);
    m_browserBootstrap = bootstrap;
    m_browserBootstrapExpiresAt =
        std::chrono::steady_clock::now() +
        std::chrono::seconds(BrowserBootstrapLifetimeSeconds);
    return true;
}

bool HttpServer::exchangeBrowserBootstrap(
    const std::string& bootstrap,
    std::string& token) {
    std::lock_guard<std::mutex> lock(m_authMutex);
    if (bootstrap.size() != m_browserBootstrap.size() ||
        bootstrap.empty() ||
        std::chrono::steady_clock::now() > m_browserBootstrapExpiresAt ||
        CRYPTO_memcmp(
            bootstrap.data(),
            m_browserBootstrap.data(),
            bootstrap.size()) != 0) {
        return false;
    }
    token = m_config.token;
    m_browserBootstrap.clear();
    m_browserBootstrapExpiresAt = {};
    return !token.empty();
}

void HttpServer::run(std::atomic<bool>& running) {
    m_running = true;

    spdlog::info("Starting HTTPS server on port {}", m_httpsPort);
    if (m_allowInsecureHttp) {
        spdlog::warn("Insecure HTTP fallback enabled on port {}", m_httpPort);
    }

    std::future<void> httpsFuture;
    std::future<void> httpFuture;
    std::exception_ptr failure;
    try {
        m_httpsApp.bindaddr("0.0.0.0")
            .port(static_cast<uint16_t>(m_httpsPort))
            .multithreaded()
            .signal_clear()
            .ssl(createTlsContext(m_certificatePem, m_privateKeyPem));
        httpsFuture = m_httpsApp.run_async();
        if (m_allowInsecureHttp) {
            m_httpApp.bindaddr("0.0.0.0")
                .port(static_cast<uint16_t>(m_httpPort))
                .multithreaded()
                .signal_clear();
            httpFuture = m_httpApp.run_async();
        }

        const auto startupDeadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
        while (std::chrono::steady_clock::now() < startupDeadline &&
               (!m_httpsApp.is_bound() || (m_allowInsecureHttp && !m_httpApp.is_bound()))) {
            if (httpsFuture.wait_for(std::chrono::milliseconds(0)) == std::future_status::ready ||
                (m_allowInsecureHttp && httpFuture.wait_for(std::chrono::milliseconds(0)) == std::future_status::ready)) {
                throw std::runtime_error("A configured server listener stopped during startup");
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(25));
        }
        if (!m_httpsApp.is_bound() || (m_allowInsecureHttp && !m_httpApp.is_bound())) {
            throw std::runtime_error("A configured server listener did not bind within five seconds");
        }

        while (running && m_running) {
            if (httpsFuture.wait_for(std::chrono::milliseconds(0)) == std::future_status::ready ||
                (m_allowInsecureHttp && httpFuture.wait_for(std::chrono::milliseconds(0)) == std::future_status::ready)) {
                throw std::runtime_error("A configured server listener stopped unexpectedly");
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
    } catch (const std::exception& e) {
        spdlog::error("Exception in HTTP server run loop: {}", e.what());
        failure = std::current_exception();
    } catch (...) {
        spdlog::error("Unknown exception in HTTP server run loop");
        failure = std::current_exception();
    }

    m_httpsApp.stop();
    if (m_allowInsecureHttp) m_httpApp.stop();
    if (httpsFuture.valid()) httpsFuture.wait();
    if (httpFuture.valid()) httpFuture.wait();
    m_running = false;
    if (failure) std::rethrow_exception(failure);
}

void HttpServer::stop() {
    if (m_running) {
        m_httpsApp.stop();
        if (m_allowInsecureHttp) m_httpApp.stop();
        m_running = false;
        spdlog::info("HTTP server stopped");
    }
}
