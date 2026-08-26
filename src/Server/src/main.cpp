/**
 * LocalMediaTransferServer - Main Entry Point
 * 
 * High-performance HTTP server for local network file transfers.
 * Designed for transferring photos/videos from iPhone to Windows PC.
 * 
 * Architecture:
 * - Crow HTTP server for request handling
 * - Memory-mapped file writing for reduced-copy I/O
 * - Named Pipes for IPC with C# GUI
 * - OpenSSL for SHA256 hashing (duplicate detection)
 */

#include <iostream>
#include <string>
#include <thread>
#include <atomic>
#include <csignal>
#include <filesystem>
#include <cstdlib>
#include <array>
#include <optional>
#include <vector>
#include <limits>
#include "io/HashEngine.hpp"
#include "ipc/ServerOwnership.hpp"
#include "benchmark/BenchmarkStore.hpp"
#include "history/TransferHistoryStore.hpp"
#include "security/PairingStore.hpp"
#include "security/NativeSessionStore.hpp"
#include "discovery/DiscoveryServer.hpp"
#include "config/RuntimeEnvironment.hpp"
#include "common/Version.hpp"

#ifdef _WIN32
#include <windows.h>
#include <winsock2.h>
#include <ws2tcpip.h>
#include <iphlpapi.h>
#pragma comment(lib, "iphlpapi.lib")
#pragma comment(lib, "ws2_32.lib")
#endif

#include <spdlog/spdlog.h>
#include <spdlog/sinks/stdout_color_sinks.h>
#include <spdlog/sinks/rotating_file_sink.h>
#include <openssl/rand.h>
#include <openssl/crypto.h>
#include <nlohmann/json.hpp>

#include "server/HttpServer.hpp"
#include "security/TlsIdentity.hpp"
#include "ipc/PipeServer.hpp"
#include "stats/MetricsCollector.hpp"

// Global shutdown flag
std::atomic<bool> g_running{true};

#ifdef _WIN32
static HANDLE g_singleInstanceMutex = nullptr;

bool acquireSingleInstanceGuard(const std::string& mutexName) {
    g_singleInstanceMutex = CreateMutexA(nullptr, FALSE, mutexName.c_str());
    if (!g_singleInstanceMutex) {
        throw std::runtime_error(
            "Unable to create the single-instance mutex: " +
            std::to_string(GetLastError()));
    }

    return GetLastError() != ERROR_ALREADY_EXISTS;
}

void releaseSingleInstanceGuard() {
    if (g_singleInstanceMutex) {
        CloseHandle(g_singleInstanceMutex);
        g_singleInstanceMutex = nullptr;
    }
}
#endif

std::string generateSecureToken() {
    std::array<unsigned char, 32> bytes{};
    if (RAND_priv_bytes(bytes.data(), static_cast<int>(bytes.size())) != 1) {
        throw std::runtime_error("Unable to generate a secure session token");
    }

    static constexpr char Hex[] = "0123456789abcdef";
    std::string token;
    token.reserve(bytes.size() * 2);
    for (const unsigned char value : bytes) {
        token.push_back(Hex[value >> 4]);
        token.push_back(Hex[value & 0x0f]);
    }
    return token;
}

void signalHandler(int signal) {
    // Note: spdlog is not async-signal-safe, so we only set the atomic flag here.
    g_running = false;
}

