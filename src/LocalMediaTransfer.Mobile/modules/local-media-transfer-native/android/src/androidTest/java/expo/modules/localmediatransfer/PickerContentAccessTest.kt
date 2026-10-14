package expo.modules.localmediatransfer

import android.content.Intent
import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PickerContentAccessTest {
  @Test fun pickerReferenceCanBeDescribedReadAndClosed() {
    val context = InstrumentationRegistry.getInstrumentation().context
    val uri = Uri.parse("content://expo.modules.localmediatransfer.fixture/media")
    assertEquals(listOf(uri), AndroidSystemPicker.selectedUris(Intent().setData(uri)))
    val details = AndroidMediaAccess(context).describe(uri)
    assertEquals("fixture.jpg", details?.get("filename"))
    assertEquals(4L, details?.get("sizeBytes"))
    val stream = requireNotNull(context.contentResolver.openInputStream(uri))
    assertEquals(listOf(1, 2, 3, 4), stream.readBytes().map { it.toInt() })
    stream.close()
    val closed = runCatching { stream.read() }.isFailure
    assertTrue(closed)
  }
}
