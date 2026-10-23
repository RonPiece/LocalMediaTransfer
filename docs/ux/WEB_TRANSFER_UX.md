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
- Begin with disabled controls and visible initialization status. Verify the session token with Windows before enabling file selection, reset,
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
- Show selected file count and total size before upload. Keep the chooser primary before selection and Upload primary afterward.
- Keep one initially collapsed Files disclosure. Search original and saved names,
  filter All/Failed/Skipped/Uploaded, and page in stable selection order with 100
  files per page. Search is debounced by 150ms. Release rows when collapsed or
  paging; hidden files retain their state independently of the DOM.
- Normalize large additions in short slices; show reading status and disable
  upload until ingestion finishes. Compact the chooser after selection.
- Use local photo/static video thumbnails with a separate outcome label. Archives,
  documents, audio and unsupported media use type icons. Previews are optional,
  visible-only, bounded and paused during transfer work; see
  [ownership and resource limits](WEB_BROWSER_ARCHITECTURE.md).
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
- Current/average/peak follow the mobile acknowledged-byte model. Sending a
  body is distinct from receiving confirmation; show `Waiting for receiver…`
  during that gap. Whole-file responses and successful chunk responses feed
  one rolling tracker. A single publisher updates the aggregate speed.
- Progress never decreases. A retry must not count the same bytes twice.

### Recent activity

- Keep one Recent activity row mounted from the empty selection through results.
  Reset restores its placeholder; completion never removes the row or opens a
  pop-up. Reserve the same row height for short and long status messages.
- Before the first outcome, show one observed file's checking/sending status.
  Afterward retain the latest completed, skipped or failed file until the next
  outcome. Parallel sending callbacks must not rotate that row.
- Show the active-file count separately. This is a recent activity sample, not a
  claim that only one file uploads at a time; concurrency remains unchanged.
- Reuse the local preview cache/type icon independently of the outcome text.
  New decoding remains paused during preparation and uploading.
- View all files opens the existing Files disclosure and clears search/filter
  restrictions. Full saved names and error details remain available there.
- Translate the row and its phase labels in English, Hebrew and Russian. Use
  the existing progress interpolation without an entrance or replacement animation.

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
- Bound authentication waits to ten seconds, preflight requests to thirty seconds, and hashing inactivity to thirty seconds. A recoverable connection failure offers Retry; missing/expired links require a fresh Windows link.
- If required page modules fail to initialize, keep controls locked and offer a clean reload. Language preference storage is optional.
- History submission is best-effort with a five-second deadline. History/cache work cannot delay results, unlock a later run, or change a saved file outcome.
- Optional metrics and event requests also have five-second deadlines. Metrics
  retain one in-flight request and the latest pending sample; terminal zero
  cannot be replaced by a later local sample from the finished run. Event
  requests are serialized and bounded; optional logging may drop excess events.
- Failed hash batches dispose their sibling workers before normal-upload fallback.
  Duplicate recovery clears previous file errors. Authentication loss prevents
  later chunk attempts, including attempts after retry backoff; unattempted files
  are never reported as uploaded in results or history.
- Language requests are bounded, and only the latest language choice can update
  the page. A small lifecycle bootstrap installs resource-error recovery before
  the ordered deferred modules; Retry has a native reload fallback.
- Reset is available only after active workers finish. Reloading or closing the
  page may abandon the browser session but must not delete completed destination
  files.

## Completion

- Report uploaded, skipped, and failed counts separately, using complete, mixed, failed or session-expired wording.
- Offer Retry failed files only for eligible transient failures; retain successful/skipped outcomes and never resend those files.
- Show a final saved name when Windows allocated a numbered collision name.
- Keep a persistent result card with counts, selected size, elapsed time and
  acknowledged average/rolling peak. Do not open an automatic completion dialog.
- Offer `Start another transfer` and a clean reset after the active session is
  terminal. Retry is primary for eligible mixed/failed results. Expired sessions
  retain results and fresh-link guidance without an ineffective retry action.
- Browser-local cleanup removes only selection and transient UI state; it never
  deletes files already saved by Windows.

## Accessibility, layout, and language

- Keep the uploader usable on desktop, tablet, and phone widths.
- Every actionable control has an accessible name and disabled state.
- Progress bars expose numeric ARIA values, and status changes use live text in
  addition to color.
- Preserve English, Hebrew, and Russian translations, including RTL layout for
  Hebrew. Changing language refreshes file navigation and queued/preparation/result
  labels, including files reopened after paging.
- Platform-specific tips may explain browser limitations but must not change
  the shared transfer rules.

## Acceptance evidence

Web behavior changes require the frontend unit suite and real C++ server
integration tests for the affected protocol path. Manually verify drag/drop on
desktop, file selection on a phone or tablet browser, token rejection, an exact
duplicate, a same-name collision, a retryable failure, and mixed completion.

## Browser refinement verification

Use `frontend-tests`, `web-checks`, `web-tests` and the explicit `web-profile` target. See [browser verification](../../tests/browser/README.md). Controlled scenarios and actual HTTPS receiver/integrity checks are separate evidence. Profile selection and layout independently from network throughput.

Motion is functional: 120ms progress interpolation, no infinite shimmer or button sweep, and an interruptible 150ms opacity cue for completion. Existing reduced-motion behavior remains supported. Use readable green action tokens and preserve English, Hebrew RTL and Russian. Physical phone acceptance remains a separate gate.
