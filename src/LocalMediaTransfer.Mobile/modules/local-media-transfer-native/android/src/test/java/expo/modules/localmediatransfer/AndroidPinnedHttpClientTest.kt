package expo.modules.localmediatransfer

import java.net.URL
import org.junit.Assert.assertThrows
import org.junit.Test

class AndroidPinnedHttpClientTest {
  @Test fun refusesHttpAndMalformedPins() {
    val client = AndroidPinnedHttpClient()
    assertThrows(IllegalArgumentException::class.java) {
      client.configure(mapOf("baseUrl" to "http://localhost:8443", "fingerprint" to "ab".repeat(32)))
    }
    assertThrows(IllegalArgumentException::class.java) {
      client.configure(mapOf("baseUrl" to "https://localhost:8443", "fingerprint" to "wrong"))
    }
  }

  @Test fun refusesAnUnconfiguredHttpsOrigin() {
    val client = AndroidPinnedHttpClient()
    assertThrows(IllegalArgumentException::class.java) { client.open(URL("https://localhost:8443")) }
    client.configure(mapOf("baseUrl" to "https://localhost:8443", "fingerprint" to "ab".repeat(32)))
    assertThrows(IllegalArgumentException::class.java) { client.open(URL("https://localhost:8444")) }
  }
}
