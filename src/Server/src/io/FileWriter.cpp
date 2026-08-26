/**
 * Memory-Mapped File Writer Implementation
 * 
 * Uses Windows memory-mapped files for high-performance I/O.
 */

#include "io/FileWriter.hpp"
#include "io/HashEngine.hpp"

#include <spdlog/spdlog.h>

#include <filesystem>
#include <fstream>
#include <algorithm>
#include <random>
#include <sstream>
#include <iomanip>
#include <regex>
#include <vector>
#include <unordered_set>
#include <chrono>
#include <ctime>
#include <cctype>
#include <cwctype>

#ifndef _WIN32
#include <fcntl.h>
#include <sys/mman.h>
#include <unistd.h>
#endif

namespace fs = std::filesystem;

namespace {

constexpr uint64_t MappingWindowBytes = 64ULL * 1024ULL * 1024ULL;
constexpr size_t MaxCompletedSessions = 2048;
constexpr uint64_t MaxChunksPerFile = 10000;
constexpr auto FinalizationWaitTimeout = std::chrono::seconds(15);

bool isSafeFileId(const std::string& fileId) {
    return !fileId.empty() &&
           fileId.size() <= 512 &&
           std::all_of(fileId.begin(), fileId.end(), [](unsigned char value) {
               return std::isalnum(value) != 0 ||
                      value == '-' || value == '_' || value == '.';
           });
}

bool isManagedTempFile(const fs::path& path) {
    const std::string name = path.filename().u8string();
    // Startup cleanup is deliberately limited to the iOS session naming
    // contract. A generic ".<safe text>.tmp" rule could delete an unrelated
    // user file placed in the selected destination.
    static const std::regex managedTempPattern(
        R"(^\.(ios-[0-9]{10,20}-[0-9]+|win-[a-f0-9]{32}-[A-Za-z0-9._-]+)\.tmp$)");
    return std::regex_match(name, managedTempPattern);
}

int64_t inventoryModifiedTime(const fs::path& path) {
    std::error_code ec;
    const auto value = fs::last_write_time(path, ec);
    if (ec) {
        return 0;
    }
    return std::chrono::duration_cast<std::chrono::nanoseconds>(
               value.time_since_epoch())
        .count();
}

int64_t inventoryNow() {
    return static_cast<int64_t>(std::time(nullptr));
}

std::string buildFallbackFilename() {
    auto now = std::chrono::high_resolution_clock::now().time_since_epoch().count();
    std::stringstream ss;
    ss << "file_" << std::hex << (now & 0xFFFFFF);
    return ss.str();
}

#ifdef _WIN32
std::wstring utf8OrAnsiToWide(const std::string& input) {
    if (input.empty()) {
        return L"";
    }

    int utf8Len = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, input.c_str(), -1, nullptr, 0);
    if (utf8Len > 0) {
        std::wstring wide(static_cast<size_t>(utf8Len), L'\0');
        MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, input.c_str(), -1, wide.data(), utf8Len);
        wide.resize(static_cast<size_t>(utf8Len) - 1);
        return wide;
    }

    int ansiLen = MultiByteToWideChar(CP_ACP, 0, input.c_str(), -1, nullptr, 0);
    if (ansiLen > 0) {
        std::wstring wide(static_cast<size_t>(ansiLen), L'\0');
        MultiByteToWideChar(CP_ACP, 0, input.c_str(), -1, wide.data(), ansiLen);
        wide.resize(static_cast<size_t>(ansiLen) - 1);
        return wide;
    }

    return L"";
}

std::string wideToUtf8(const std::wstring& input) {
    if (input.empty()) {
        return "";
    }

    int needed = WideCharToMultiByte(CP_UTF8, 0, input.c_str(), -1, nullptr, 0, nullptr, nullptr);
    if (needed <= 0) {
        return "";
    }

    std::string out(static_cast<size_t>(needed), '\0');
    WideCharToMultiByte(CP_UTF8, 0, input.c_str(), -1, out.data(), needed, nullptr, nullptr);
    out.resize(static_cast<size_t>(needed) - 1);
    return out;
}

std::wstring trimInvalidFilenameEnd(std::wstring value) {
    auto last = value.find_last_not_of(L" .");
    if (last == std::wstring::npos) {
        return L"";
    }
    value.resize(last + 1);
    return value;
}

bool isReservedWindowsBaseName(const std::wstring& stemRaw) {
    static const std::vector<std::wstring> reserved = {
        L"CON", L"PRN", L"AUX", L"NUL",
        L"COM1", L"COM2", L"COM3", L"COM4", L"COM5", L"COM6", L"COM7", L"COM8", L"COM9",
        L"COM\u00B9", L"COM\u00B2", L"COM\u00B3",
        L"LPT1", L"LPT2", L"LPT3", L"LPT4", L"LPT5", L"LPT6", L"LPT7", L"LPT8", L"LPT9",
        L"LPT\u00B9", L"LPT\u00B2", L"LPT\u00B3"
    };

    std::wstring stem = stemRaw;
    std::transform(stem.begin(), stem.end(), stem.begin(), [](wchar_t ch) {
        return static_cast<wchar_t>(std::towupper(ch));
    });

    return std::find(reserved.begin(), reserved.end(), stem) != reserved.end();
}

