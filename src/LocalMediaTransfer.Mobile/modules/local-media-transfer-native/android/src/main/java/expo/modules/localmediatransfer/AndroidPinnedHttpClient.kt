package expo.modules.localmediatransfer

import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

/** Keeps the configured desktop certificate pin and connection setup together. */
internal class AndroidPinnedHttpClient {
  @Volatile private var secureOrigin: String? = null
  @Volatile private var fingerprint: ByteArray? = null
  @Volatile var certificateVerified = false
    private set
  // HttpsURLConnection does not provide a stable protocol reading for this bridge.
  val tlsVersion: String? get() = null

  fun configure(options: Map<String, String>) {
    val origin = URL(options["baseUrl"] ?: "")
    val hex = (options["fingerprint"] ?: "").replace(":", "").lowercase()
    require(origin.protocol == "https" && origin.host.isNotBlank() && hex.matches(Regex("[0-9a-f]{64}")))
    secureOrigin = "https://${origin.host.lowercase()}:${if (origin.port > 0) origin.port else 443}"
    fingerprint = hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    certificateVerified = false
  }

  fun clear() {
    secureOrigin = null
    fingerprint = null
    certificateVerified = false
  }

  fun open(url: URL): HttpURLConnection {
    val origin = "${url.protocol.lowercase()}://${url.host.lowercase()}:${if (url.port > 0) url.port else 443}"
    val expected = secureOrigin
    if (url.protocol == "https") require(expected != null && origin == expected && fingerprint != null)
    val connection = url.openConnection() as HttpURLConnection
    connection.connectTimeout = 15000
    connection.readTimeout = 30000
    connection.instanceFollowRedirects = false
    if (connection is HttpsURLConnection) {
      val pin = fingerprint ?: error("No certificate pin")
      val manager = object : X509TrustManager {
        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
        override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) = Unit
        override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
          if (chain.isEmpty()) throw CertificateException("Desktop certificate is missing")
          val actual = MessageDigest.getInstance("SHA-256").digest(chain[0].encoded)
          if (!MessageDigest.isEqual(actual, pin)) throw CertificateException("Wrong desktop certificate")
          chain[0].checkValidity()
          certificateVerified = true
        }
      }
      val context = SSLContext.getInstance("TLS")
      context.init(null, arrayOf<TrustManager>(manager), SecureRandom())
      connection.sslSocketFactory = context.socketFactory
      connection.hostnameVerifier = javax.net.ssl.HostnameVerifier { hostname, _ -> hostname.equals(url.host, true) }
    }
    return connection
  }
}
