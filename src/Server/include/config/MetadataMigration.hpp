#pragma once

#include "config/StoragePaths.hpp"
#include <filesystem>
#include <algorithm>
#include <cctype>
#include <string>

namespace lmt::StoragePaths {

inline void migrateMetadata(const std::filesystem::path& uploadPath) {
    namespace fs = std::filesystem;
    const auto legacy = uploadPath / LegacyMetadataDirectoryName;
    const auto current = uploadPath / MetadataDirectoryName;
    if (!fs::exists(legacy)) return;
    if (!fs::exists(current)) {
        // Rename the entire directory, including SQLite journals, as one unit.
        fs::rename(legacy, current);
        return;
    }
    // With two directories, keep the legacy database family together. Moving
    // individual WAL/SHM/journal files can attach them to a different database
    // or split recovery state if startup is interrupted. The current index is
    // rebuilt/revalidated from media; legacy data remains available for recovery.
    for (const auto& entry : fs::directory_iterator(legacy)) {
        auto name = entry.path().filename().u8string();
        std::transform(name.begin(), name.end(), name.begin(),
            [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
        if (name == HashDatabaseName ||
            name.rfind(std::string(HashDatabaseName) + "-", 0) == 0) continue;
        const auto target = current / entry.path().filename();
        if (!fs::exists(target)) fs::rename(entry.path(), target);
    }
    // Interrupted merges are resumable: never overwrite a collision or delete
    // unmerged contents. Any permission error fails startup before opening DBs.
    if (fs::is_empty(legacy)) fs::remove(legacy);
}

}
