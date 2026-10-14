package expo.modules.localmediatransfer

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.MediaStore

/** Uses system selection and never requests a whole-library grant. */
internal object AndroidSystemPicker {
  const val requestCode = 45892
  const val maxItems = 100

  fun intent(): Intent {
    val picker = if (Build.VERSION.SDK_INT >= 33) {
      Intent(MediaStore.ACTION_PICK_IMAGES).apply {
        type = "*/*"
        putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, maxItems)
      }
    } else {
      Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        type = "*/*"
        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        addCategory(Intent.CATEGORY_OPENABLE)
      }
    }
    picker.putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/*", "video/*"))
    return picker
  }

  fun selectedUris(result: Intent?): List<Uri> {
    val uris = linkedSetOf<Uri>()
    result?.data?.let(uris::add)
    result?.clipData?.let { clips ->
      for (index in 0 until minOf(clips.itemCount, maxItems)) uris.add(clips.getItemAt(index).uri)
    }
    return uris.take(maxItems)
  }
}
