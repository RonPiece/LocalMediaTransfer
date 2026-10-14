package expo.modules.localmediatransfer

/** Receiver acknowledgements must refer to the exact chunk sent. */
internal object UploadProtocol {
  fun isRetryableStatus(status: Int) = status == 408 || status == 429 || status in 500..599

  fun validAcknowledgement(
    success: Boolean,
    chunkIndex: Int,
    totalChunks: Int,
    expectedIndex: Int,
    expectedTotal: Int,
    complete: Boolean,
    filename: String,
  ): Boolean = success && chunkIndex == expectedIndex && totalChunks == expectedTotal &&
    if (expectedIndex == expectedTotal - 1) complete && filename.isNotBlank() else !complete
}