std::string sanitizeWindowsUtf8Filename(const std::string& original) {
    std::string basename = original;
    try {
        basename = fs::u8path(original).filename().u8string();
    } catch (...) {
        basename = original;
    }

    std::wstring wide = utf8OrAnsiToWide(basename);
    if (wide.empty()) {
        return buildFallbackFilename();
    }

    for (auto& ch : wide) {
        if (ch < 32 || ch == L'<' || ch == L'>' || ch == L':' || ch == L'"' ||
            ch == L'/' || ch == L'\\' || ch == L'|' || ch == L'?' || ch == L'*') {
            ch = L'_';
        }
    }

    wide = trimInvalidFilenameEnd(wide);
    if (wide.empty()) {
        return buildFallbackFilename();
    }

    fs::path namePath(wide);
    std::wstring stem = namePath.stem().wstring();
    std::wstring ext = namePath.extension().wstring();

    if (ext == L".") {
        ext.clear();
    }

    if (stem.empty()) {
        stem = utf8OrAnsiToWide(buildFallbackFilename());
    }

    if (isReservedWindowsBaseName(stem)) {
        stem += L"_";
    }

    const size_t maxLen = 200;
    if (stem.size() + ext.size() > maxLen) {
        size_t allowedStem = (maxLen > ext.size()) ? (maxLen - ext.size()) : 1;
        if (allowedStem == 0) {
            allowedStem = 1;
        }
        stem = stem.substr(0, allowedStem);
        if (!stem.empty() &&
            stem.back() >= 0xD800 &&
            stem.back() <= 0xDBFF) {
            stem.pop_back();
        }
        stem = trimInvalidFilenameEnd(stem);
        if (stem.empty()) {
            stem = utf8OrAnsiToWide(buildFallbackFilename());
        }
    }

    std::wstring finalWide = stem + ext;
    std::string finalUtf8 = wideToUtf8(finalWide);
    if (finalUtf8.empty()) {
        return buildFallbackFilename();
    }

    return finalUtf8;
}
#endif

} // namespace

FileWriter::FileHandle::FileHandle(FileHandle&& other) noexcept {
    *this = std::move(other);
}

FileWriter::FileHandle& FileWriter::FileHandle::operator=(FileHandle&& other) noexcept {
    if (this == &other) {
        return *this;
    }

    fileId = std::move(other.fileId);
    originalName = std::move(other.originalName);
    tempPath = std::move(other.tempPath);
    totalSize = other.totalSize;
    bytesWritten = other.bytesWritten;
    chunksReceived = other.chunksReceived;
    chunksExpected = other.chunksExpected;
    skipExactDuplicates = other.skipExactDuplicates;
    acceptedChunkSizes = std::move(other.acceptedChunkSizes);
    streamingHashValid = other.streamingHashValid;
    writeMutex = std::move(other.writeMutex);
    finalization = std::move(other.finalization);
#ifdef _WIN32
    hFile = other.hFile;
    hMapping = other.hMapping;
    other.hFile = INVALID_HANDLE_VALUE;
    other.hMapping = nullptr;
#else
    fd = other.fd;
    other.fd = -1;
#endif
    other.totalSize = 0;
    other.bytesWritten = 0;
    other.chunksReceived = 0;
    other.chunksExpected = 0;
    other.skipExactDuplicates = true;
    other.streamingHashValid = false;
    return *this;
}

FileWriter::FileWriter(
    const std::string& uploadDir,
    std::shared_ptr<HashEngine> hashEngine,
    lmt::FilenameConflictPolicy filenameConflictPolicy)
    : m_uploadDir(uploadDir)
    , m_hashEngine(std::move(hashEngine))
    , m_filenameConflictPolicy(filenameConflictPolicy)
{
    fs::create_directories(m_uploadDir);
    size_t removedOrphanCount = 0;
    std::error_code directoryError;
    for (const auto& entry :
         fs::directory_iterator(fs::u8path(m_uploadDir), directoryError)) {
        if (directoryError) {
            break;
        }
        std::error_code typeError;
        if (!entry.is_regular_file(typeError) || typeError ||
            !isManagedTempFile(entry.path())) {
            continue;
        }
        std::error_code removeError;
        if (fs::remove(entry.path(), removeError) && !removeError) {
            removedOrphanCount += 1;
        } else if (removeError) {
            spdlog::warn(
                "Failed to remove orphaned upload temporary file '{}': {}",
                entry.path().filename().u8string(),
                removeError.message());
        }
    }
    if (removedOrphanCount > 0) {
        spdlog::info(
            "Removed {} orphaned upload temporary file(s)",
            removedOrphanCount);
    }
    if (m_hashEngine) {
        m_hashEngine->reconcileDirectory(m_uploadDir);
        m_lastInventoryRefresh = std::chrono::steady_clock::now();
        m_hashEngine->startBackgroundIndexing(m_uploadDir);
    }
}

FileWriter::~FileWriter() {
    std::vector<FileHandle> activeHandles;
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        activeHandles.reserve(m_handles.size());
        for (auto& [id, handle] : m_handles) {
            activeHandles.push_back(std::move(handle));
        }
        m_handles.clear();
    }

    for (auto& handle : activeHandles) {
        // A request may already hold this per-file mutex after finding the
        // handle. Wait for that bounded write to leave the mapped view before
        // closing the mapping or removing its temporary file.
        std::lock_guard<std::mutex> writeLock(*handle.writeMutex);
        if (m_hashEngine) {
            m_hashEngine->abortHash(handle.fileId);
        }
        closeHandle(handle);
        std::error_code removeError;
        fs::remove(fs::u8path(handle.tempPath), removeError);
        if (removeError) {
            spdlog::warn(
                "Failed to remove active upload temporary file during shutdown: {}",
                removeError.message());
        }
    }
}

std::string FileWriter::sanitizeFilename(const std::string& name) {
    if (name.empty()) {
        return buildFallbackFilename();
    }

#ifdef _WIN32
    return sanitizeWindowsUtf8Filename(name);
#else
    std::string base = fs::path(name).filename().string();
    if (base.empty()) {
        return buildFallbackFilename();
    }
    std::replace(base.begin(), base.end(), '/', '_');
    if (base.size() > 200) {
        auto ext = fs::path(base).extension().string();
        size_t headLen = (200 > ext.size()) ? (200 - ext.size()) : 1;
        base = base.substr(0, headLen) + ext;
    }
    return base;
#endif
}