void setupLogging(const std::filesystem::path& requestedLogPath) {
    try {
        std::filesystem::path logFilePath = requestedLogPath;
        std::error_code ec;
        std::filesystem::create_directories(logFilePath.parent_path(), ec);
        if (ec) {
            logFilePath = std::filesystem::path("logs") / "server.log";
            ec.clear();
            std::filesystem::create_directories(logFilePath.parent_path(), ec);
        }

        auto console_sink = std::make_shared<spdlog::sinks::stdout_color_sink_mt>();
        console_sink->set_level(spdlog::level::info);
        
        auto file_sink = std::make_shared<spdlog::sinks::rotating_file_sink_mt>(
            logFilePath.string(), 1024 * 1024 * 5, 3  // 5MB, 3 files
        );
        file_sink->set_level(spdlog::level::debug);
        
        auto logger = std::make_shared<spdlog::logger>("main", 
            spdlog::sinks_init_list{console_sink, file_sink});
        logger->set_level(spdlog::level::debug);
        
        spdlog::set_default_logger(logger);
        spdlog::set_pattern("[%Y-%m-%d %H:%M:%S.%e] [%^%l%$] [%t] %v");
        
        spdlog::info("Logging initialized: {}", logFilePath.string());
    } catch (const std::exception& e) {
        std::cerr << "Failed to initialize logging: " << e.what() << std::endl;
    }
}

#ifdef _WIN32
/**
 * Detect the best local network IP address for mobile devices to connect.
 * Prefers Wi-Fi/Ethernet adapters over virtual ones (Hyper-V, VPN, etc.)
 */
std::string getLanIpAddress() {
    ULONG bufLen = 0;
    GetAdaptersAddresses(AF_INET, GAA_FLAG_SKIP_DNS_SERVER | GAA_FLAG_SKIP_MULTICAST, nullptr, nullptr, &bufLen);
    
    std::vector<uint8_t> buf(bufLen);
    auto* addrs = reinterpret_cast<IP_ADAPTER_ADDRESSES*>(buf.data());
    
    if (GetAdaptersAddresses(AF_INET, GAA_FLAG_SKIP_DNS_SERVER | GAA_FLAG_SKIP_MULTICAST, nullptr, addrs, &bufLen) != NO_ERROR) {
        return "";
    }
    
    std::string bestIp;
    
    for (auto* adapter = addrs; adapter; adapter = adapter->Next) {
        // Skip loopback, tunnel, and down adapters
        if (adapter->IfType == IF_TYPE_SOFTWARE_LOOPBACK) continue;
        if (adapter->IfType == IF_TYPE_TUNNEL) continue;
        if (adapter->OperStatus != IfOperStatusUp) continue;
        
        // Skip common virtual adapter names
        std::wstring desc(adapter->Description);
        if (desc.find(L"Hyper-V") != std::wstring::npos) continue;
        if (desc.find(L"Virtual") != std::wstring::npos) continue;
        if (desc.find(L"VPN") != std::wstring::npos) continue;
        if (desc.find(L"Tailscale") != std::wstring::npos) continue;
        
        for (auto* ua = adapter->FirstUnicastAddress; ua; ua = ua->Next) {
            auto* sa = reinterpret_cast<sockaddr_in*>(ua->Address.lpSockaddr);
            char ip[INET_ADDRSTRLEN];
            inet_ntop(AF_INET, &sa->sin_addr, ip, sizeof(ip));
            
            std::string ipStr(ip);
            if (ipStr == "127.0.0.1" || ipStr == "0.0.0.0") continue;
            
            // Prefer Wi-Fi and Ethernet
            if (adapter->IfType == IF_TYPE_IEEE80211 || adapter->IfType == IF_TYPE_ETHERNET_CSMACD) {
                return ipStr; // Best match, return immediately
            }
            
            if (bestIp.empty()) bestIp = ipStr; // Fallback
        }
    }
    
    return bestIp;
}
#endif

