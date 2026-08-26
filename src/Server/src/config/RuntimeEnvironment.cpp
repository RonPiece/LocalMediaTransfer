#include "config/RuntimeEnvironment.hpp"

#include <algorithm>
#include <cctype>
#include <stdexcept>

namespace lmt {

RuntimeEnvironment parseRuntimeEnvironment(const std::string& value) {
    if (value == "production") return RuntimeEnvironment::Production;
    if (value == "test") return RuntimeEnvironment::Test;
    if (value == "benchmark") return RuntimeEnvironment::Benchmark;
    throw std::invalid_argument(
        "--environment must be production, test, or benchmark");
}

bool isValidInstanceId(const std::string& value) {
    return !value.empty() && value.size() <= 64 &&
        std::all_of(value.begin(), value.end(), [](unsigned char character) {
            return std::isalnum(character) || character == '-' ||
                character == '_' || character == '.';
        });
}

RuntimeEnvironmentConfig makeRuntimeEnvironmentConfig(
    RuntimeEnvironment environment,
    const std::filesystem::path& localAppDataRoot,
    const std::string& instanceId) {
    if (!instanceId.empty() && !isValidInstanceId(instanceId)) {
        throw std::invalid_argument(
            "--instance-id must contain 1-64 letters, digits, dots, dashes, or underscores");
    }
    if (environment == RuntimeEnvironment::Production && !instanceId.empty()) {
        throw std::invalid_argument(
            "--instance-id is available only in test and benchmark environments");
    }

    RuntimeEnvironmentConfig config{};
    config.environment = environment;
    switch (environment) {
    case RuntimeEnvironment::Production:
        config.name = "production";
        config.dataNamespace = "LocalMediaTransfer";
        config.pipeName = "LocalMediaTransferPipe";
        config.mutexName = "LocalMediaTransferServer.SingleInstance";
        config.defaultHttpsPort = 8443;
        config.defaultHttpPort = 8080;
        config.discoveryPort = 45892;
        config.discoveryAllowed = true;
        break;
    case RuntimeEnvironment::Test:
        config.name = "test";
        config.dataNamespace = "LocalMediaTransfer.Test";
        config.pipeName = "LocalMediaTransferPipe.Test";
        config.mutexName = "LocalMediaTransferServer.Test.SingleInstance";
        config.defaultHttpsPort = 18443;
        config.defaultHttpPort = 18080;
        config.discoveryPort = 45893;
        config.discoveryAllowed = true;
        break;
    case RuntimeEnvironment::Benchmark:
        config.name = "benchmark";
        config.dataNamespace = "LocalMediaTransfer.Benchmark";
        config.pipeName = "LocalMediaTransferPipe.Benchmark";
        config.mutexName = "LocalMediaTransferServer.Benchmark.SingleInstance";
        config.defaultHttpsPort = 28443;
        config.defaultHttpPort = 28080;
        config.discoveryPort = 0;
        config.discoveryAllowed = false;
        break;
    }

    config.dataRoot = localAppDataRoot / config.dataNamespace;
    if (!instanceId.empty()) {
        config.dataRoot /= std::filesystem::path("instances") / instanceId;
        config.pipeName += "." + instanceId;
        config.mutexName += "." + instanceId;
    }
    return config;
}

} // namespace lmt