std::string FileWriter::makeFinalFilename(const std::string& originalName) {
    return sanitizeFilename(originalName);
}

std::string FileWriter::makeNumberedFilename(const std::string& safeName) {
    const fs::path safePath = fs::u8path(safeName);
    std::string stem = safePath.stem().u8string();
    const std::string extension = safePath.extension().u8string();
    if (stem.empty()) {
        stem = buildFallbackFilename();
    }

    auto [nextIt, inserted] = m_nextFilenameSuffix.try_emplace(safeName, 2);
    if (inserted) {
        std::unordered_set<uint64_t> usedSuffixes;
        const std::string prefix = stem + " (";
        std::error_code directoryError;
        for (fs::directory_iterator entry(
                 fs::u8path(m_uploadDir),
                 fs::directory_options::skip_permission_denied,
                 directoryError),
             end;
             !directoryError && entry != end;
             entry.increment(directoryError)) {
            std::error_code fileError;
            if (!entry->is_regular_file(fileError) || fileError) continue;
            const std::string filename = entry->path().filename().u8string();
            if (filename.size() <= prefix.size() + extension.size() + 1 ||
                filename.compare(0, prefix.size(), prefix) != 0 ||
                filename.compare(
                    filename.size() - extension.size(),
                    extension.size(),
                    extension) != 0) {
                continue;
            }
            const size_t closingParen = filename.size() - extension.size() - 1;
            if (filename[closingParen] != ')') continue;
            const std::string digits = filename.substr(
                prefix.size(),
                closingParen - prefix.size());
            if (digits.empty() || !std::all_of(
                    digits.begin(),
                    digits.end(),
                    [](unsigned char ch) { return std::isdigit(ch) != 0; })) {
                continue;
            }
            try {
                const uint64_t suffix = std::stoull(digits);
                if (suffix >= 2 && suffix < 1000000) usedSuffixes.insert(suffix);
            } catch (...) {
                // Ignore filenames whose numeric suffix cannot be represented.
            }
        }
        while (usedSuffixes.find(nextIt->second) != usedSuffixes.end()) {
            ++nextIt->second;
        }
    }

    for (uint64_t number = nextIt->second; number < 1000000; ++number) {
        const std::string candidate =
            stem + " (" + std::to_string(number) + ")" + extension;
        if (!fs::exists(fs::u8path(m_uploadDir) / fs::u8path(candidate))) {
            nextIt->second = number + 1;
            return candidate;
        }
    }

    return "";
}

bool FileWriter::initFile(const std::string& fileId, 
                          const std::string& originalName,
                          uint64_t totalSize,
                          uint64_t totalChunks,
                          bool skipExactDuplicates) {
    if (!isSafeFileId(fileId)) {
        spdlog::warn("Rejected unsafe file ID");
        return false;
    }
    std::lock_guard<std::mutex> lock(m_mutex);

    if (totalChunks == 0 || totalChunks > MaxChunksPerFile) {
        spdlog::warn(
            "Invalid chunk count {} for file {} (maximum {})",
            totalChunks,
            fileId,
            MaxChunksPerFile);
        return false;
    }

    auto existing = m_handles.find(fileId);
    if (existing != m_handles.end()) {
        const bool sameSession =
            existing->second.originalName == originalName &&
            existing->second.totalSize == totalSize &&
            existing->second.chunksExpected == totalChunks &&
            existing->second.skipExactDuplicates == skipExactDuplicates;
        if (!sameSession) {
            spdlog::warn("File ID {} was reused with different metadata", fileId);
        }
        return sameSession;
    }

    auto knownSession = m_sessions.find(fileId);
    if (knownSession != m_sessions.end()) {
        const auto& state = knownSession->second;
        std::lock_guard<std::mutex> stateLock(state->mutex);
        return state->originalName == originalName &&
               state->totalSize == totalSize &&
               state->totalChunks == totalChunks &&
               state->skipExactDuplicates == skipExactDuplicates;
    }
    
    FileHandle handle;
    handle.fileId = fileId;
    handle.originalName = originalName;
    handle.totalSize = totalSize;
    handle.chunksExpected = totalChunks;
    handle.skipExactDuplicates = skipExactDuplicates;
    handle.acceptedChunkSizes.reserve(static_cast<size_t>(totalChunks));
    handle.finalization->originalName = originalName;
    handle.finalization->totalSize = totalSize;
    handle.finalization->totalChunks = totalChunks;
    handle.finalization->skipExactDuplicates = skipExactDuplicates;
    
    // Create temp file path
    handle.tempPath = (fs::u8path(m_uploadDir) / fs::u8path("." + fileId + ".tmp")).u8string();
    
    // Reject 0-byte files (CreateFileMapping with size 0 is invalid on Windows)
    if (totalSize == 0) {
        spdlog::warn("Skipping 0-byte file: {}", originalName);
        return false;
    }

    // Create memory-mapped file
    if (!createMemoryMappedFile(handle)) {
        spdlog::error("Failed to create memory-mapped file for {}", fileId);
        return false;
    }

    handle.streamingHashValid =
        m_hashEngine && m_hashEngine->beginHash(fileId);
    
    m_sessions[fileId] = handle.finalization;
    m_handles[fileId] = std::move(handle);
    spdlog::debug("Initialized file {} ({} bytes)", originalName, totalSize);
    return true;
}

