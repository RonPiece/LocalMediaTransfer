# Web Transfer UX

## Scope

This specification owns the browser uploader served by the Windows receiver.
It supports sending files from a computer, phone, or tablet browser to the
Windows destination. It is not an iPhone-only compatibility screen and it does
not receive files into the browser.

Protocol meaning remains in [Shared Transfer Behavior](SHARED_TRANSFER_BEHAVIOR.md).

## Access and authentication

- Open the uploader through the secure link or QR code shown by the Windows
  application.
- Verify the session token with Windows before enabling file selection, reset,
  or upload controls.
- A missing, rejected, or expired token locks the uploader and explains that a
  current link or QR code is required.
- Never render the token in page messages or send the token-bearing page URL in
  client telemetry. Authentication belongs only in the request header.
- Losing authentication during an upload stops unsafe continuation and tells
  the user to reopen a current Windows link.

## Selection

- Desktop users can drag files into the upload area or use the file chooser.
- Phone and tablet users use the file chooser exposed by their browser.
- Support general files, not only photos and videos.
- Show selected file count and total size before upload.
- Do not permit drag/drop, file-input, add-more, or reset operations to mutate
  the queue while an upload is active.
- An empty upload action explains how to select files on the current device.

## Duplicate preparation

- Before upload, send authenticated filename-and-size metadata to identify
  possible duplicates.
- Hash only candidate files. Use one hashing worker on mobile devices and at
  most two on desktop-class browsers.
- Show `Checking...`, `Verifying...`, `Ready to upload`, or `Name exists;
  keeping both` per file so hashing is not mistaken for a stalled upload.
- A server-verified exact duplicate is terminal and advances aggregate
  progress without network upload bytes.
- The current browser behavior automatically skips verified exact duplicates;
  it does not expose the iPhone app's duplicate preference.
- Different content with the same name follows the Windows collision policy
  and displays the final saved name returned by the server.

## Upload and progress

- Use the concurrency and chunk configuration reported by the Windows server.
- Upload chunks sequentially within a file. Multiple files may upload in
  parallel within the configured limit.
- Use whole-file upload below the configured threshold and bounded chunked
  upload above it. Browser-specific compatibility rules may reduce concurrency
  for large iOS Safari transfers.
- Show per-file queued, uploading, retrying, skipped, completed, and failed
  states.
- Show aggregate completed bytes, current rolling media throughput, selected
  files, and successful/error totals. Use decimal MB/s consistently.
- Progress never decreases. A retry must not count the same bytes twice.

## Errors and recovery

- Treat duplicate-check, hashing, network, authentication, timeout, and server
  response failures as distinct internal stages.
- Retry only transient chunk/network failures within the bounded retry policy.
  Never retry authentication or explicit filename-policy rejection as a
  transport timeout.
- A failed file remains visible and does not prevent unrelated queued files
  from completing.
- Optional client logging, metrics, or cache cleanup must never turn a
  successful upload into a failed upload.
- If required page modules fail to initialize, show a visible loading error and
  recommend refreshing rather than leaving enabled nonfunctional controls.
- Reset is available only after active workers finish. Reloading or closing the
  page may abandon the browser session but must not delete completed destination
  files.

## Completion

- Report uploaded, skipped, and failed counts separately.
- Show a final saved name when Windows allocated a numbered collision name.
- Offer `Upload More` and a clean reset after the active session is terminal.
- Browser-local cleanup removes only selection and transient UI state; it never
  deletes files already saved by Windows.

## Accessibility, layout, and language

- Keep the uploader usable on desktop, tablet, and phone widths.
- Every actionable control has an accessible name and disabled state.
- Progress bars expose numeric ARIA values, and status changes use live text in
  addition to color.
- Preserve English, Hebrew, and Russian translations, including RTL layout for
  Hebrew.
- Platform-specific tips may explain browser limitations but must not change
  the shared transfer rules.

## Acceptance evidence

Web behavior changes require the frontend unit suite and real C++ server
integration tests for the affected protocol path. Manually verify drag/drop on
desktop, file selection on a phone or tablet browser, token rejection, an exact
duplicate, a same-name collision, a retryable failure, and mixed completion.
