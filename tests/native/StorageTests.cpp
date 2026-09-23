#include "io/FileWriter.hpp"
#include "io/HashEngine.hpp"
#include "config/MetadataMigration.hpp"
#include <openssl/rand.h>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <cstring>
#include <fmt/format.h>

namespace fs = std::filesystem;
static void require(bool value, const char* message) {
    if (!value) throw std::runtime_error(message);
}

struct TestDirectory {
    fs::path base = fs::temp_directory_path() / "LocalMediaTransfer.Tests";
    fs::path path;
    TestDirectory() {
        unsigned char random[16];
        require(RAND_bytes(random, sizeof(random)) == 1, "Test ID randomness failed");
        const char* hex = "0123456789abcdef";
        std::string id = "storage-";
        for (auto value : random) { id += hex[value >> 4]; id += hex[value & 15]; }
        path = base / id;
        fs::create_directories(base);
        require(fs::create_directory(path), "Test directory collision");
    }
    ~TestDirectory() {
        std::error_code ec;
        const auto resolved = fs::weakly_canonical(path, ec);
        if (ec) return;
        const auto resolvedBase = fs::weakly_canonical(base, ec);
        if (!ec && resolved.parent_path() == resolvedBase) fs::remove_all(resolved, ec);
    }
};

// One successful block followed by a real stream failure, not a short EOF.
struct FailingBuffer : std::streambuf {
    bool delivered = false;
    std::streamsize xsgetn(char* destination, std::streamsize count) override {
        if (delivered) throw std::runtime_error("injected read failure");
        delivered = true;
        std::memset(destination, 'x', static_cast<size_t>(count));
        return count;
    }
};

static void hashing() {
    std::istringstream good("abc");
    require(HashEngine::computeStreamHash(good, 3) ==
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        "Clean EOF hash differs from SHA-256 vector");
    std::istringstream shortRead("abc");
    require(HashEngine::computeStreamHash(shortRead, 4).empty(), "Truncated input accepted");
    FailingBuffer buffer;
    std::istream failed(&buffer);
    require(HashEngine::computeStreamHash(failed).empty(), "Read failure returned prefix digest");
    require(failed.bad(), "Fixture did not inject a read failure");
}

static size_t temporaryFiles(const fs::path& path) {
    size_t count = 0;
    for (const auto& entry : fs::directory_iterator(path))
        if (entry.path().filename().string().rfind(".lmt-upload-", 0) == 0) ++count;
    return count;
}

static void limitsAndCleanup(const fs::path& path) {
    auto clock = std::chrono::steady_clock::now();
    UploadLimits limits;
    limits.minFreeBytes = 0;
    limits.maxFileBytes = 8;
    limits.maxReservedBytes = 12;
    limits.maxOwnerBytes = 8;
    limits.maxActiveFiles = 2;
    limits.maxOwnerFiles = 1;
    limits.idleTimeout = std::chrono::seconds(10);
    limits.now = [&] { return clock; };
    FileWriter writer(path.u8string(), std::make_shared<HashEngine>(),
        lmt::FilenameConflictPolicy::KeepBoth, limits);
    require(!writer.initFile("a-large", "large.bin", 9), "Per-file limit bypassed");
    require(writer.initFile("a-one", "one.bin", 8, 2), "First reservation failed");
    require(!writer.initFile("a-two", "two.bin", 1), "Per-owner active limit bypassed");
    require(!writer.initFile("b-large", "large.bin", 5), "Aggregate reservation limit bypassed");
    require(writer.initFile("b-one", "b.bin", 4), "Second owner admission failed");
    require(!writer.initFile("c-one", "c.bin", 1), "Active file limit bypassed");
    writer.abortFile("b-one");
    require(writer.initFile("b-two", "two.bin", 4), "Cancellation leaked reservation");
    require(writer.writeChunk("b-two", 0, "abcd", 4) == ChunkWriteStatus::Success, "Write failed");
    require(writer.finalizeFileResult("b-two").disposition == FileFinalizeDisposition::Saved,
        "Finalization failed");
    require(writer.initFile("b-three", "three.bin", 4), "Success leaked reservation");
    clock += std::chrono::seconds(9);
    require(writer.writeChunk("a-one", 0, "abcd", 4) == ChunkWriteStatus::Success, "Activity refresh failed");
    clock += std::chrono::seconds(2);
    writer.expireIdleFiles();
    require(writer.writeChunk("a-one", 1, "efgh", 4) == ChunkWriteStatus::Success,
        "Reaper removed recently active upload");
    require(writer.writeChunk("b-three", 0, "abcd", 4) != ChunkWriteStatus::Success,
        "Reaper retained abandoned upload");
    writer.abortFile("a-one");
    require(temporaryFiles(path) == 0, "Cancelled/expired temporary files remain");
    require(writer.initFile("c-new", "new.bin", 8), "Expiry leaked reservation");
    writer.abortFile("c-new");

    // Separate byte budget from the per-owner count gate.
    limits.maxOwnerFiles = 8;
    limits.maxActiveFiles = 8;
    FileWriter bytes((path / "bytes").u8string(), std::make_shared<HashEngine>(),
        lmt::FilenameConflictPolicy::KeepBoth, limits);
    require(bytes.initFile("a-one", "one.bin", 5), "Byte-budget setup failed");
    require(!bytes.initFile("a-two", "two.bin", 4), "Per-owner byte budget bypassed");
}