int main(int argc, char* argv[]) {
    // Parse command line arguments
    std::optional<int> httpsPortOverride;
    std::optional<int> httpPortOverride;
    bool allowInsecureHttp = false;
    bool resetTlsIdentity = false;
    std::string tlsStorageDir;
    std::string uploadDir;
    std::string staticDir = ""; // Will be auto-resolved if empty
    bool benchmarkMode = false;
    std::string benchmarkDbPath;
    std::string historyDbPath;
    std::string dataRootOverride;
    std::string environmentName = "production";
    std::string instanceId;
    bool printRuntimeConfig = false;
    bool controlTokenFromStdin = false;
    uint32_t ownerProcessId = 0;
    uint64_t ownerProcessStartTimeUtcFileTime = 0;
    std::string controlInstanceId;
    lmt::FilenameConflictPolicy filenameConflictPolicy =
        lmt::FilenameConflictPolicy::KeepBoth;

    try {
        for (int i = 1; i < argc; i++) {
            std::string arg = argv[i];
            auto nextValue = [&]() -> std::string {
                if (i + 1 >= argc) {
                    throw std::invalid_argument("Missing value for " + arg);
                }
                return argv[++i];
            };
            auto nextPort = [&]() -> int {
                const std::string value = nextValue();
                size_t parsed = 0;
                const int port = std::stoi(value, &parsed);
                if (parsed != value.size()) {
                    throw std::invalid_argument("Invalid port for " + arg + ": " + value);
                }
                return port;
            };

            if (arg == "--https-port" || arg == "--port") {
                httpsPortOverride = nextPort();
            } else if (arg == "--http-port") {
                httpPortOverride = nextPort();
            } else if (arg == "--allow-insecure-http") {
                allowInsecureHttp = true;
            } else if (arg == "--tls-storage-dir") {
                tlsStorageDir = nextValue();
            } else if (arg == "--reset-tls-identity") {
                resetTlsIdentity = true;
            } else if (arg == "--upload-dir") {
                uploadDir = nextValue();
            } else if (arg == "--static-dir") {
                staticDir = nextValue();
            } else if (arg == "--benchmark-mode") {
                benchmarkMode = true;
            } else if (arg == "--benchmark-db") {
                benchmarkDbPath = nextValue();
            } else if (arg == "--history-db") {
                historyDbPath = nextValue();
            } else if (arg == "--data-root") {
                dataRootOverride = nextValue();
            } else if (arg == "--environment") {
                environmentName = nextValue();
            } else if (arg == "--instance-id") {
                instanceId = nextValue();
            } else if (arg == "--print-runtime-config") {
                printRuntimeConfig = true;
            } else if (arg == "--control-token-stdin") {
                controlTokenFromStdin = true;
            } else if (arg == "--owner-process-id") {
                const auto value = std::stoull(nextValue());
                if (value == 0 || value > std::numeric_limits<uint32_t>::max()) {
                    throw std::invalid_argument("Invalid --owner-process-id");
                }
                ownerProcessId = static_cast<uint32_t>(value);
            } else if (arg == "--owner-process-start-time") {
                ownerProcessStartTimeUtcFileTime = std::stoull(nextValue());
                if (ownerProcessStartTimeUtcFileTime == 0) {
                    throw std::invalid_argument("Invalid --owner-process-start-time");
                }
            } else if (arg == "--control-instance-id") {
                controlInstanceId = nextValue();
            } else if (arg == "--filename-conflict") {
                const std::string value = nextValue();
                if (value == "keep-both") {
                    filenameConflictPolicy = lmt::FilenameConflictPolicy::KeepBoth;
                } else if (value == "reject") {
                    filenameConflictPolicy = lmt::FilenameConflictPolicy::Reject;
                } else {
                    throw std::invalid_argument(
                        "--filename-conflict must be keep-both or reject");
                }
            } else if (arg == "--help") {
                std::cout << "LocalMediaTransferServer v" << lmt::Version << "\n"
                          << "Usage: " << argv[0] << " [options]\n"
                          << "Options:\n"
                          << "  --environment <production|test|benchmark>\n"
                          << "                       Runtime identity (default: production)\n"
                          << "  --instance-id <id>   Per-run test/benchmark identity\n"
                          << "  --data-root <path>   Test/benchmark runtime-data override\n"
                          << "  --print-runtime-config Print validated identity without starting\n"
                          << "  --control-token-stdin Read the local ownership key from stdin\n"
                          << "  --owner-process-id <pid> GUI owner process ID\n"
                          << "  --owner-process-start-time <filetime> GUI creation FILETIME\n"
                          << "  --control-instance-id <id> GUI launch ownership identity\n"
                          << "  --https-port <port>  HTTPS port (production default: 8443)\n"
                          << "  --http-port <port>   HTTP fallback port (production default: 8080)\n"
                          << "  --allow-insecure-http Enable the HTTP fallback listener\n"
                          << "  --tls-storage-dir <path> Override TLS identity storage\n"
                          << "  --reset-tls-identity Remove the stored TLS identity before start\n"
                          << "  --upload-dir <path>  Upload directory (production default: uploads)\n"
                          << "  --static-dir <path>  Static web assets directory (default: auto)\n"
                          << "  --benchmark-mode     Enable private developer benchmark routes\n"
                          << "  --benchmark-db <path> Override benchmark SQLite database path\n"
                          << "  --history-db <path>   Override transfer history database path\n"
                          << "  --filename-conflict <keep-both|reject>\n"
                          << "                       Same-name policy (default: keep-both)\n"
                          << "  --help               Show this help\n";
                return 0;
            } else {
                throw std::invalid_argument("Unknown option: " + arg);
            }
        }
    } catch (const std::exception& error) {
        std::cerr << error.what() << "\n";
        return 1;
    }
    const std::filesystem::path localAppDataRoot =
        std::getenv("LOCALAPPDATA") && *std::getenv("LOCALAPPDATA")
            ? std::filesystem::u8path(std::getenv("LOCALAPPDATA"))
            : std::filesystem::temp_directory_path();
    lmt::RuntimeEnvironmentConfig runtimeConfig;
    try {
        runtimeConfig = lmt::makeRuntimeEnvironmentConfig(
            lmt::parseRuntimeEnvironment(environmentName),
            localAppDataRoot,
            instanceId);
    } catch (const std::exception& error) {
        std::cerr << error.what() << "\n";
        return 1;
    }
    if (!dataRootOverride.empty()) {
        if (runtimeConfig.environment == lmt::RuntimeEnvironment::Production) {
            std::cerr << "--data-root is available only in test and benchmark environments\n";
            return 1;
        }
        std::error_code dataRootError;
        runtimeConfig.dataRoot = std::filesystem::absolute(
            std::filesystem::u8path(dataRootOverride), dataRootError);
        if (dataRootError) {
            std::cerr << "Unable to resolve --data-root: " << dataRootError.message() << "\n";
            return 1;
        }
    }

    if (printRuntimeConfig) {
        const nlohmann::json output = {
            {"environment", runtimeConfig.name},
            {"dataNamespace", runtimeConfig.dataNamespace},
            {"dataRoot", runtimeConfig.dataRoot.u8string()},
            {"pipeName", runtimeConfig.pipeName},
            {"mutexName", runtimeConfig.mutexName},
            {"httpsPort", runtimeConfig.defaultHttpsPort},
            {"httpPort", runtimeConfig.defaultHttpPort},
            {"discoveryPort", runtimeConfig.discoveryPort},
            {"discoveryAllowed", runtimeConfig.discoveryAllowed}
        };
        std::cout << output.dump() << '\n';
        return 0;
    }

    const bool hasOwnershipMetadata = ownerProcessId != 0 ||
        ownerProcessStartTimeUtcFileTime != 0 || !controlInstanceId.empty() ||
        controlTokenFromStdin;
    std::string controlToken;
    if (hasOwnershipMetadata) {
        if (!controlTokenFromStdin || ownerProcessId == 0 ||
            ownerProcessStartTimeUtcFileTime == 0 || controlInstanceId.empty()) {
            std::cerr << "Incomplete server ownership metadata\n";
            return 1;
        }
        if (controlInstanceId.size() > 128 ||
            controlInstanceId.find_first_not_of(
                "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_") !=
                std::string::npos) {
            std::cerr << "Invalid --control-instance-id\n";
            return 1;
        }
        if (!std::getline(std::cin, controlToken)) {
            std::cerr << "Unable to read the server ownership key from stdin\n";
            return 1;
        }
        if (!controlToken.empty() && controlToken.back() == '\r') {
            controlToken.pop_back();
        }
        if (!ServerOwnershipController::isValidControlToken(controlToken)) {
            std::cerr << "Invalid server ownership key\n";
            return 1;
        }
    }

    const bool benchmarkEnvironment =
        runtimeConfig.environment == lmt::RuntimeEnvironment::Benchmark;
    if (benchmarkMode != benchmarkEnvironment) {
        std::cerr << "The benchmark environment and --benchmark-mode must be enabled together\n";
        return 1;
    }
    if (!benchmarkDbPath.empty() && !benchmarkMode) {
        std::cerr << "--benchmark-db requires the benchmark environment and --benchmark-mode\n";
        return 1;
    }
    if (benchmarkEnvironment && instanceId.empty()) {
        std::cerr << "The benchmark environment requires --instance-id\n";
        return 1;
    }
    if (benchmarkEnvironment && uploadDir.empty()) {
        std::cerr << "The benchmark environment requires an explicit --upload-dir\n";
        return 1;
    }
    if (benchmarkEnvironment && (!httpsPortOverride || !httpPortOverride)) {
        std::cerr << "The benchmark environment requires explicit --https-port and --http-port values\n";
        return 1;
    }

    const int httpsPort = httpsPortOverride.value_or(runtimeConfig.defaultHttpsPort);
    const int httpPort = httpPortOverride.value_or(runtimeConfig.defaultHttpPort);
    if (httpsPort < 1 || httpsPort > 65535 || httpPort < 1 || httpPort > 65535 ||
        (allowInsecureHttp && httpsPort == httpPort)) {
        std::cerr << "HTTPS and HTTP ports must be distinct values from 1 through 65535\n";
        return 1;
    }

    const std::filesystem::path appData = runtimeConfig.dataRoot;
    if (uploadDir.empty()) {
        uploadDir = runtimeConfig.environment == lmt::RuntimeEnvironment::Production
            ? "uploads"
            : (appData / "uploads").u8string();
    }
    if (tlsStorageDir.empty()) tlsStorageDir = (appData / "security").u8string();
    if (historyDbPath.empty()) {
        historyDbPath = (appData / "history" / "transfers.db").u8string();
    }
    if (benchmarkMode && benchmarkDbPath.empty()) {
        benchmarkDbPath = (appData / "benchmarks" / "benchmarks.db").u8string();
    }
    
    // Resolve runtime paths before changing CWD.
    try {
        auto resolvePath = [](const std::string& value, const char* option) {
            std::error_code pathError;
            auto resolved = std::filesystem::absolute(
                std::filesystem::u8path(value), pathError);
            if (pathError) {
                throw std::runtime_error(
                    std::string("Unable to resolve ") + option + ": " + pathError.message());
            }
            return resolved.u8string();
        };
        uploadDir = resolvePath(uploadDir, "--upload-dir");
        tlsStorageDir = resolvePath(tlsStorageDir, "--tls-storage-dir");
        historyDbPath = resolvePath(historyDbPath, "--history-db");
        if (!benchmarkDbPath.empty()) {
            benchmarkDbPath = resolvePath(benchmarkDbPath, "--benchmark-db");
        }
    } catch (const std::exception& error) {
        std::cerr << error.what() << "\n";
        return 1;
    }
    
    // Change CWD to executable directory so Crow's built-in static handler works
    std::error_code ec;
    auto exePath = std::filesystem::canonical(std::filesystem::path(argv[0]), ec);
    if (!ec) {
        std::filesystem::current_path(exePath.parent_path());
        if (staticDir.empty()) staticDir = "static";
    } else if (staticDir.empty()) {
        staticDir = "static";
    }
    
    // Setup
    setupLogging(appData / "logs" / "server.log");
    spdlog::info(
        "Runtime environment: {}, Namespace: {}, Instance: {}",
        runtimeConfig.name,
        runtimeConfig.dataNamespace,
        instanceId.empty() ? "default" : instanceId);

#ifdef _WIN32
    try {
        if (!acquireSingleInstanceGuard(runtimeConfig.mutexName)) {
            spdlog::error(
                "Another LocalMediaTransferServer instance is already running for {}. Exiting.",
                runtimeConfig.name);
            return 2;
        }
    } catch (const std::exception& error) {
        spdlog::error("Unable to establish single-instance ownership: {}", error.what());
        return 1;
    }
#endif

    std::optional<TlsIdentity> tlsIdentityValue;
    try {
        if (resetTlsIdentity) TlsIdentity::reset(std::filesystem::u8path(tlsStorageDir));
        tlsIdentityValue = TlsIdentity::loadOrCreate(std::filesystem::u8path(tlsStorageDir));
    } catch (const std::exception& error) {
        spdlog::error("Unable to initialize HTTPS identity: {}", error.what());
        return 1;
    }
    const TlsIdentity& tlsIdentity = *tlsIdentityValue;

    std::signal(SIGINT, signalHandler);
    std::signal(SIGTERM, signalHandler);
    
    std::string defaultToken;
    try {
        defaultToken = generateSecureToken();
    } catch (const std::exception& error) {
        spdlog::error("Unable to initialize authentication: {}", error.what());
        return 1;
    }
    
    spdlog::info("LocalMediaTransferServer v{}", lmt::Version);
    spdlog::info("[native_windows_diagnostic] {}",
        nlohmann::json{{"event", "receiver_server_started"}}.dump());
    spdlog::default_logger()->flush();
    spdlog::info("HTTPS port: {}, Upload dir: {}, Static dir: {}", httpsPort, uploadDir, staticDir);
    spdlog::info("TLS certificate SHA-256: {}", tlsIdentity.fingerprint());
    spdlog::info("TLS certificate expires: {}", tlsIdentity.expiresAt());
    spdlog::info("--------------------------------------------------");
    spdlog::info("Server is running!");
    std::cout << "  PC (localhost):  https://localhost:" << httpsPort
              << "/?token=" << defaultToken << "\n";
#ifdef _WIN32
    std::string lanIp = getLanIpAddress();
    if (!lanIp.empty()) {
        std::cout << "  Phone (Wi-Fi):   https://" << lanIp << ':' << httpsPort
                  << "/?token=" << defaultToken << "\n";
        if (allowInsecureHttp) {
            std::cout << "  Insecure fallback: http://" << lanIp << ':' << httpPort
                      << "/?token=" << defaultToken << "\n";
        }
    } else {
        spdlog::warn("  Could not detect LAN IP. Connect your phone using your PC's IP address.");
    }
#endif
    spdlog::info("--------------------------------------------------");
    
    try {
        // Initialize components
        auto metrics = std::make_shared<MetricsCollector>();
        auto pipeServer = std::make_shared<PipeServer>(runtimeConfig.pipeName);
        const std::string runtimeInstanceId =
            instanceId.empty() ? "default" : instanceId;
        auto ownershipController = std::make_shared<ServerOwnershipController>(
            ServerOwnershipIdentity{
                static_cast<uint32_t>(GetCurrentProcessId()),
                ServerOwnershipController::currentProcessStartTimeUtcFileTime(),
                ownerProcessId,
                ownerProcessStartTimeUtcFileTime,
                runtimeConfig.name,
                runtimeInstanceId,
                controlInstanceId,
                runtimeConfig.pipeName},
            controlToken);
        pipeServer->setAuthenticationRequired(ownershipController->enabled());
        if (!controlToken.empty()) {
            OPENSSL_cleanse(controlToken.data(), controlToken.size());
            controlToken.clear();
        }
        auto hashEngine = std::make_shared<HashEngine>();
        auto historyStore = std::make_shared<TransferHistoryStore>();
        std::shared_ptr<BenchmarkStore> benchmarkStore;
        
        std::filesystem::path metaDir = std::filesystem::u8path(uploadDir) / "_dont_delete";
        std::filesystem::create_directories(metaDir);
        std::string hashDbPath = (metaDir / "hashes.db").u8string();
        hashEngine->openDatabase(hashDbPath);

        historyStore->open(historyDbPath);
        auto pairingStore = std::make_shared<PairingStore>(
            (std::filesystem::u8path(historyDbPath).parent_path() / "trusted-devices.json").u8string());
        pairingStore->load();

        char computerName[MAX_COMPUTERNAME_LENGTH + 1]{};
        DWORD computerNameLength = MAX_COMPUTERNAME_LENGTH + 1;
        GetComputerNameA(computerName, &computerNameLength);
        const std::string serverId = fmt::format("{:x}",
            std::hash<std::string>{}(std::string(computerName) + appData.u8string()));
        spdlog::info("Server ID: {}", serverId);
        auto nativeSessionStore = std::make_shared<NativeSessionStore>(
            pairingStore, pipeServer, serverId, tlsIdentity.fingerprint(),
            runtimeConfig.name);

        if (benchmarkMode) {
            benchmarkStore = std::make_shared<BenchmarkStore>();
            benchmarkStore->open(benchmarkDbPath);
            spdlog::warn("Developer benchmark mode enabled");
        }
        
        // Initialize HTTP server first so if directory creation fails and throws,
        // we don't have a dangling pipeThread that calls std::terminate().
        HttpServer httpServer(
            httpsPort,
            httpPort,
            allowInsecureHttp,
            tlsIdentity.certificatePem(),
            tlsIdentity.privateKeyPem(),
            runtimeConfig.name,
            uploadDir,
            staticDir,
            defaultToken,
            metrics,
            pipeServer,
            hashEngine,
            benchmarkStore,
            historyStore,
            pairingStore,
            nativeSessionStore,
            filenameConflictPolicy);

        auto discoveryServer = std::make_shared<DiscoveryServer>(serverId, computerName,
            httpsPort, tlsIdentity.fingerprint(), allowInsecureHttp ? httpPort : 0,
            runtimeConfig.discoveryPort, runtimeConfig.discoveryAllowed,
            runtimeConfig.name);
        
        // Wire up pipe commands → HTTP server
        pipeServer->setCommandCallback([&httpServer, &historyStore, &pipeServer, &pairingStore, &discoveryServer, &ownershipController](const std::string& type, const std::string& data) -> PipeServer::CommandResult {
            if (type == "set_token") {
                if (data.size() < 32 || data.size() > 128 ||
                    !std::all_of(data.begin(), data.end(), [](unsigned char value) {
                        return std::isxdigit(value) != 0;
                    })) {
                    return {false, "invalid session token"};
                }
                httpServer.setToken(data);
                spdlog::info("Token set via pipe: {}****", data.substr(0, std::min(size_t(3), data.size())));
                pipeServer->sendTransferHistory(historyStore->recentSessionsJson());
            } else if (type == "request_transfer_history") {
                pipeServer->sendTransferHistory(historyStore->recentSessionsJson());
            } else if (type == "clear_transfer_history") {
                historyStore->clear();
                pipeServer->sendTransferHistory(historyStore->recentSessionsJson());
            } else if (type == "approve_device") {
                if (!pairingStore->approve(data)) {
                    return {false, "pairing request is no longer pending"};
                }
                pipeServer->sendTrustedDevices(pairingStore->devicesJson());
            } else if (type == "deny_device") {
                if (!pairingStore->deny(data)) {
                    return {false, "pairing request is no longer pending"};
                }
            } else if (type == "revoke_device") {
                if (!pairingStore->revoke(data)) {
                    return {false, "trusted device was not found"};
                }
                httpServer.revokeNativeDevice(data);
                pipeServer->sendTrustedDevices(pairingStore->devicesJson());
            } else if (type == "request_trusted_devices") {
                pipeServer->sendTrustedDevices(pairingStore->devicesJson());
            } else if (type == "revoke_all_devices") {
                pairingStore->revokeAll();
                httpServer.revokeAllNativeSessions();
                pipeServer->sendTrustedDevices(pairingStore->devicesJson());
            } else if (type == "begin_native_pairing") {
                if (data != "120") {
                    return {false, "invalid native pairing lifetime"};
                }
                httpServer.beginNativePairingWindow();
                discoveryServer->setNativePairingAvailable(true);
            } else if (type == "end_native_pairing") {
                httpServer.endNativePairingWindow();
                discoveryServer->setNativePairingAvailable(false);
            } else if (type == "approve_native_pairing") {
                if (!httpServer.approveNativePairing(data)) {
                    return {false, "native pairing request is no longer pending"};
                }
                pipeServer->sendTrustedDevices(pairingStore->devicesJson());
            } else if (type == "deny_native_pairing") {
                if (!httpServer.denyNativePairing(data)) {
                    return {false, "native pairing request is no longer pending"};
                }
            } else if (type == "approve_native_transfer") {
                if (!httpServer.approveNativeTransfer(data)) {
                    return {false, "native transfer request is no longer pending"};
                }
            } else if (type == "deny_native_transfer") {
                if (!httpServer.denyNativeTransfer(data)) {
                    return {false, "native transfer request is no longer pending"};
                }
            } else if (type == "set_auto_approve_known") {
                if (data != "true" && data != "false") {
                    return {false, "invalid auto-approval setting"};
                }
                httpServer.setAutoApproveKnown(data == "true");
            } else if (type == "set_discovery_enabled") {
                if (data != "true" && data != "false") {
                    return {false, "invalid discovery setting"};
                }
                discoveryServer->setEnabled(data == "true");
            } else if (type == "set_browser_bootstrap") {
                if (!httpServer.setBrowserBootstrap(data)) {
                    return {false, "invalid browser bootstrap"};
                }
            } else if (type == "ownership_probe") {
                if (const auto response = ownershipController->handleProbe(data)) {
                    pipeServer->sendControlResponse(response->type, response->dataJson);
                    return {true, {}};
                }
                return {false, "ownership proof rejected"};
            } else if (type == "ownership_shutdown") {
                if (ownershipController->authorizeShutdown(data)) {
                    spdlog::warn("Authenticated stale-server shutdown requested");
                    g_running = false;
                    return {true, {}};
                } else {
                    spdlog::warn("Rejected unauthenticated stale-server shutdown request");
                    return {false, "shutdown authorization rejected"};
                }
            } else if (type == "session_auth") {
                if (const auto response = ownershipController->authenticateSession(data)) {
                    pipeServer->markSessionAuthenticated();
                    pipeServer->sendControlResponse(response->type, response->dataJson);
                    return {true, {}};
                }
                pipeServer->sendControlResponse(
                    "session_rejected",
                    nlohmann::json{{"error", "authentication failed"}}.dump());
                return {false, "session authentication rejected"};
            } else {
                spdlog::debug("Unknown pipe command: {}", type);
                return {false, "unknown command"};
            }
            return {true, {}};
        });
        
        // Start Named Pipe server in background thread
        std::thread pipeThread([&pipeServer]() {
            pipeServer->run(g_running);
        });
        std::thread discoveryThread([&discoveryServer]() {
            discoveryServer->run(g_running);
        });
        
        // Start HTTP server (blocks until shutdown)
        httpServer.run(g_running);
        
        // Cleanup
        g_running = false;
        pipeServer->stop();
        discoveryServer->stop();
        if (pipeThread.joinable()) {
            pipeThread.join();
        }
        if (discoveryThread.joinable()) {
            discoveryThread.join();
        }
        
        // SQLite auto-persists — no explicit save needed

#ifdef _WIN32
        releaseSingleInstanceGuard();
#endif
        
        spdlog::info("Server shutdown complete");
        return 0;
        
    } catch (const std::exception& e) {
        spdlog::error("Fatal error in main: {}", e.what());

#ifdef _WIN32
        releaseSingleInstanceGuard();
#endif

        return 1;
    } catch (...) {
        spdlog::error("Unknown fatal error in main ending in abort prevention");

#ifdef _WIN32
        releaseSingleInstanceGuard();
#endif

        return 1;
    }
}
