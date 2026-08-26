cmake_minimum_required(VERSION 3.20)
project(LocalMediaTransferServer VERSION 2.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Find packages
find_package(OpenSSL REQUIRED)
find_package(spdlog CONFIG REQUIRED)
find_package(nlohmann_json CONFIG REQUIRED)
find_package(Crow CONFIG REQUIRED)
find_package(unofficial-sqlite3 CONFIG REQUIRED)

# Source files
set(SOURCES
    src/main.cpp
    src/config/RuntimeEnvironment.cpp
    src/server/HttpServer.cpp
    src/io/FileWriter.cpp
    src/io/HashEngine.cpp
    src/ipc/PipeServer.cpp
    src/ipc/ServerOwnership.cpp
    src/stats/MetricsCollector.cpp
    src/benchmark/BenchmarkStore.cpp
    src/history/TransferHistoryStore.cpp
    src/security/PairingStore.cpp
    src/security/NativeSessionStore.cpp
    src/security/TlsIdentity.cpp
    src/discovery/DiscoveryServer.cpp
)

set(HEADERS
    include/server/HttpServer.hpp
    include/config/RuntimeEnvironment.hpp
    include/io/FileWriter.hpp
    include/io/HashEngine.hpp
    include/ipc/PipeServer.hpp
    include/stats/MetricsCollector.hpp
    include/common/Types.hpp
    include/common/Version.hpp
    include/benchmark/BenchmarkStore.hpp
    include/history/TransferHistoryStore.hpp
    include/security/PairingStore.hpp
    include/security/NativeSessionStore.hpp
    include/security/TlsIdentity.hpp
    include/discovery/DiscoveryServer.hpp
)

# Create executable
add_executable(${PROJECT_NAME} ${SOURCES} ${HEADERS})

# Include directories
target_include_directories(${PROJECT_NAME} PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)

# Link libraries
target_link_libraries(${PROJECT_NAME} PRIVATE
    OpenSSL::SSL
    OpenSSL::Crypto
    spdlog::spdlog
    nlohmann_json::nlohmann_json
    Crow::Crow
    unofficial::sqlite3::sqlite3
)

# Windows-specific settings
if(WIN32)
    target_compile_definitions(${PROJECT_NAME} PRIVATE
        _WIN32_WINNT=0x0A00  # Windows 10+
        NOMINMAX
        WIN32_LEAN_AND_MEAN
        CROW_ENABLE_SSL
        # Prevent fmt 12.x abort() crash in Debug builds:
        # Crow formats content_length (int, can be -1) with unsigned specifiers,
        # triggering FMT_ASSERT("negative value") which calls abort().
        # try-catch CANNOT catch abort(). We must disable the assertion at compile time.
        CROW_LOG_LEVEL=3       # Only show WARNINGS and above from Crow
    )
    # Override FMT_ASSERT to be a no-op so fmt never calls abort()
    target_compile_options(${PROJECT_NAME} PRIVATE
        "/DFMT_ASSERT(x,...)=((void)0)"
    )
    target_link_libraries(${PROJECT_NAME} PRIVATE ws2_32 iphlpapi crypt32 advapi32)
endif()

# Output directory
set_target_properties(${PROJECT_NAME} PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
)

# Copy static directory to output
add_custom_command(
    TARGET ${PROJECT_NAME} POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E rm -rf
    "${CMAKE_BINARY_DIR}/bin/static"
    COMMAND ${CMAKE_COMMAND} -E copy_directory
    "${CMAKE_CURRENT_SOURCE_DIR}/static"
    "${CMAKE_BINARY_DIR}/bin/static"
    COMMENT "Copying static web assets to output directory..."
)

if(WIN32)
    if(CMAKE_BUILD_TYPE STREQUAL "Debug")
        file(GLOB OPENSSL_SSL_RUNTIME "${VCPKG_INSTALLED_DIR}/*/debug/bin/libssl-*.dll")
    else()
        file(GLOB OPENSSL_SSL_RUNTIME "${VCPKG_INSTALLED_DIR}/*/bin/libssl-*.dll")
    endif()
    if(OPENSSL_SSL_RUNTIME)
        list(GET OPENSSL_SSL_RUNTIME 0 OPENSSL_SSL_RUNTIME_FILE)
        add_custom_command(
            TARGET ${PROJECT_NAME} POST_BUILD
            COMMAND ${CMAKE_COMMAND} -E copy_if_different
                "${OPENSSL_SSL_RUNTIME_FILE}"
                "$<TARGET_FILE_DIR:${PROJECT_NAME}>"
            COMMENT "Copying OpenSSL TLS runtime..."
        )
    endif()
endif()

message(STATUS "LocalMediaTransferServer v${PROJECT_VERSION}")
message(STATUS "Build type: ${CMAKE_BUILD_TYPE}")