size_t FileWriter::abortFilesWithPrefix(const std::string& fileIdPrefix) {
    if (fileIdPrefix.empty() || !isSafeFileId(fileIdPrefix)) {
        return 0;
    }

    std::vector<FileHandle> abortedHandles;
    std::vector<std::string> abortedIds;
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        for (auto it = m_handles.begin(); it != m_handles.end();) {
            if (it->first.rfind(fileIdPrefix, 0) != 0) {
                ++it;
                continue;
            }
            abortedIds.push_back(it->first);
            abortedHandles.push_back(std::move(it->second));
            m_sessions.erase(it->first);
            it = m_handles.erase(it);
        }
    }

    for (size_t index = 0; index < abortedHandles.size(); index += 1) {
        auto& handle = abortedHandles[index];
        // Removing the handle under m_mutex prevents new writes from starting.
        // A write that already found it still owns this mutex, so wait until it
        // has left the mapped view before closing or deleting the backing file.
        std::lock_guard<std::mutex> writeLock(*handle.writeMutex);
        if (m_hashEngine) {
            m_hashEngine->abortHash(abortedIds[index]);
        }
        closeHandle(handle);
        std::error_code removeError;
        fs::remove(fs::u8path(handle.tempPath), removeError);
        if (removeError) {
            spdlog::warn(
                "Failed to remove cancelled upload temporary file: {}",
                removeError.message());
        }
        if (handle.finalization) {
            {
                std::lock_guard<std::mutex> stateLock(
                    handle.finalization->mutex);
                handle.finalization->finalizing = false;
                handle.finalization->failed = true;
            }
            handle.finalization->completedCondition.notify_all();
        }
    }
    return abortedHandles.size();
}

bool FileWriter::createMemoryMappedFile(FileHandle& handle) {
#ifdef _WIN32
    fs::path tempPath = fs::u8path(handle.tempPath);

    // Create file
    handle.hFile = CreateFileW(
        tempPath.c_str(),
        GENERIC_READ | GENERIC_WRITE,
        0,
        nullptr,
        CREATE_ALWAYS,
        FILE_ATTRIBUTE_NORMAL,
        nullptr
    );
    
    if (handle.hFile == INVALID_HANDLE_VALUE) {
        spdlog::error("CreateFile failed: {}", GetLastError());
        return false;
    }
    
    // Set file size
    LARGE_INTEGER size;
    size.QuadPart = handle.totalSize;
    if (!SetFilePointerEx(handle.hFile, size, nullptr, FILE_BEGIN) ||
        !SetEndOfFile(handle.hFile)) {
        spdlog::error("Failed to set file size: {}", GetLastError());
        CloseHandle(handle.hFile);
        handle.hFile = INVALID_HANDLE_VALUE;
        return false;
    }
    
    // Create file mapping
    handle.hMapping = CreateFileMappingA(
        handle.hFile,
        nullptr,
        PAGE_READWRITE,
        0, 0,
        nullptr
    );
    
    if (!handle.hMapping) {
        spdlog::error("CreateFileMapping failed: {}", GetLastError());
        CloseHandle(handle.hFile);
        handle.hFile = INVALID_HANDLE_VALUE;
        return false;
    }
    
    return true;
#else
    // Linux/macOS implementation. Views are created in bounded windows while writing.
    handle.fd = open(handle.tempPath.c_str(), O_RDWR | O_CREAT | O_TRUNC, 0644);
    if (handle.fd < 0) return false;
    
    if (ftruncate(handle.fd, handle.totalSize) < 0) {
        close(handle.fd);
        return false;
    }
    
    return true;
#endif
}

bool FileWriter::writeMappedRange(
    const WriteTarget& target,
    uint64_t offset,
    const char* data,
    uint64_t size) {
    uint64_t remaining = size;
    uint64_t currentOffset = offset;
    const char* currentData = data;

#ifdef _WIN32
    SYSTEM_INFO systemInfo{};
    GetSystemInfo(&systemInfo);
    const uint64_t granularity = systemInfo.dwAllocationGranularity;

    while (remaining > 0) {
        const uint64_t alignedOffset = (currentOffset / granularity) * granularity;
        const uint64_t viewDelta = currentOffset - alignedOffset;
        const uint64_t available = std::min(
            MappingWindowBytes,
            target.totalSize - alignedOffset);
        const uint64_t copyBytes = std::min(remaining, available - viewDelta);

        void* view = MapViewOfFile(
            target.hMapping,
            FILE_MAP_WRITE,
            static_cast<DWORD>(alignedOffset >> 32),
            static_cast<DWORD>(alignedOffset & 0xFFFFFFFFULL),
            static_cast<SIZE_T>(available));
        if (!view) {
            spdlog::error("MapViewOfFile failed at offset {}: {}", alignedOffset, GetLastError());
            return false;
        }

        memcpy(static_cast<char*>(view) + viewDelta, currentData, static_cast<size_t>(copyBytes));
        UnmapViewOfFile(view);

        currentOffset += copyBytes;
        currentData += copyBytes;
        remaining -= copyBytes;
    }
#else
    const long pageSizeResult = sysconf(_SC_PAGE_SIZE);
    const uint64_t pageSize = pageSizeResult > 0
        ? static_cast<uint64_t>(pageSizeResult)
        : 4096ULL;

    while (remaining > 0) {
        const uint64_t alignedOffset = (currentOffset / pageSize) * pageSize;
        const uint64_t viewDelta = currentOffset - alignedOffset;
        const uint64_t available = std::min(
            MappingWindowBytes,
            target.totalSize - alignedOffset);
        const uint64_t copyBytes = std::min(remaining, available - viewDelta);

        void* view = mmap(
            nullptr,
            static_cast<size_t>(available),
            PROT_READ | PROT_WRITE,
            MAP_SHARED,
            target.fd,
            static_cast<off_t>(alignedOffset));
        if (view == MAP_FAILED) {
            spdlog::error("mmap failed at offset {}", alignedOffset);
            return false;
        }

        memcpy(static_cast<char*>(view) + viewDelta, currentData, static_cast<size_t>(copyBytes));
        munmap(view, static_cast<size_t>(available));

        currentOffset += copyBytes;
        currentData += copyBytes;
        remaining -= copyBytes;
    }
#endif

    return true;
}

