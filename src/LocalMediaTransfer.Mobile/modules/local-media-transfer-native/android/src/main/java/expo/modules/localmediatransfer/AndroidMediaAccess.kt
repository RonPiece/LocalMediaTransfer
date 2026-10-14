package expo.modules.localmediatransfer

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import java.io.ByteArrayOutputStream

internal class AndroidMediaAccess(private val context: Context) {
  fun describe(uri: Uri): Map<String, Any>? {
    return try {
    val resolver = context.contentResolver
    val type = resolver.getType(uri) ?: return null
    if (!type.startsWith("image/") && !type.startsWith("video/")) return null
    var name = "selected-media"
    var size = 0L
    resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
      if (cursor.moveToFirst()) {
        cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME).takeIf { it >= 0 }?.let { name = cursor.getString(it) ?: name }
        cursor.getColumnIndex(OpenableColumns.SIZE).takeIf { it >= 0 }?.let { size = cursor.getLong(it) }
      }
    }
    if (name.contains('/') || name.contains('\\') || name == "." || name == "..") return null
    mapOf("uri" to uri.toString(), "filename" to name, "sizeBytes" to size,
      "contentType" to type, "type" to if (type.startsWith("video/")) "video" else "photo")
    } catch (_: Exception) { null }
  }

  fun videoThumbnail(uri: Uri): String? {
    return try {
    val context = context
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(context, uri)
      val frame = retriever.getFrameAtTime(0) ?: return null
      val scale = minOf(1.0, 160.0 / maxOf(frame.width, frame.height))
      val width = maxOf(1, (frame.width * scale).toInt())
      val height = maxOf(1, (frame.height * scale).toInt())
      val preview = Bitmap.createScaledBitmap(frame, width, height, true)
      if (preview !== frame) frame.recycle()
      val output = ByteArrayOutputStream()
      preview.compress(Bitmap.CompressFormat.JPEG, 65, output)
      preview.recycle()
      val bytes = output.toByteArray()
      if (bytes.size > 64 * 1024) null
      else "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
    } finally { retriever.release() }
    } catch (_: Exception) { null }
  }

}
