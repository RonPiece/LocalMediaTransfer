package expo.modules.localmediatransfer

import java.net.HttpURLConnection
import java.net.URL
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidTransferSessionsTest {
  private class Connection : HttpURLConnection(URL("http://localhost")) {
    var disconnected = false
    override fun connect() = Unit
    override fun usingProxy() = false
    override fun disconnect() { disconnected = true }
  }

  @Test fun cancellationDisconnectsOnlyItsOwnSession() {
    val sessions = AndroidTransferSessions()
    val first = Connection()
    val second = Connection()
    sessions.begin("first")
    sessions.begin("second")
    sessions.own("first", "content://one")
    sessions.own("second", "content://two")
    sessions.register("first", first)
    sessions.register("second", second)
    sessions.cancel("first")
    assertTrue(first.disconnected)
    assertFalse(second.disconnected)
    assertTrue(sessions.isCancelled("first"))
    assertFalse(sessions.isCancelled("second"))
    assertFalse(sessions.owns("first", "content://two"))
  }
}