ChunkWriteStatus FileWriter::writeChunk(const std::string& fileId,
                                        uint64_t chunkIndex,
                                        const char* data,
                                        uint64_t size) {
    WriteTarget writeTarget;
    uint64_t offset = 0;
    std::shared_ptr<std::mutex> writeMutex;
    std::shared_ptr<FinalizationState> finalization;

    {
        std::lock_guard<std::mutex> lock(m_mutex);
        
        auto it = m_handles.find(fileId);
        if (it == m_handles.end()) {
            auto session = m_sessions.find(fileId);
            if (session == m_sessions.end()) {
                spdlog::error("Unknown file ID: {}", fileId);
                return ChunkWriteStatus::UnknownFile;
            }
            finalization = session->second;
        } else {
            writeMutex = it->second.writeMutex;
            finalization = it->second.finalization;
        }
    }

    if (!writeMutex) {
        return waitForFinalization(finalization);
    }

    std::lock_guard<std::mutex> writeLock(*writeMutex);
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        auto it = m_handles.find(fileId);
        if (it == m_handles.end()) {
            auto session = m_sessions.find(fileId);
            if (session == m_sessions.end()) {
                return ChunkWriteStatus::UnknownFile;
            }
            finalization = session->second;
        } else {
            FileHandle& handle = it->second;

            if (chunkIndex < handle.chunksReceived) {
                if (chunkIndex < handle.acceptedChunkSizes.size() &&
                    handle.acceptedChunkSizes[static_cast<size_t>(chunkIndex)] == size) {
                    return ChunkWriteStatus::AlreadyAccepted;
                }
                return ChunkWriteStatus::OutOfOrder;
            }

            if (chunkIndex != handle.chunksReceived) {
                spdlog::warn(
                    "Out-of-order chunk for {}: received {}, expected {}",
                    fileId,
                    chunkIndex,
                    handle.chunksReceived);
                return ChunkWriteStatus::OutOfOrder;
            }

            offset = handle.bytesWritten;

            if (offset + size > handle.totalSize) {
                spdlog::error("Chunk would exceed file size");
                return ChunkWriteStatus::SizeExceeded;
            }

            writeTarget.totalSize = handle.totalSize;
#ifdef _WIN32
            writeTarget.hMapping = handle.hMapping;
#else
            writeTarget.fd = handle.fd;
#endif
        }
    }

    if (
#ifdef _WIN32
        writeTarget.hMapping == nullptr
#else
        writeTarget.fd < 0
#endif
    ) {
        return waitForFinalization(finalization);
    }
    
    // Per-file locking keeps chunks sequential while allowing separate files
    // to copy through independent bounded mapping windows concurrently.
    if (!writeMappedRange(writeTarget, offset, data, size)) {
        return ChunkWriteStatus::StorageError;
    }

    const bool hashUpdated =
        m_hashEngine && m_hashEngine->updateHash(fileId, data, size);

    {
        std::lock_guard<std::mutex> lock(m_mutex);
        auto it = m_handles.find(fileId);
        if (it == m_handles.end()) {
            return ChunkWriteStatus::UnknownFile;
        }
        it->second.bytesWritten += size;
        it->second.chunksReceived++;
        it->second.acceptedChunkSizes.push_back(size);
        if (!hashUpdated) {
            it->second.streamingHashValid = false;
        }
    }

    return ChunkWriteStatus::Success;
}

std::string FileWriter::finalizeFile(
    const std::string& fileId,
    bool* finalizedNow,
    bool* stillFinalizing) {
    FileFinalizeResult result = finalizeFileResult(fileId, finalizedNow);
    if (stillFinalizing) {
        *stillFinalizing =
            result.disposition == FileFinalizeDisposition::Finalizing;
    }
    return result.filename;
}

