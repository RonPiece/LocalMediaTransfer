#pragma once

#include <filesystem>
#include <string>

namespace lmt {

enum class RuntimeEnvironment {
    Production,
    Test,
    Benchmark
};

struct RuntimeEnvironmentConfig {
    RuntimeEnvironment environment;
    std::string name;
    std::string dataNamespace;
    std::filesystem::path dataRoot;
    std::string pipeName;
    std::string mutexName;
    int defaultHttpsPort;
    int defaultHttpPort;
    unsigned short discoveryPort;
    bool discoveryAllowed;
};

RuntimeEnvironment parseRuntimeEnvironment(const std::string& value);

RuntimeEnvironmentConfig makeRuntimeEnvironmentConfig(
    RuntimeEnvironment environment,
    const std::filesystem::path& localAppDataRoot,
    const std::string& instanceId = "");

bool isValidInstanceId(const std::string& value);

} // namespace lmt
