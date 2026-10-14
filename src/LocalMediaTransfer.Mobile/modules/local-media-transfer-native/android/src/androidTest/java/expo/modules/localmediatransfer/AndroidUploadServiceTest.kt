package expo.modules.localmediatransfer

import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AndroidUploadServiceTest {
  private val uri = "content://expo.modules.localmediatransfer.fixture/media"

  private class Connection(
    private val status: Int,
    private val response: String = "",
    private val onResponse: () -> Unit = {},
  ) : HttpURLConnection(URL("https://receiver.invalid/upload_chunk_raw")) {
    val body = ByteArrayOutputStream()
    var disconnected = false
    var outputClosed = false

    override fun connect() = Unit
    override fun usingProxy() = false
    override fun disconnect() { disconnected = true }
    override fun getOutputStream() = object : ByteArrayOutputStream() {
      override fun close() {
        body.write(toByteArray())
        outputClosed = true
        super.close()
      }
    }
    override fun getResponseCode(): Int {
      onResponse()
      return status
    }
    override fun getInputStream() = ByteArrayInputStream(response.toByteArray())
  }

  private fun runUpload(
    connections: List<Connection>,
    sessions: AndroidTransferSessions,
  ): Map<String, Any> {
    val context = InstrumentationRegistry.getInstrumentation().context
    val access = AndroidMediaAccess(context)
    assertEquals(4L, access.describe(Uri.parse(uri))?.get("sizeBytes"))
    val pending = ArrayDeque(connections)
    val service = AndroidUploadService(context.contentResolver, access, sessions,
      { pending.removeFirst() }, {})
    return service.upload(mapOf(
      "uri" to uri,
      "sessionRef" to "test-session",
      "endpoint" to "https://receiver.invalid/upload_chunk_raw",
      "fileId" to "test-file",
      "transferFilename" to "fixture.jpg",
      "chunkSize" to 4,
    ))
  }

  private fun ownedSession() = AndroidTransferSessions().apply {
    begin("test-session")
    own("test-session", uri)
  }

  @Test fun transientResponseRetriesTheSameChunkAndClosesConnections() {
    val first = Connection(503)
    val second = Connection(200,
      """{"success":true,"chunkIndex":0,"totalChunks":1,"complete":true,"filename":"fixture.jpg"}""")
    val result = runUpload(listOf(first, second), ownedSession())
    assertEquals("success", result["status"])
    assertEquals(1, result["retryCount"])
    assertEquals(4L, result["bytesSent"])
    assertArrayEquals(byteArrayOf(1, 2, 3, 4), first.body.toByteArray())
    assertArrayEquals(first.body.toByteArray(), second.body.toByteArray())
    assertEquals("0", first.getRequestProperty("X-Chunk-Index"))
    assertEquals(first.getRequestProperty("X-File-Id"), second.getRequestProperty("X-File-Id"))
    assertTrue(first.outputClosed && second.outputClosed && first.disconnected && second.disconnected)
  }

  @Test fun wrongAcknowledgementFailsWithoutRetry() {
    val wrong = Connection(200,
      """{"success":true,"chunkIndex":1,"totalChunks":1,"complete":true,"filename":"fixture.jpg"}""")
    assertThrows(IllegalStateException::class.java) {
      runUpload(listOf(wrong), ownedSession())
    }
    assertTrue(wrong.disconnected && wrong.outputClosed)
  }

  @Test fun interruptedConnectionDoesNotRetryAfterCancellation() {
    val sessions = ownedSession()
    val interrupted = Connection(200, onResponse = {
      sessions.cancel("test-session")
      throw IOException("Connection interrupted")
    })
    assertThrows(IOException::class.java) {
      runUpload(listOf(interrupted), sessions)
    }
    assertTrue(interrupted.disconnected && interrupted.outputClosed)
  }
}