FileFinalizeResult FileWriter::finalizeFileResult(
    const std::string& fileId,
    bool* finalizedNow) {
    if (finalizedNow) {
        *finalizedNow = false;
    }

    FileHandle localHandle;
    std::shared_ptr<std::mutex> writeMutex;
    std::shared_ptr<FinalizationState> finalization;
    
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        
        auto it = m_handles.find(fileId);
        if (it == m_handles.end()) {
            auto session = m_sessions.find(fileId);
            if (session == m_sessions.end()) {
                return {};
            }
            finalization = session->second;
        } else {
            writeMutex = it->second.writeMutex;
            finalization = it->second.finalization;
        }
    }

    // Never wait on FinalizationState::mutex while holding m_mutex. Keeping
    // this one-way lock order prevents a retry from blocking unrelated uploads.
    if (!writeMutex) {
        return waitForFinalizedResult(finalization);
    }

    {
        std::lock_guard<std::mutex> writeLock(*writeMutex);
        std::lock_guard<std::mutex> lock(m_mutex);
        auto it = m_handles.find(fileId);
        if (it == m_handles.end()) {
            auto session = m_sessions.find(fileId);
            finalization = session == m_sessions.end()
                ? nullptr
                : session->second;
        } else {
            if (it->second.bytesWritten != it->second.totalSize ||
                it->second.chunksReceived != it->second.chunksExpected) {
                spdlog::error(
                    "Cannot finalize incomplete file {}: {} of {} bytes and {} of {} chunks received",
                    fileId,
                    it->second.bytesWritten,
                    it->second.totalSize,
                    it->second.chunksReceived,
                    it->second.chunksExpected);
                return {};
            }

            {
                std::lock_guard<std::mutex> stateLock(finalization->mutex);
                finalization->finalizing = true;
            }
            localHandle = std::move(it->second);
            m_handles.erase(it);
        }
    }

    if (localHandle.fileId.empty()) {
        return finalization
            ? waitForFinalizedResult(finalization)
            : FileFinalizeResult{};
    }

    // The active handle is no longer discoverable, so retries observe the
    // finalization state instead of blocking this mutex across filesystem I/O.
    
    auto failFinalization = [&finalization]() {
        {
            std::lock_guard<std::mutex> stateLock(finalization->mutex);
            finalization->finalizing = false;
            finalization->failed = true;
        }
        finalization->completedCondition.notify_all();
    };

    std::string finalName;
    std::string fullHash;
    FileFinalizeDisposition disposition = FileFinalizeDisposition::Error;
    try {
        if (localHandle.streamingHashValid && m_hashEngine) {
            fullHash = m_hashEngine->finalizeHash(fileId);
        } else if (m_hashEngine) {
            m_hashEngine->abortHash(fileId);
        }

        closeHandle(localHandle);

        if (fullHash.empty()) {
            fullHash = HashEngine::computeFileHash(localHandle.tempPath);
        }
        if (fullHash.empty()) {
            spdlog::error("Failed to compute full SHA-256 for {}", localHandle.originalName);
            failFinalization();
            return {};
        }

        // Serialize collision checks and the final rename so concurrent files
        // cannot select the same destination.
        std::lock_guard<std::mutex> finalizeLock(m_finalizeMutex);
        finalName = makeFinalFilename(localHandle.originalName);
        fs::path finalPath = fs::u8path(m_uploadDir) / fs::u8path(finalName);

        if (fs::exists(finalPath)) {
            const std::string existingHash =
                HashEngine::computeFileHash(finalPath.u8string());
            if (localHandle.skipExactDuplicates &&
                !existingHash.empty() &&
                existingHash == fullHash) {
                std::error_code removeError;
                fs::remove(fs::u8path(localHandle.tempPath), removeError);
                if (removeError) {
                    spdlog::error(
                        "Failed to remove duplicate temporary file: {}",
                        removeError.message());
                    failFinalization();
                    return {};
                }
                disposition = FileFinalizeDisposition::Duplicate;
            } else {
                auto [isDuplicate, duplicateName] =
                    localHandle.skipExactDuplicates
                        ? findVerifiedDuplicate(fullHash)
                        : std::pair<bool, std::string>{false, ""};
                if (isDuplicate) {
                    finalName = duplicateName;
                    std::error_code removeError;
                    fs::remove(fs::u8path(localHandle.tempPath), removeError);
                    if (removeError) {
                        spdlog::error(
                            "Failed to remove duplicate temporary file: {}",
                            removeError.message());
                        failFinalization();
                        return {};
                    }
                    disposition = FileFinalizeDisposition::Duplicate;
                } else if (
                    m_filenameConflictPolicy ==
                    lmt::FilenameConflictPolicy::KeepBoth) {
                    finalName = makeNumberedFilename(finalName);
                    if (finalName.empty()) {
                        spdlog::error(
                            "Unable to allocate a numbered filename for {}",
                            localHandle.originalName);
                        failFinalization();
                        return {};
                    }

                    finalPath =
                        fs::u8path(m_uploadDir) / fs::u8path(finalName);
                    std::error_code renameError;
                    fs::rename(
                        fs::u8path(localHandle.tempPath),
                        finalPath,
                        renameError);
                    if (renameError) {
                        spdlog::error(
                            "Failed to rename conflicting file: {}",
                            renameError.message());
                        failFinalization();
                        return {};
                    }
                    disposition = FileFinalizeDisposition::Saved;
                } else {
                    std::error_code removeError;
                    fs::remove(fs::u8path(localHandle.tempPath), removeError);
                    if (removeError) {
                        spdlog::warn(
                            "Failed to remove conflicting temporary file: {}",
                            removeError.message());
                    }
                    disposition = FileFinalizeDisposition::NameConflict;
                }
            }
        } else {
            auto [isDuplicate, duplicateName] =
                localHandle.skipExactDuplicates
                    ? findVerifiedDuplicate(fullHash)
                    : std::pair<bool, std::string>{false, ""};
            if (isDuplicate) {
                finalName = duplicateName;
                std::error_code removeError;
                fs::remove(fs::u8path(localHandle.tempPath), removeError);
                if (removeError) {
                    spdlog::error(
                        "Failed to remove duplicate temporary file: {}",
                        removeError.message());
                    failFinalization();
                    return {};
                }
                disposition = FileFinalizeDisposition::Duplicate;
            } else {
                std::error_code renameError;
                fs::rename(
                    fs::u8path(localHandle.tempPath),
                    finalPath,
                    renameError);

                if (renameError) {
                    spdlog::error(
                        "Failed to rename temp file: {}",
                        renameError.message());
                    failFinalization();
                    return {};
                }
                disposition = FileFinalizeDisposition::Saved;
            }
        }

        if (disposition == FileFinalizeDisposition::Saved ||
            disposition == FileFinalizeDisposition::Duplicate) {
            storeHash(fullHash, finalName);
        }
    } catch (...) {
        if (m_hashEngine) {
            m_hashEngine->abortHash(fileId);
        }
        failFinalization();
        throw;
    }

    {
        std::lock_guard<std::mutex> stateLock(finalization->mutex);
        finalization->filename = finalName;
        finalization->sha256 = fullHash;
        finalization->disposition = disposition;
        finalization->finalizing = false;
        finalization->completed = true;
    }
    finalization->completedCondition.notify_all();

    {
        std::lock_guard<std::mutex> lock(m_mutex);
        rememberCompletedSessionLocked(fileId);
    }

    if (finalizedNow) {
        *finalizedNow = true;
    }

    if (disposition == FileFinalizeDisposition::Saved) {
        spdlog::info(
            "Finalized file with original name: {}",
            finalName);
    } else if (disposition == FileFinalizeDisposition::Duplicate) {
        spdlog::info(
            "Verified exact duplicate; kept existing file: {}",
            finalName);
    } else if (disposition == FileFinalizeDisposition::NameConflict) {
        spdlog::warn(
            "Filename conflict for '{}': destination contains different data",
            finalName);
    }

    return {disposition, finalName, fullHash};
}

