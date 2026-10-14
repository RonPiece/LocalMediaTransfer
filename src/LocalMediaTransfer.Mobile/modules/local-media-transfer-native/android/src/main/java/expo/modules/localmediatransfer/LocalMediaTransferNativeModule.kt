package expo.modules.localmediatransfer

import android.app.Activity
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import javax.net.ssl.HttpsURLConnection

/** Android's native bridge keeps picker grants, TLS pinning and content I/O outside JS. */
class LocalMediaTransferNativeModule : Module() {
  private val mediaAccess get() = AndroidMediaAccess(appContext.reactContext ?: error("Content resolver unavailable"))
  private var pickerPromise: Promise? = null
  private val http = AndroidPinnedHttpClient()
  private val controlRequests = ConcurrentHashMap<String, HttpURLConnection>()
  private val preparedRequests = ConcurrentHashMap.newKeySet<String>()
  private val transferSessions = AndroidTransferSessions()

  override fun definition() = ModuleDefinition {
    Name("LocalMediaTransferNative")
    Events("onUploadProgress", "onThermalStateChanged", "onPreparationProgress")

    Function("getInstalledEnvironment") {
      when (appContext.reactContext?.packageName) {
        "com.ronthedev.localmediatransfer.test" -> "test"
        "com.ronthedev.localmediatransfer" -> "production"
        else -> error("Unrecognized installed app identity")
      }
    }

    OnDestroy {
      pickerPromise?.reject("PICKER_CLOSED", "The media picker was closed", null)
      pickerPromise = null
      controlRequests.values.forEach { it.disconnect() }
      transferSessions.clear()
      http.clear()
      controlRequests.clear()
      preparedRequests.clear()
    }

    AsyncFunction("pickMedia") { promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null || pickerPromise != null) {
        promise.reject("PICKER_UNAVAILABLE", "The media picker is already open or the activity is unavailable", null)
      } else {
        pickerPromise = promise
        activity.runOnUiThread {
          try {
            activity.startActivityForResult(AndroidSystemPicker.intent(), AndroidSystemPicker.requestCode)
          } catch (error: Exception) {
            pickerPromise?.reject("PICKER_FAILED", error.message, error)
            pickerPromise = null
          }
        }
      }
    }

    OnActivityResult { _, result ->
      if (result.requestCode == AndroidSystemPicker.requestCode) {
        val pending = pickerPromise
        pickerPromise = null
        if (result.resultCode != Activity.RESULT_OK) {
          pending?.resolve(emptyList<Map<String, Any>>())
        } else {
          val uris = AndroidSystemPicker.selectedUris(result.data)
          Thread {
            val selected = uris.mapNotNull { uri ->
              mediaAccess.describe(uri)?.toMutableMap()?.apply {
                if (this["type"] == "video") mediaAccess.videoThumbnail(uri)?.let { this["thumbnailUri"] = it }
              }
            }
            pending?.resolve(selected)
          }.start()
        }
      }
    }