static void storageFailures(const fs::path& path) {
    UploadLimits limits;
    limits.minFreeBytes = 0;
    limits.maxActiveFiles = limits.maxOwnerFiles = 1;
    FileWriter writer(path.u8string(), std::make_shared<HashEngine>(),
        lmt::FilenameConflictPolicy::KeepBoth, limits);
    for (const char* operation : {"copy", "view-flush", "view-unmap", "file-flush", "publish"}) {
        writer.failStorageOperation = [=](const char* stage) { return std::strcmp(stage, operation) == 0; };
        const std::string id = std::string("a-") + operation;
        require(writer.initFile(id, id + ".bin", 3), "Previous failure leaked admission");
        const auto written = writer.writeChunk(id, 0, "abc", 3);
        if (std::strcmp(operation, "view-flush") == 0 ||
            std::strcmp(operation, "view-unmap") == 0 ||
            std::strcmp(operation, "file-flush") == 0 ||
            std::strcmp(operation, "publish") == 0) {
            require(written == ChunkWriteStatus::Success, "Unexpected chunk failure");
            require(writer.finalizeFileResult(id).disposition == FileFinalizeDisposition::Error,
                "Finalization storage failure published success");
        } else require(written == ChunkWriteStatus::StorageError, "Mapped fault escaped error boundary");
        require(!fs::exists(path / (id + ".bin")), "Storage failure published a final file");
        require(temporaryFiles(path) == 0, "Storage failure leaked a temporary file");
    }
    writer.failStorageOperation = {};
    require(writer.initFile("a-recovered", "recovered.bin", 3), "Failed to recover after storage error");
    require(writer.writeChunk("a-recovered", 0, "abc", 3) == ChunkWriteStatus::Success, "Recovery write failed");
    require(writer.finalizeFileResult("a-recovered").disposition == FileFinalizeDisposition::Saved,
        "Recovery finalization failed");
    writer.failStorageOperation = [](const char* stage) {
        return std::strcmp(stage, "copy") == 0 || std::strcmp(stage, "delete") == 0;
    };
    require(writer.initFile("a-held", "held.bin", 3), "Delete-failure setup failed");
    require(writer.writeChunk("a-held", 0, "abc", 3) == ChunkWriteStatus::StorageError,
        "Write failure injection failed");
    require(!writer.initFile("b-blocked", "blocked.bin", 3), "Failed deletion released its reservation");
    writer.failStorageOperation = {};
    writer.expireIdleFiles();
    require(writer.initFile("b-released", "released.bin", 3), "Cleanup retry did not release reservation");
    writer.abortFile("b-released");
    require(temporaryFiles(path) == 0, "Cleanup retry left temporary files");
    require(writer.initFile("a-short", "short.bin", 3), "Incomplete-file setup failed");
    require(writer.writeChunk("a-short", 0, "a", 1) == ChunkWriteStatus::Success, "Short write setup failed");
    require(writer.finalizeFileResult("a-short").disposition == FileFinalizeDisposition::Error,
        "Incomplete file finalized");
    require(writer.initFile("a-after-short", "next.bin", 3), "Incomplete finalization leaked reservation");
    writer.abortFile("a-after-short");
}