ChunkWriteStatus FileWriter::waitForFinalization(
    const std::shared_ptr<FinalizationState>& state) const {
    std::unique_lock<std::mutex> lock(state->mutex);
    const bool resolved = state->completedCondition.wait_for(
        lock,
        FinalizationWaitTimeout,
        [&state] {
            return state->completed || state->failed;
        });
    if (!resolved) {
        return ChunkWriteStatus::Finalizing;
    }
    return state->completed
        ? ChunkWriteStatus::Completed
        : ChunkWriteStatus::StorageError;
}

std::string FileWriter::waitForFinalizedFilename(
    const std::shared_ptr<FinalizationState>& state,
    bool* stillFinalizing) const {
    std::unique_lock<std::mutex> lock(state->mutex);
    const bool resolved = state->completedCondition.wait_for(
        lock,
        FinalizationWaitTimeout,
        [&state] {
            return state->completed || state->failed;
        });
    if (!resolved) {
        if (stillFinalizing) {
            *stillFinalizing = true;
        }
        return "";
    }
    return state->completed ? state->filename : "";
}

FileFinalizeResult FileWriter::waitForFinalizedResult(
    const std::shared_ptr<FinalizationState>& state) const {
    std::unique_lock<std::mutex> lock(state->mutex);
    const bool resolved = state->completedCondition.wait_for(
        lock,
        FinalizationWaitTimeout,
        [&state] {
            return state->completed || state->failed;
        });
    if (!resolved) {
        return {FileFinalizeDisposition::Finalizing, "", ""};
    }
    if (state->failed) {
        return {};
    }
    return {
        state->disposition,
        state->filename,
        state->sha256
    };
}

void FileWriter::rememberCompletedSessionLocked(const std::string& fileId) {
    m_completedSessionOrder.push_back(fileId);
    while (m_completedSessionOrder.size() > MaxCompletedSessions) {
        const std::string expired = std::move(m_completedSessionOrder.front());
        m_completedSessionOrder.pop_front();
        if (m_handles.find(expired) == m_handles.end()) {
            m_sessions.erase(expired);
        }
    }
}

void FileWriter::closeHandle(FileHandle& handle) {
#ifdef _WIN32
    if (handle.hMapping) {
        CloseHandle(handle.hMapping);
        handle.hMapping = nullptr;
    }
    if (handle.hFile != INVALID_HANDLE_VALUE) {
        CloseHandle(handle.hFile);
        handle.hFile = INVALID_HANDLE_VALUE;
    }
#else
    if (handle.fd >= 0) {
        close(handle.fd);
        handle.fd = -1;
    }
#endif
}

std::pair<bool, std::string> FileWriter::isDuplicate(const std::string& hash) {
    if (!m_hashEngine || hash.empty()) return {false, ""};
    std::lock_guard<std::mutex> finalizeLock(m_finalizeMutex);
    return findVerifiedDuplicate(hash);
}

bool FileWriter::hasPreflightCandidate(
    const std::string& originalName,
    uint64_t sizeBytes) {
    if (!m_hashEngine) {
        return false;
    }
    refreshDuplicateInventoryIfDue();
    const std::string safeName = makeFinalFilename(originalName);
    std::lock_guard<std::mutex> finalizeLock(m_finalizeMutex);
    const fs::path exactPath =
        fs::u8path(m_uploadDir) / fs::u8path(safeName).filename();
    std::error_code exactError;
    if (fs::is_regular_file(exactPath, exactError) && !exactError) {
        return true;
    }
    for (size_t attempt = 0; attempt < 256; ++attempt) {
        const auto candidate = m_hashEngine->findFirstCandidate(safeName, sizeBytes);
        if (!candidate) return false;
        const fs::path path =
            fs::u8path(m_uploadDir) / fs::u8path(candidate->filename).filename();
        std::error_code ec;
        if (fs::is_regular_file(path, ec) && !ec) {
            return true;
        }
        m_hashEngine->removeFile(candidate->filename);
    }
    return false;
}

void FileWriter::refreshDuplicateInventoryIfDue() {
    constexpr auto RefreshInterval = std::chrono::seconds(1);
    const auto now = std::chrono::steady_clock::now();
    std::lock_guard<std::mutex> lock(m_inventoryRefreshMutex);
    if (m_lastInventoryRefresh.time_since_epoch().count() != 0 &&
        now - m_lastInventoryRefresh < RefreshInterval) {
        return;
    }
    m_hashEngine->reconcileDirectory(m_uploadDir);
    m_lastInventoryRefresh = std::chrono::steady_clock::now();
}

