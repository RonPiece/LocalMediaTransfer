package expo.modules.localmediatransfer

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import java.io.File

class FixtureMediaProvider : ContentProvider() {
  private lateinit var fixture: File

  override fun onCreate(): Boolean {
    fixture = File(requireNotNull(context).cacheDir, "lmt-picker-fixture.bin")
    fixture.writeBytes(byteArrayOf(1, 2, 3, 4))
    return true
  }

  override fun getType(uri: Uri): String = "image/jpeg"

  override fun query(uri: Uri, projection: Array<out String>?, selection: String?,
    selectionArgs: Array<out String>?, sortOrder: String?): Cursor {
    val columns = projection ?: arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)
    return MatrixCursor(columns).apply {
      addRow(columns.map { if (it == OpenableColumns.DISPLAY_NAME) "fixture.jpg" else fixture.length() })
    }
  }

  override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor =
    ParcelFileDescriptor.open(fixture, ParcelFileDescriptor.MODE_READ_ONLY)

  override fun insert(uri: Uri, values: ContentValues?): Uri? = null
  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0
  override fun update(uri: Uri, values: ContentValues?, selection: String?,
    selectionArgs: Array<out String>?): Int = 0
}