static void mappingWindowReuse(const fs::path& path) {
    UploadLimits limits;
    limits.minFreeBytes = 0;
    FileWriter writer(path.u8string(), std::make_shared<HashEngine>(),
        lmt::FilenameConflictPolicy::KeepBoth, limits);
    int viewFlushes = 0;
    writer.failStorageOperation = [&](const char* stage) {
        if (std::strcmp(stage, "view-flush") == 0) ++viewFlushes;
        return false;
    };
    constexpr size_t ChunkBytes = 1024 * 1024;
    std::string chunk(ChunkBytes, 'm');
    require(writer.initFile("a-window", "window.bin", 4 * ChunkBytes, 4),
        "Mapping reuse setup failed");
    for (uint64_t index = 0; index < 4; ++index) {
        require(writer.writeChunk(
            "a-window", index, chunk.data(), chunk.size()) ==
            ChunkWriteStatus::Success,
            "Mapping reuse write failed");
    }
    require(viewFlushes == 0, "A mapping window was flushed per chunk");
    require(writer.finalizeFileResult("a-window").disposition ==
        FileFinalizeDisposition::Saved,
        "Mapping reuse finalization failed");
    require(viewFlushes == 1, "Finalization did not flush one shared mapping window");

    // An unaligned chunk crosses the 64 MiB boundary, then finalization moves
    // the owning handle. Verify disk contents as well as the flush count.
    constexpr size_t BoundaryChunk = 33 * ChunkBytes;
    std::string large(BoundaryChunk, 'b');
    require(writer.initFile("a-boundary", "boundary.bin", 2 * BoundaryChunk, 2), "Boundary setup failed");
    require(writer.writeChunk("a-boundary", 1, large.data(), large.size()) == ChunkWriteStatus::OutOfOrder,
        "Out-of-order write accepted");
    require(writer.writeChunk("a-boundary", 0, large.data(), large.size()) == ChunkWriteStatus::Success,
        "Boundary first write failed");
    require(writer.writeChunk("a-boundary", 0, large.data(), large.size()) == ChunkWriteStatus::AlreadyAccepted,
        "Duplicate write was not idempotent");
    require(writer.writeChunk("a-boundary", 1, large.data(), large.size()) == ChunkWriteStatus::Success,
        "Boundary crossing write failed");
    require(viewFlushes == 2, "Window switch did not flush exactly once");
    auto saved = writer.finalizeFileResult("a-boundary");
    require(saved.disposition == FileFinalizeDisposition::Saved && viewFlushes == 3,
        "Boundary finalization failed");
    require(saved.sha256 == HashEngine::computeFileHash((path / "boundary.bin").u8string()),
        "Boundary data does not match the streaming hash");

    writer.failStorageOperation = [](const char* stage) { return std::strcmp(stage, "view-flush") == 0; };
    require(writer.initFile("a-boundary-fault", "fault.bin", 2 * BoundaryChunk, 2), "Boundary fault setup failed");
    require(writer.writeChunk("a-boundary-fault", 0, large.data(), large.size()) == ChunkWriteStatus::Success,
        "First window write failed");
    require(writer.writeChunk("a-boundary-fault", 1, large.data(), large.size()) == ChunkWriteStatus::StorageError,
        "Boundary flush failure was ignored");
    require(!fs::exists(path / "fault.bin") && temporaryFiles(path) == 0,
        "Boundary failure published or leaked data");
}

static void metadataMigration(const fs::path& path) {
    const auto legacy = path / lmt::StoragePaths::LegacyMetadataDirectoryName;
    const auto current = path / lmt::StoragePaths::MetadataDirectoryName;
    fs::create_directories(legacy);
    std::ofstream(legacy / "hashes.db") << "legacy database";
    std::ofstream(legacy / "hashes.db-wal") << "legacy journal";
    fs::create_directories(current);
    std::ofstream(current / "hashes.db") << "current database";
    std::ofstream(legacy / "collision.txt") << "legacy";
    std::ofstream(current / "collision.txt") << "current";
    std::ofstream(legacy / "unique.txt") << "unique";
    lmt::StoragePaths::migrateMetadata(path);
    lmt::StoragePaths::migrateMetadata(path);
    require(fs::exists(legacy / "hashes.db-wal") && !fs::exists(current / "hashes.db-wal"),
        "Migration mixed SQLite database families");
    require(fs::exists(legacy / "hashes.db") && fs::exists(legacy / "collision.txt"),
        "Migration removed colliding legacy data");
    require(fs::exists(current / "unique.txt") && !fs::exists(legacy / "unique.txt"),
        "Migration did not move independent data");
    const auto fresh = path / "rename";
    fs::create_directories(fresh / lmt::StoragePaths::LegacyMetadataDirectoryName);
    std::ofstream(fresh / lmt::StoragePaths::LegacyMetadataDirectoryName / "hashes.db-wal") << "journal";
    lmt::StoragePaths::migrateMetadata(fresh);
    require(fs::exists(fresh / lmt::StoragePaths::MetadataDirectoryName / "hashes.db-wal"),
        "Directory rename lost recovery state");
}