PreflightResult FileWriter::verifyPreflight(
    const std::string& originalName,
    uint64_t sizeBytes,
    const std::string& sha256,
    PreflightHashCache* hashCache) {
    if (!m_hashEngine || sha256.size() != 64) {
        return {};
    }

    const std::string safeName = makeFinalFilename(originalName);
    std::lock_guard<std::mutex> finalizeLock(m_finalizeMutex);
    auto candidates = m_hashEngine->findVerificationCandidates(
        safeName,
        sizeBytes,
        sha256);
    const bool hasExactCandidate = std::any_of(
        candidates.begin(),
        candidates.end(),
        [&safeName](const FileInventoryRecord& record) {
            return record.filename == safeName;
        });
    const fs::path exactPath =
        fs::u8path(m_uploadDir) / fs::u8path(safeName).filename();
    std::error_code exactError;
    if (!hasExactCandidate &&
        fs::is_regular_file(exactPath, exactError) &&
        !exactError) {
        FileInventoryRecord exact;
        exact.filename = safeName;
        exact.sizeBytes = fs::file_size(exactPath, exactError);
        candidates.push_back(std::move(exact));
    }
    bool sameNameConflict = false;
    bool inconclusive = false;

    for (const auto& candidate : candidates) {
        const fs::path path =
            fs::u8path(m_uploadDir) / fs::u8path(candidate.filename).filename();
        std::error_code ec;
        if (!fs::is_regular_file(path, ec) || ec) {
            m_hashEngine->removeFile(candidate.filename);
            continue;
        }

        const uint64_t actualSize = fs::file_size(path, ec);
        if (ec) {
            continue;
        }
        if (candidate.filename == safeName &&
            (actualSize != sizeBytes || candidate.sha256 != sha256)) {
            sameNameConflict = true;
        }
        if (actualSize != sizeBytes) {
            continue;
        }

        const int64_t modifiedTime = inventoryModifiedTime(path);
        const bool exactName = candidate.filename == safeName;
        const bool storedHashMatches = candidate.sha256 == sha256;
        const bool inventoryMetadataChanged =
            candidate.sizeBytes != actualSize ||
            candidate.modifiedTime != modifiedTime;
        if (!exactName &&
            !candidate.sha256.empty() &&
            !storedHashMatches &&
            !inventoryMetadataChanged) {
            continue;
        }
        std::string actualHash;
        if (hashCache) {
            const auto cached = hashCache->find(candidate.filename);
            if (cached != hashCache->end() &&
                cached->second.sizeBytes == actualSize &&
                cached->second.modifiedTime == modifiedTime) {
                actualHash = cached->second.sha256;
            }
        }
        if (actualHash.empty()) {
            actualHash = HashEngine::computeFileHash(path.u8string());
            if (hashCache && !actualHash.empty()) {
                (*hashCache)[candidate.filename] = {
                    actualSize,
                    modifiedTime,
                    actualHash
                };
            }
        }
        if (actualHash.empty()) {
            inconclusive = true;
            continue;
        }
        const uint64_t afterSize = fs::file_size(path, ec);
        const int64_t afterModifiedTime = inventoryModifiedTime(path);
        if (ec || afterSize != actualSize || afterModifiedTime != modifiedTime) {
            inconclusive = true;
            if (!ec) {
                m_hashEngine->upsertFile(
                    candidate.filename,
                    "",
                    afterSize,
                    afterModifiedTime,
                    inventoryNow());
            }
            continue;
        }
        m_hashEngine->upsertFile(
            candidate.filename,
            actualHash,
            actualSize,
            modifiedTime,
            inventoryNow());
        if (actualHash == sha256) {
            return {
                PreflightDisposition::Skip,
                candidate.filename
            };
        }
        if (candidate.filename == safeName) {
            sameNameConflict = true;
        }
    }

    if (sameNameConflict) {
        return {
            PreflightDisposition::UploadNameConflict,
            safeName
        };
    }
    if (inconclusive) {
        return {PreflightDisposition::Inconclusive, safeName};
    }
    return {PreflightDisposition::Upload, safeName};
}

std::pair<bool, std::string> FileWriter::findVerifiedDuplicate(
    const std::string& hash) {
    for (const auto& record : m_hashEngine->findByHash(hash)) {
        if (verifyInventoryRecord(record.filename, record.sizeBytes, hash)) {
            return {true, record.filename};
        }
    }
    return {false, ""};
}

bool FileWriter::verifyInventoryRecord(
    const std::string& filename,
    uint64_t expectedSize,
    const std::string& expectedHash) {
    const fs::path candidate =
        fs::u8path(m_uploadDir) / fs::u8path(filename).filename();
    std::error_code ec;
    if (!fs::is_regular_file(candidate, ec) || ec) {
        m_hashEngine->removeFile(filename);
        return false;
    }

    const uint64_t actualSize = fs::file_size(candidate, ec);
    if (ec || (expectedSize != 0 && actualSize != expectedSize)) {
        m_hashEngine->removeFile(filename);
        return false;
    }

    const std::string actualHash =
        HashEngine::computeFileHash(candidate.u8string());
    if (actualHash == expectedHash) {
        m_hashEngine->upsertFile(
            filename,
            actualHash,
            actualSize,
            inventoryModifiedTime(candidate),
            inventoryNow());
        return true;
    }

    spdlog::warn(
        "Invalidated stale duplicate record for '{}': file content changed",
        filename);
    m_hashEngine->upsertFile(
        filename,
        actualHash,
        actualSize,
        inventoryModifiedTime(candidate),
        actualHash.empty() ? 0 : inventoryNow());
    return false;
}

void FileWriter::storeHash(const std::string& hash, const std::string& filename) {
    if (m_hashEngine && !hash.empty()) {
        const fs::path path =
            fs::u8path(m_uploadDir) / fs::u8path(filename).filename();
        std::error_code ec;
        const uint64_t size = fs::file_size(path, ec);
        m_hashEngine->upsertFile(
            filename,
            hash,
            ec ? 0 : size,
            inventoryModifiedTime(path),
            inventoryNow());
    }
}