    AsyncFunction("configureSecureConnection") { options: Map<String, String> ->
      http.configure(options)
    }
    Function("clearSecureConnection") {
      http.clear()
      controlRequests.values.forEach { it.disconnect() }
      controlRequests.clear()
      transferSessions.disconnectAll()
      preparedRequests.clear()
    }
    Function("prepareRequest") { id: String ->
      require(id.isNotBlank() && id.length <= 100 && controlRequests.size < 128)
      require(preparedRequests.add(id))
    }
    Function("cancelRequest") { id: String ->
      synchronized(controlRequests) {
        preparedRequests.remove(id)
        controlRequests.remove(id)?.disconnect()
      }
    }
    AsyncFunction("request") { options: Map<String, Any?> ->
      val id = options["requestId"] as? String ?: error("Missing request ID")
      require(preparedRequests.contains(id))
      try {
        val url = URL(options["url"] as? String ?: error("Missing URL"))
        val connection = http.open(url)
        // Register atomically with cancellation so an early AbortSignal cannot
        // leave a newly opened connection running without its owner.
        synchronized(controlRequests) {
          if (!preparedRequests.contains(id)) {
            connection.disconnect()
            error("Request cancelled")
          }
          controlRequests[id] = connection
        }
        connection.requestMethod = options["method"] as? String ?: "GET"
        @Suppress("UNCHECKED_CAST")
        (options["headers"] as? Map<String, String>).orEmpty().forEach { (key, value) -> connection.setRequestProperty(key, value) }
        (options["body"] as? String)?.let { body ->
          connection.doOutput = true
          connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        }
        val status = connection.responseCode
        val body = (if (status < 400) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
        mapOf("status" to status, "body" to body,
          "headers" to connection.headerFields.filterKeys { it != null }
            .mapKeys { it.key!! }.mapValues { it.value.joinToString(",") },
          "certificateVerified" to (connection is HttpsURLConnection && http.certificateVerified),
          "tlsVersion" to (http.tlsVersion ?: ""))
      } finally {
        controlRequests.remove(id)?.disconnect()
        preparedRequests.remove(id)
      }
    }
    AsyncFunction("securityState") { mapOf("certificateVerified" to http.certificateVerified, "tlsVersion" to (http.tlsVersion ?: "")) }

    AsyncFunction("resolveAssetFilenames") { requests: List<Map<String, Any?>> ->
      requests.map { request ->
        val uri = Uri.parse(request["uri"] as? String ?: "")
        val filename = mediaAccess.describe(uri)?.get("filename") as? String ?: request["fallbackFilename"] as? String ?: ""
        mapOf("assetId" to (request["assetId"] ?: ""), "status" to "resolved",
          "filename" to filename, "source" to "android-provider")
      }
    }
    AsyncFunction("beginTransfer") { session: String -> transferSessions.begin(session) }
    AsyncFunction("prepareAssetWindow") { session: String, requests: List<Map<String, Any?>>, _: Map<String, Any?> ->
      require(requests.size <= 250 && transferSessions.exists(session))
      var lastProgressAt = 0L
      requests.mapIndexed { index, request ->
        val ref = (request["fileRef"] as Number).toInt()
        val value = request["nativeReference"] as? String ?: request["assetId"] as? String ?: ""
        val uri = Uri.parse(value)
        val description = if (value.startsWith("content://") && !transferSessions.isCancelled(session)) mediaAccess.describe(uri) else null
        val size = (description?.get("sizeBytes") as? Long) ?: 0L
        val now = System.nanoTime() / 1_000_000
        if (index == 0 || index + 1 == requests.size || now - lastProgressAt >= 100) {
          sendEvent("onPreparationProgress", mapOf("sessionRef" to session,
            "completedAssets" to index + 1, "totalAssets" to requests.size))
          lastProgressAt = now
        }
        if (description == null || size <= 0) {
          mapOf("fileRef" to ref, "assetId" to value, "variantId" to "$session-$ref",
            "mediaRole" to "android-selected", "componentSemantics" to "primary",
            "originalFilename" to "", "status" to "failed", "stage" to "metadata",
            "errorCode" to if (transferSessions.isCancelled(session)) "cancelled" else "file-size-unavailable")
        } else {
          transferSessions.own(session, value)
          mapOf("fileRef" to ref, "assetId" to value, "variantId" to "$session-$ref",
            "mediaRole" to "android-selected", "componentSemantics" to "primary",
            "originalFilename" to description.getValue("filename"), "status" to "ready",
            "localUri" to value, "sizeBytes" to size,
            "transferFilename" to description.getValue("filename"),
            "contentType" to (description["contentType"] ?: "application/octet-stream"),
            "temporary" to false, "materializationPath" to "android-content-uri",
            "materializationDurationMs" to 0, "temporaryBytesWritten" to 0)
        }
      }
    }
    AsyncFunction("hashPreparedFiles") { session: String, requests: List<Map<String, Any?>> ->
      requests.map { request ->
        val uri = request["localUri"] as? String ?: ""
        val variant = request["variantId"] as? String ?: ""
        val expected = (request["expectedSizeBytes"] as? Number)?.toLong() ?: -1L
        val started = System.nanoTime()
        var bytes = 0L
        try {
          require(transferSessions.owns(session, uri) && !transferSessions.isCancelled(session))
          val digest = MessageDigest.getInstance("SHA-256")
          appContext.reactContext?.contentResolver?.openInputStream(Uri.parse(uri))?.use { input ->
            val block = ByteArray(1024 * 1024)
            while (true) {
              val count = input.read(block)
              if (count < 0) break
              digest.update(block, 0, count)
              bytes += count
              check(!transferSessions.isCancelled(session))
            }
          } ?: error("Content unavailable")
          check(bytes == expected)
          mapOf("variantId" to variant, "status" to "success", "sha256" to digest.digest().toHex(),
            "bytesRead" to bytes, "durationMs" to elapsed(started), "cacheHit" to false)
        } catch (_: Exception) {
          mapOf("variantId" to variant, "status" to "failed", "errorCode" to "file-read-failed",
            "bytesRead" to bytes, "durationMs" to elapsed(started), "cacheHit" to false)
        }
      }
    }
    AsyncFunction("releasePreparedFile") { session: String, uri: String ->
      if (transferSessions.release(session, uri))
        mapOf("materializationPath" to "android-content-uri", "temporaryBytesWritten" to 0, "temporaryLifetimeMs" to 0)
      else null
    }
    AsyncFunction("endTransfer") { session: String -> transferSessions.end(session) }
    AsyncFunction("getThermalState") {
      val manager = appContext.reactContext?.getSystemService(android.content.Context.POWER_SERVICE) as? PowerManager
      if (Build.VERSION.SDK_INT < 29 || manager == null) "unknown"
      else when (manager.currentThermalStatus) {
        PowerManager.THERMAL_STATUS_NONE -> "nominal"
        PowerManager.THERMAL_STATUS_LIGHT -> "fair"
        PowerManager.THERMAL_STATUS_MODERATE -> "serious"
        else -> "critical"
      }
    }
    Function("cancel") {
      session: String ->
      transferSessions.cancel(session)
    }
    AsyncFunction("uploadFile") { options: Map<String, Any?> ->
      val resolver = appContext.reactContext?.contentResolver ?: error("Content resolver unavailable")
      AndroidUploadService(resolver, mediaAccess, transferSessions, http::open) {
        sendEvent("onUploadProgress", it)
      }.upload(options)
    }
    AsyncFunction("discover") { timeout: Int, port: Int, environment: String -> AndroidDiscoveryService.discover(timeout, port, environment) }
  }

  private fun elapsed(start: Long) = (System.nanoTime() - start) / 1_000_000
  private fun ByteArray.toHex() = joinToString("") { "%02x".format(it) }
}
