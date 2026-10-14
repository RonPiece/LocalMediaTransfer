package expo.modules.localmediatransfer

import android.content.ContentResolver
import android.net.Uri
import android.os.Debug
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLPeerUnverifiedException
import org.json.JSONObject

internal class AndroidUploadService(
  private val resolver: ContentResolver,
  private val mediaAccess: AndroidMediaAccess,
  private val transferSessions: AndroidTransferSessions,
  private val open: (URL) -> HttpURLConnection,
  private val progress: (Map<String, Any>) -> Unit,
) {
  fun upload(options: Map<String, Any?>): Map<String, Any> {
    val uri = options["uri"] as? String ?: error("Missing URI")
    val session = options["sessionRef"] as? String ?: error("Missing transfer session")
    val endpoint = URL(options["endpoint"] as? String ?: error("Missing endpoint"))
    val fileId = options["fileId"] as? String ?: error("Missing file ID")
    val name = options["transferFilename"] as? String ?: error("Missing filename")
    require(transferSessions.owns(session, uri)) { "Selected content is not owned by this transfer" }
    require(!transferSessions.isCancelled(session))
    val resolver = resolver
    val size = (mediaAccess.describe(Uri.parse(uri))?.get("sizeBytes") as? Long) ?: error("Content unavailable")
    require(size > 0)
    val chunkSize = ((options["chunkSize"] as? Number)?.toInt() ?: 8 * 1024 * 1024).coerceIn(1, 8 * 1024 * 1024)
    val chunks = ((size + chunkSize - 1) / chunkSize).toInt()
    require(chunks in 1..10000)
    var sent = 0L
    var requestMs = 0L
    var readMs = 0L
    var serverWriteMs = 0.0
    var serverFinalizeMs = 0.0
    var retryCount = 0
    var peakMemoryBytes = 0L
    var finalBody = ""
    resolver.openInputStream(Uri.parse(uri))?.use { input ->
      val buffer = ByteArray(chunkSize)
      for (index in 0 until chunks) {
        check(!transferSessions.isCancelled(session))
        val readStarted = System.nanoTime()
        val required = minOf(chunkSize.toLong(), size - sent).toInt()
        var count = 0
        while (count < required) {
          val next = input.read(buffer, count, required - count)
          if (next <= 0) error("Selected file changed during upload")
          count += next
        }
        if (index == chunks - 1) check(input.read() == -1) { "Selected file changed during upload" }
        readMs += elapsed(readStarted)
        for (attempt in 0..2) {
          check(!transferSessions.isCancelled(session))
          val requestStarted = System.nanoTime()
          val connection = open(endpoint)
          try {
            transferSessions.register(session, connection)
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.setFixedLengthStreamingMode(count)
            connection.setRequestProperty("Content-Type", "application/octet-stream")
            connection.setRequestProperty("X-File-Id", fileId)
            connection.setRequestProperty("X-Filename", java.net.URLEncoder.encode(name, "UTF-8").replace("+", "%20"))
            connection.setRequestProperty("X-Chunk-Index", index.toString())
            connection.setRequestProperty("X-Total-Chunks", chunks.toString())
            connection.setRequestProperty("X-File-Size", size.toString())
            connection.setRequestProperty("X-Skip-Duplicates", (options["skipDuplicates"] == true).toString())
            (options["token"] as? String)?.takeIf { it.isNotEmpty() }?.let { connection.setRequestProperty("X-Upload-Token", it) }
            connection.outputStream.use { it.write(buffer, 0, count) }
            val status = connection.responseCode
            if (UploadProtocol.isRetryableStatus(status)) throw IOException("Temporary receiver response: $status")
            if (status !in 200..299) return mapOf("status" to "failed", "errorCode" to if (status == 401 || status == 403) "unauthorized" else "server-rejected",
              "httpStatus" to status, "bytesSent" to sent, "transferFilename" to name)
            val body = connection.inputStream.bufferedReader().use { it.readText() }
            val acknowledgement = JSONObject(body)
            check(UploadProtocol.validAcknowledgement(
              acknowledgement.optBoolean("success"), acknowledgement.optInt("chunkIndex", -1),
              acknowledgement.optInt("totalChunks", -1), index, chunks,
              acknowledgement.optBoolean("complete"), acknowledgement.optString("filename"),
            )) { "Receiver returned an invalid chunk acknowledgement" }
            finalBody = body
            serverWriteMs += acknowledgement.optDouble("serverWriteDurationMs", 0.0)
            serverFinalizeMs += acknowledgement.optDouble("serverFinalizeDurationMs", 0.0)
            peakMemoryBytes = maxOf(peakMemoryBytes, Debug.getPss().toLong() * 1024L)
            break
          } catch (error: IOException) {
            if (transferSessions.isCancelled(session) || attempt == 2 || error is SSLHandshakeException || error is SSLPeerUnverifiedException) throw error
            retryCount += 1
            Thread.sleep(500L * (attempt + 1))
          } finally {
            transferSessions.unregister(connection)
            connection.disconnect()
            requestMs += elapsed(requestStarted)
          }
        }
        sent += count
        progress(mapOf("fileId" to fileId, "bytesSent" to sent, "totalBytes" to size))
      }
    } ?: error("Selected content unavailable")
    val response = JSONObject(finalBody)
    check(response.optBoolean("complete") && response.optString("filename").isNotBlank()) {
      "Receiver did not confirm a completed file"
    }
    return mapOf("status" to "success", "bytesSent" to sent, "skipped" to response.optBoolean("skipped"),
      "chunkCount" to chunks, "chunkSizeBytes" to chunkSize, "fileReadDurationMs" to readMs,
      "httpRequestDurationMs" to requestMs, "interChunkGapDurationMs" to 0,
      "retryCount" to retryCount, "peakResidentMemoryBytes" to peakMemoryBytes,
      "serverWriteDurationMs" to serverWriteMs,
      "serverFinalizeDurationMs" to serverFinalizeMs,
      "transferFilename" to name, "savedFilename" to response.optString("filename", name))
  }

  private fun elapsed(start: Long) = (System.nanoTime() - start) / 1_000_000
}
