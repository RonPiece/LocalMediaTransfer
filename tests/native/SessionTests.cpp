#include "security/NativeSessionStore.hpp"
#include "security/PairingStore.hpp"
#include "io/HashEngine.hpp"
#include <filesystem>
#include <stdexcept>
#include <sstream>
#include <iomanip>
#include <future>

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

    sessions.beginPairingWindow();
    const std::string pairingClient = "pairing-client";
    auto pairRequest = [&](char credentialCharacter, char nonceCharacter) {
        return sessions.requestPairing({
            {"protocolVersion", 1},
            {"environment", "test"},
            {"serverId", "test-server"},
            {"clientId", pairingClient},
            {"clientName", "Synthetic Windows sender"},
            {"clientNonce", std::string(64, nonceCharacter)},
            {"credential", std::string(64, credentialCharacter)}
        }, "127.0.0.1");
    };
    auto receiverDenied = pairRequest('1', 'a');
    requireSession(receiverDenied.status == 202, "Initial pairing request failed");
    requireSession(pairRequest('2', 'b').status == 409,
        "Concurrent active pairing request was not rejected");
    requireSession(sessions.denyPairing(receiverDenied.body["requestId"]),
        "Receiver pairing denial failed");
    auto afterReceiverDenial = pairRequest('2', 'b');
    requireSession(afterReceiverDenial.status == 202,
        "Receiver denial blocked an immediate pairing retry");
    requireSession(sessions.denyPairing(afterReceiverDenial.body["requestId"]),
        "Sender pairing rejection failed");
    auto approvedPairing = pairRequest('3', 'c');
    requireSession(approvedPairing.status == 202,
        "Sender rejection blocked an immediate pairing retry");
    const std::string approvedRequestId = approvedPairing.body["requestId"];
    requireSession(sessions.approvePairing(approvedRequestId),
        "Receiver-first pairing approval failed");
    auto confirmedPairing = sessions.confirmPairing(approvedRequestId, {{"proof",
        NativeSessionStore::confirmationProof(std::string(64, '3'),
            approvedRequestId, std::string(64, 'c'))}});
    requireSession(confirmedPairing.status == 200 &&
        confirmedPairing.body["status"] == "approved",
        "Two-sided pairing did not reach its approved terminal state");
    requireSession(sessions.confirmPairing(approvedRequestId, {{"proof", "wrong"}}).status == 403,
        "Invalid confirmation proof accepted");
    requireSession(sessions.pairingStatus(approvedRequestId,
        {{"clientId", pairingClient}, {"credential", std::string(64, '3')}}).body["status"] == "approved",
        "Late invalid confirmation changed an approved terminal result");
    auto afterApproval = pairRequest('4', 'd');
    requireSession(afterApproval.status == 202,
        "Approved pairing result blocked an immediate retry");
    requireSession(sessions.denyPairing(afterApproval.body["requestId"]),
        "Post-approval pairing cleanup failed");
    requireSession(sessions.revokeCurrentDevice(std::string(64, '3'),
        "127.0.0.1").status == 200, "Authenticated unpair failed");
    requireSession(!pairing->findDeviceByCredential(std::string(64, '3')).has_value(),
        "Authenticated unpair retained receiver-side trust");
    requireSession(sessions.revokeCurrentDevice(std::string(64, '3'),
        "127.0.0.1").status == 401,
        "Already-revoked credential was accepted for unpair");
    auto afterUnpair = pairRequest('5', 'e');
    requireSession(afterUnpair.status == 202,
        "Unpairing blocked an immediate pairing retry");
    requireSession(sessions.denyPairing(afterUnpair.body["requestId"]),
        "Final pairing cleanup failed");
    sessions.endPairingWindow();

    // A failed persistence operation must not report success or change the
    // in-memory credential while the old credential remains trusted on disk.
    const auto blockedTemp = root / "trusted.json.tmp";
    std::filesystem::create_directory(blockedTemp);
    requireSession(!pairing->trustCredentialHash("test-device", "Replacement",
        HashEngine::computeHash("replacement", 11), "127.0.0.1", "windows", "approval_required"),
        "Failed trust save was reported as successful");
    for (int retry = 0; retry < 2; ++retry) {
        bool failed = false;
        try { sessions.revokeCurrentDevice(credential, "127.0.0.1"); }
        catch (...) { failed = true; }
        requireSession(failed && pairing->findDeviceByCredential(credential).has_value(),
            "Failed revocation changed memory or became a false credential rejection");
    }
    std::filesystem::remove(blockedTemp);

    for (int iteration = 0; iteration < 12; ++iteration) {
        const std::string oldCredential(64, '7');
        now += std::chrono::minutes(11);
        sessions.beginPairingWindow();
        requireSession(pairing->trustCredentialHash(pairingClient, "Sender",
            HashEngine::computeHash(oldCredential.data(), oldCredential.size()), "127.0.0.1",
            "windows", "approval_required"), "Race fixture failed");
        auto first = std::async(std::launch::async, [&] { return pairRequest('6', 'f'); });
        auto second = std::async(std::launch::async, [&] { return pairRequest('6', 'f'); });
        auto a = first.get();
        auto b = second.get();
        requireSession((a.status == 202 && b.status == 409) || (b.status == 202 && a.status == 409),
            "Simultaneous pairing admitted multiple active requests");
        const std::string id = (a.status == 202 ? a : b).body["requestId"];
        requireSession(sessions.approvePairing(id), "Race receiver confirmation failed");
        auto confirmation = std::async(std::launch::async, [&] {
            return sessions.confirmPairing(id, {{"proof", NativeSessionStore::confirmationProof(
                std::string(64, '6'), id, std::string(64, 'f'))}});
        });
        auto revocation = std::async(std::launch::async, [&] {
            return sessions.revokeCurrentDevice(oldCredential, "127.0.0.1");
        });
        auto confirmed = confirmation.get();
        auto revoked = revocation.get();
        requireSession((confirmed.status == 200 && revoked.status == 401 &&
                pairing->findDeviceByCredential(std::string(64, '6')).has_value()) ||
            (confirmed.status == 404 && revoked.status == 200 &&
                !pairing->findDeviceByCredential(std::string(64, '6')).has_value()),
            "Unpair and re-pair were not atomic");
        sessions.revokeDevice(pairingClient);
    }
    // Restore the independent transfer fixture after the credential race.
    requireSession(pairing->trustCredentialHash("test-device", "Synthetic sender",
        HashEngine::computeHash(credential.data(), credential.size()), "127.0.0.1",
        "windows", "approval_required"), "Transfer fixture restore failed");

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