static void inventoryPaging(const fs::path& root) {
    fs::create_directories(root);
    auto engine = std::make_shared<HashEngine>();
    engine->openDatabase((root / "inventory.db").u8string());
    const std::string hash(64, 'a');
    for (int i = 0; i < 1200; ++i)
        engine->upsertFile("candidate-" + std::to_string(10000 + i), hash, 3, 0, 0);
    for (bool byHash : {false, true}) {
        std::string cursor;
        size_t total = 0;
        while (true) {
            const auto page = byHash ? engine->findByHash(hash, cursor) :
                engine->findVerificationCandidates("missing", 3, hash, cursor);
            require(page.size() <= 256, "Inventory lookup exceeded its page bound");
            if (page.empty()) break;
            require(page.front().filename > cursor, "Inventory cursor did not advance");
            cursor = page.back().filename;
            total += page.size();
            // Updating matches during traversal must not skip later records.
            for (const auto& record : page)
                engine->upsertFile(record.filename, hash, 3, 1, 1);
        }
        require(total == 1200, "Inventory pagination lost or repeated records");
    }
    engine->reconcileDirectory(root.u8string());
    require(engine->findByHash(hash).empty(), "Reconciliation retained missing files");
    // Physical candidates survive startup reconciliation and keep the duplicate
    // beyond the first page even while background hashing updates the index.
    for (int i = 0; i < 600; ++i)
        std::ofstream(root / ("a-other-" + std::to_string(i))) << "xyz";
    std::ofstream(root / "z-actual.bin") << "abc";
    engine->upsertFile("z-actual.bin", "", 3, 0, 0);
    FileWriter writer(root.u8string(), engine);
    require(engine->findVerificationCandidates("new.bin", 3, hash).size() == 256,
        "Duplicate fixture did not exercise a full candidate page");
    PreflightHashCache cache;
    auto result = writer.verifyPreflight("new.bin", 3, HashEngine::computeHash("abc", 3), &cache);
    require(result.disposition == PreflightDisposition::Skip, "Duplicate beyond first page was not verified");
    require(cache.size() <= 256, "Preflight cache exceeded its bound");
}

void sessionExhaustion(const fs::path& root);

int main() {
    try {
        TestDirectory directory;
        hashing();
        require(fmt::format("{} {:x}", -1, -1) == "-1 -1", "Signed fmt formatting regressed");
        bool invalidFormatRejected = false;
        try { (void)fmt::format(fmt::runtime("{:u}"), -1); }
        catch (const fmt::format_error&) { invalidFormatRejected = true; }
        require(invalidFormatRejected, "Invalid numeric format was not rejected");
        inventoryPaging(directory.path / "inventory");
        sessionExhaustion(directory.path / "sessions");
        limitsAndCleanup(directory.path / "limits");
        storageFailures(directory.path / "faults");
        mappingWindowReuse(directory.path / "mapping-window");
        metadataMigration(directory.path / "metadata-migration");
        const auto cleanup = directory.path / "cleanup";
        fs::create_directories(cleanup);
        const auto orphan = cleanup / (".lmt-upload-" + std::string(64, 'a') + ".tmp");
        std::ofstream(orphan) << "abandoned";
        std::ofstream(cleanup / ".user-notes.tmp") << "preserve";
        { FileWriter writer(cleanup.u8string(), std::make_shared<HashEngine>());
          require(!fs::exists(orphan), "Owned orphan was not removed");
          require(fs::exists(cleanup / ".user-notes.tmp"), "Unrelated temp file was removed"); }
        std::cout << "Native storage regression tests passed\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
