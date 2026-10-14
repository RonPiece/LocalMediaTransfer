package expo.modules.localmediatransfer

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UploadProtocolTest {
  @Test fun retryOnlyTransientResponses() {
    listOf(408, 429, 500, 503).forEach { assertTrue(UploadProtocol.isRetryableStatus(it)) }
    listOf(200, 400, 401, 403, 409).forEach { assertFalse(UploadProtocol.isRetryableStatus(it)) }
  }

  @Test fun rejectWrongOrPrematureAcknowledgements() {
    assertTrue(UploadProtocol.validAcknowledgement(true, 0, 2, 0, 2, false, ""))
    assertTrue(UploadProtocol.validAcknowledgement(true, 1, 2, 1, 2, true, "saved.jpg"))
    assertFalse(UploadProtocol.validAcknowledgement(true, 1, 2, 0, 2, false, ""))
    assertFalse(UploadProtocol.validAcknowledgement(false, 0, 2, 0, 2, false, ""))
    assertFalse(UploadProtocol.validAcknowledgement(true, 0, 2, 0, 2, true, "saved.jpg"))
    assertFalse(UploadProtocol.validAcknowledgement(true, 1, 2, 1, 2, false, ""))
  }
}
