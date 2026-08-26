#include "security/TlsIdentity.hpp"

#include <openssl/bio.h>
#include <openssl/evp.h>
#include <openssl/pem.h>
#include <openssl/rand.h>
#include <openssl/x509.h>
#include <openssl/x509v3.h>

#ifdef _WIN32
#include <windows.h>
#include <wincrypt.h>
#endif

#include <fstream>
#include <iomanip>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <vector>

namespace {
using BioPtr = std::unique_ptr<BIO, decltype(&BIO_free)>;
using KeyPtr = std::unique_ptr<EVP_PKEY, decltype(&EVP_PKEY_free)>;
using X509Ptr = std::unique_ptr<X509, decltype(&X509_free)>;

std::vector<unsigned char> readBinary(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) throw std::runtime_error("Unable to read TLS identity file: " + path.string());
    return {std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>()};
}

std::string readText(const std::filesystem::path& path) {
    const auto bytes = readBinary(path);
    return {bytes.begin(), bytes.end()};
}

void writeAtomic(const std::filesystem::path& path, const void* data, size_t size) {
    std::filesystem::create_directories(path.parent_path());
    const auto temporary = path.string() + ".tmp";
    {
        std::ofstream output(temporary, std::ios::binary | std::ios::trunc);
        if (!output) throw std::runtime_error("Unable to write TLS identity file");
        output.write(static_cast<const char*>(data), static_cast<std::streamsize>(size));
        output.flush();
        if (!output) throw std::runtime_error("Unable to flush TLS identity file");
    }
    std::error_code ec;
    std::filesystem::remove(path, ec);
    std::filesystem::rename(temporary, path);
}

std::vector<unsigned char> protectKey(const std::string& plain) {
#ifdef _WIN32
    DATA_BLOB input{static_cast<DWORD>(plain.size()),
        reinterpret_cast<BYTE*>(const_cast<char*>(plain.data()))};
    DATA_BLOB output{};
    if (!CryptProtectData(&input, L"Local Media Transfer TLS private key", nullptr,
            nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN, &output)) {
        throw std::runtime_error("Windows DPAPI could not protect the TLS private key");
    }
    std::vector<unsigned char> result(output.pbData, output.pbData + output.cbData);
    LocalFree(output.pbData);
    return result;
#else
    return {plain.begin(), plain.end()};
#endif
}

std::string unprotectKey(const std::vector<unsigned char>& encrypted) {
#ifdef _WIN32
    DATA_BLOB input{static_cast<DWORD>(encrypted.size()),
        const_cast<BYTE*>(encrypted.data())};
    DATA_BLOB output{};
    if (!CryptUnprotectData(&input, nullptr, nullptr, nullptr, nullptr,
            CRYPTPROTECT_UI_FORBIDDEN, &output)) {
        throw std::runtime_error("Windows DPAPI could not decrypt the TLS private key");
    }
    std::string result(reinterpret_cast<char*>(output.pbData), output.cbData);
    SecureZeroMemory(output.pbData, output.cbData);
    LocalFree(output.pbData);
    return result;
#else
    return {encrypted.begin(), encrypted.end()};
#endif
}

std::string bioString(BIO* bio) {
    BUF_MEM* memory = nullptr;
    BIO_get_mem_ptr(bio, &memory);
    return memory ? std::string(memory->data, memory->length) : std::string{};
}

std::string fingerprint(X509* certificate) {
    unsigned char digest[EVP_MAX_MD_SIZE]{};
    unsigned int length = 0;
    if (X509_digest(certificate, EVP_sha256(), digest, &length) != 1) {
        throw std::runtime_error("Unable to fingerprint TLS certificate");
    }
    std::ostringstream value;
    value << std::hex << std::setfill('0');
    for (unsigned int i = 0; i < length; ++i) value << std::setw(2) << static_cast<int>(digest[i]);
    return value.str();
}

std::string expiry(X509* certificate) {
    BioPtr output(BIO_new(BIO_s_mem()), BIO_free);
    if (!output || ASN1_TIME_print(output.get(), X509_get0_notAfter(certificate)) != 1) {
        throw std::runtime_error("Unable to read TLS certificate expiry");
    }
    return bioString(output.get());
}

TlsIdentity parseIdentity(std::string certificatePem, std::string privateKeyPem) {
    BioPtr certBio(BIO_new_mem_buf(certificatePem.data(), static_cast<int>(certificatePem.size())), BIO_free);
    BioPtr keyBio(BIO_new_mem_buf(privateKeyPem.data(), static_cast<int>(privateKeyPem.size())), BIO_free);
    X509Ptr certificate(PEM_read_bio_X509(certBio.get(), nullptr, nullptr, nullptr), X509_free);
    KeyPtr key(PEM_read_bio_PrivateKey(keyBio.get(), nullptr, nullptr, nullptr), EVP_PKEY_free);
    if (!certificate || !key || X509_check_private_key(certificate.get(), key.get()) != 1) {
        throw std::runtime_error("Stored TLS certificate and private key are invalid");
    }
    if (X509_cmp_current_time(X509_get0_notAfter(certificate.get())) <= 0) {
        throw std::runtime_error("Stored TLS certificate has expired; reset the server identity");
    }
    return TlsIdentity(std::move(certificatePem), std::move(privateKeyPem),
        fingerprint(certificate.get()), expiry(certificate.get()));
}

