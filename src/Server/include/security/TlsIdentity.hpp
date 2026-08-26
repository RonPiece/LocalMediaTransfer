#pragma once

#include <filesystem>
#include <string>
#include <utility>

class TlsIdentity {
public:
    TlsIdentity(std::string certificatePem, std::string privateKeyPem,
        std::string fingerprint, std::string expiresAt)
        : m_certificatePem(std::move(certificatePem))
        , m_privateKeyPem(std::move(privateKeyPem))
        , m_fingerprint(std::move(fingerprint))
        , m_expiresAt(std::move(expiresAt)) {}

    static TlsIdentity loadOrCreate(const std::filesystem::path& storageDirectory);
    static void reset(const std::filesystem::path& storageDirectory);

    const std::string& certificatePem() const { return m_certificatePem; }
    const std::string& privateKeyPem() const { return m_privateKeyPem; }
    const std::string& fingerprint() const { return m_fingerprint; }
    const std::string& expiresAt() const { return m_expiresAt; }

private:
    std::string m_certificatePem;
    std::string m_privateKeyPem;
    std::string m_fingerprint;
    std::string m_expiresAt;
};
