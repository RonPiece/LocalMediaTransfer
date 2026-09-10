#include "security/NativeSessionStore.hpp"
#include "security/PairingStore.hpp"
#include "io/HashEngine.hpp"
#include <filesystem>
#include <stdexcept>
#include <sstream>
#include <iomanip>

static void requireSession(bool ok, const char* message) {
    if (!ok) throw std::runtime_error(message);
}

void sessionExhaustion(const std::filesystem::path& root) {
    std::filesystem::create_directories(root);
    auto pairing = std::make_shared<PairingStore>((root / "trusted.json").u8string());
    const std::string credential(64, 'c');
    requireSession(pairing->trustCredentialHash("test-device", "Synthetic sender",
        HashEngine::computeHash(credential.data(), credential.size()), "127.0.0.1",
        "windows", "approval_required"), "Could not prepare trusted fixture");
    auto now = std::chrono::steady_clock::now();
    NativeSessionStore sessions(pairing, nullptr, "test-server", std::string(64, 'a'), "test", [&] { return now; });
    int sequence = 0;
    auto request = [&] {
        std::ostringstream id;
        id << "win-" << std::hex << std::setw(32) << std::setfill('0') << ++sequence;
        const auto session = id.str();
        return sessions.requestTransfer({{"protocolVersion", 1}, {"clientSessionId", session},
            {"files", nlohmann::json::array({{{"fileId", session + "-file"}, {"name", "synthetic.bin"}, {"sizeBytes", 1}}})}},
            credential, "127.0.0.1");
    };
    for (int cycle = 0; cycle < 20; ++cycle) {
        auto denied = request();
        requireSession(denied.status == 202, "Denied history exhausted admission");
        requireSession(sessions.denyTransfer(denied.body["requestId"]), "Denial failed");
        auto cancelled = request();
        requireSession(cancelled.status == 202, "Cancelled history exhausted admission");
        requireSession(sessions.approveTransfer(cancelled.body["requestId"]), "Approval failed");
        auto approved = sessions.transferStatus(cancelled.body["requestId"], credential);
        requireSession(sessions.cancelTransfer(approved.body["transferId"], approved.body["token"]).status == 200, "Cancellation failed");
    }
    for (int cycle = 0; cycle < 3; ++cycle) {
        for (int i = 0; i < 10; ++i) {
            auto active = request();
            requireSession(active.status == 202, "Active capacity reduced");
            requireSession(sessions.approveTransfer(active.body["requestId"]), "Capacity approval failed");
        }
        requireSession(request().status == 409, "Active capacity was not bounded");
        now += std::chrono::minutes(31);
    }
    for (int cycle = 0; cycle < 3; ++cycle) {
        requireSession(request().status == 202, "Expired pending request retained its slot");
        requireSession(request().status == 409, "A device created concurrent pending requests");
        now += std::chrono::minutes(3);
    }
    auto pending = request();
    requireSession(pending.status == 202, "Expired requests did not release admission");
    requireSession(sessions.approveTransfer(pending.body["requestId"]), "Final approval failed");
    auto approved = sessions.transferStatus(pending.body["requestId"], credential);
    requireSession(sessions.authorizeTransfer(approved.body["token"], approved.body["transferId"]), "Fresh grant rejected");
    now += std::chrono::minutes(31);
    requireSession(!sessions.authorizeTransfer(approved.body["token"], approved.body["transferId"]), "Idle-expired grant remained authorized");
    auto sustained = request();
    requireSession(sustained.status == 202, "Idle expiry leaked admission");
    requireSession(sessions.approveTransfer(sustained.body["requestId"]), "Sustained approval failed");
    auto live = sessions.transferStatus(sustained.body["requestId"], credential);
    for (int refresh = 1; refresh <= 73; ++refresh) {
        now += std::chrono::minutes(20);
        requireSession(sessions.authorizeTransfer(live.body["token"], live.body["transferId"]) == (refresh <= 72),
            "Grant absolute lifetime or activity refresh is incorrect");
    }
}