TlsIdentity generateIdentity() {
    KeyPtr key(nullptr, EVP_PKEY_free);
    std::unique_ptr<EVP_PKEY_CTX, decltype(&EVP_PKEY_CTX_free)> context(
        EVP_PKEY_CTX_new_id(EVP_PKEY_EC, nullptr), EVP_PKEY_CTX_free);
    EVP_PKEY* rawKey = nullptr;
    if (!context || EVP_PKEY_keygen_init(context.get()) != 1 ||
        EVP_PKEY_CTX_set_ec_paramgen_curve_nid(context.get(), NID_X9_62_prime256v1) != 1 ||
        EVP_PKEY_keygen(context.get(), &rawKey) != 1) {
        throw std::runtime_error("Unable to generate ECDSA TLS private key");
    }
    key.reset(rawKey);

    X509Ptr certificate(X509_new(), X509_free);
    if (!certificate) throw std::runtime_error("Unable to allocate TLS certificate");
    X509_set_version(certificate.get(), 2);
    unsigned char serialBytes[8]{};
    if (RAND_bytes(serialBytes, sizeof(serialBytes)) != 1) throw std::runtime_error("Unable to generate certificate serial");
    uint64_t serial = 0;
    for (unsigned char byte : serialBytes) serial = (serial << 8) | byte;
    ASN1_INTEGER_set_uint64(X509_get_serialNumber(certificate.get()), serial >> 1);
    X509_gmtime_adj(X509_getm_notBefore(certificate.get()), -300);
    X509_gmtime_adj(X509_getm_notAfter(certificate.get()), 60L * 60L * 24L * 365L * 10L);
    X509_set_pubkey(certificate.get(), key.get());
    X509_NAME* name = X509_get_subject_name(certificate.get());
    X509_NAME_add_entry_by_txt(name, "CN", MBSTRING_ASC,
        reinterpret_cast<const unsigned char*>("Local Media Transfer"), -1, -1, 0);
    X509_NAME_add_entry_by_txt(name, "O", MBSTRING_ASC,
        reinterpret_cast<const unsigned char*>("Local Media Transfer"), -1, -1, 0);
    X509_set_issuer_name(certificate.get(), name);
    X509_EXTENSION* basic = X509V3_EXT_conf_nid(nullptr, nullptr, NID_basic_constraints, const_cast<char*>("critical,CA:FALSE"));
    X509_EXTENSION* usage = X509V3_EXT_conf_nid(nullptr, nullptr, NID_key_usage, const_cast<char*>("critical,digitalSignature,keyAgreement"));
    X509_EXTENSION* extended = X509V3_EXT_conf_nid(nullptr, nullptr, NID_ext_key_usage, const_cast<char*>("serverAuth"));
    if (!basic || !usage || !extended) throw std::runtime_error("Unable to create certificate extensions");
    X509_add_ext(certificate.get(), basic, -1); X509_EXTENSION_free(basic);
    X509_add_ext(certificate.get(), usage, -1); X509_EXTENSION_free(usage);
    X509_add_ext(certificate.get(), extended, -1); X509_EXTENSION_free(extended);
    if (X509_sign(certificate.get(), key.get(), EVP_sha256()) <= 0) {
        throw std::runtime_error("Unable to sign TLS certificate");
    }

    BioPtr certOutput(BIO_new(BIO_s_mem()), BIO_free);
    BioPtr keyOutput(BIO_new(BIO_s_mem()), BIO_free);
    if (!certOutput || !keyOutput || PEM_write_bio_X509(certOutput.get(), certificate.get()) != 1 ||
        PEM_write_bio_PrivateKey(keyOutput.get(), key.get(), nullptr, nullptr, 0, nullptr, nullptr) != 1) {
        throw std::runtime_error("Unable to serialize TLS identity");
    }
    return parseIdentity(bioString(certOutput.get()), bioString(keyOutput.get()));
}
}

TlsIdentity TlsIdentity::loadOrCreate(const std::filesystem::path& storageDirectory) {
    const auto certPath = storageDirectory / "server-cert.pem";
    const auto keyPath = storageDirectory / "server-key.dpapi";
    if (std::filesystem::exists(certPath) || std::filesystem::exists(keyPath)) {
        if (!std::filesystem::exists(certPath) || !std::filesystem::exists(keyPath)) {
            throw std::runtime_error("TLS identity is incomplete; reset the server identity");
        }
        return parseIdentity(readText(certPath), unprotectKey(readBinary(keyPath)));
    }
    auto identity = generateIdentity();
    const auto protectedKey = protectKey(identity.privateKeyPem());
    writeAtomic(certPath, identity.certificatePem().data(), identity.certificatePem().size());
    writeAtomic(keyPath, protectedKey.data(), protectedKey.size());
    return identity;
}

void TlsIdentity::reset(const std::filesystem::path& storageDirectory) {
    std::error_code ec;
    std::filesystem::remove(storageDirectory / "server-cert.pem", ec);
    ec.clear();
    std::filesystem::remove(storageDirectory / "server-key.dpapi", ec);
}
