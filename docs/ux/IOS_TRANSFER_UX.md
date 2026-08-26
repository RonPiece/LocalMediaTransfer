# iPhone Transfer UX

## Scope

This specification owns iPhone navigation, copy, controls, progress,
accessibility, diagnostics export, and local recovery. Protocol meaning remains
in [Shared Transfer Behavior](SHARED_TRANSFER_BEHAVIOR.md).

## Connection

- Show disconnected, connecting, connected, approval-pending, and
  authentication-expired states distinctly.
- QR scan is the primary first-pairing action. Manual address entry remains
  available.
- Nearby discovery is opt-in. Explain the credential-free local subnet scan
  before saving consent.
- Expo Go explains that QR/manual HTTP and compatibility upload remain
  available, while pinned HTTPS and native transfer require the installed app.
- Authentication expiry tells the user to scan the current Windows QR again; it
  is not presented as a retryable network timeout.

## Selection

- Preserve paged Photos loading and clear selected-count feedback.
- Starting with no selection produces an immediate, specific message.
- An information action is always available near the transfer button.
- At 2,000 selected items or more, show non-blocking guidance:

  `Large transfers may take a while, use more battery, and make your iPhone feel
  warm. Keep it uncovered and out of direct sunlight.`

- Guidance must not claim that the app throttles or pauses while the active
  thermal policy is monitor-only.

## Settings

The iPhone owns:

- `Skip Exact Duplicates`.
- `Include additional media components`, default off. Off transfers the one
  primary/current representation shown in Photos. On additionally prepares
  Live Photo motion, RAW/JPEG companions, and originals of edited media.
- `Transfer while preparing`.
- Its own nearby-discovery consent.

`Prepare first` is the default. The setting explains the tradeoff:

- Off: preparation completes before upload, providing stable totals and ETA.
- On: upload starts sooner while remaining media is prepared; ETA appears only
  after preparation completes.

Settings are namespaced by TEST or production. A persistence failure keeps the
current in-memory choice for the session and must not crash navigation.
Transfer settings are snapshotted when transfer starts; later setting changes
cannot alter the active catalog or duplicate policy.

## Transfer screen

The compact phase disclosure reflects useful user work without turning every
bounded-pipeline transition into a new headline. It distinguishes media
analysis, duplicate checking, and transfer. A full ready queue is expected
backpressure while uploads continue, not slow PhotoKit access and not a normal
top-level phase. Asset analysis, acknowledged bytes, and terminal files remain
separate monotonic metrics.

### Prepare first

- Banner: compact `Preparing media` disclosure.
- Summary: `X of Y media items analyzed`; explanatory copy is hidden until
  requested.
- Transfer progress remains zero while preparation is active.
- Show elapsed time rather than an ETA while the final planned bytes are not
  authoritative.
- Duplicate windows use `Checking for duplicates` with `Finding possible
  matches`, `Checking file contents`, or `Verifying matches on Windows` and
  truthful stage-local counts.
- When preparation and preflight complete, retain the 100% media-analysis ring,
  begin upload, and show terminal-file progress separately.
- Honor prepare-first for every selection size. Do not silently replace an
  explicit off setting with streaming. The setting copy warns that a large
  prepare-first transfer may retain substantial temporary storage.

### Transfer while preparing

- Before the first acknowledged upload, show `Preparing media` or `Checking for
  duplicates` as appropriate.
- After upload starts, keep the top-level headline stable as `Transferring while
  preparing`. Show analyzed media count and acknowledged bytes/current speed as
  simultaneous facts underneath it.
- Duplicate work remains a secondary staged status while the stable streaming
  headline is active.
- Do not expose `Waiting for upload capacity` as a normal phase. If queue
  saturation persists for about one second, show the quiet secondary message
  `Transfer is catching up with prepared files`; hold it briefly on clear to
  avoid flicker. Exact waits remain in diagnostics.
- Show elapsed time while the final transfer size is unknown. Switch the same
  field to remaining-time ETA only after preparation/preflight finish and final
  planned upload bytes are authoritative.

### Progress

- During an active session the ring always represents analyzed Photos assets
  divided by selected Photos assets. It reaches 100% when media analysis is
  complete and is never reused with a new denominator.
- After authoritative expansion, a separate file-transfer bar represents
  terminal files divided by expanded files. This prevents a visible percentage
  reset while still showing upload, skip, and failure completion.
- The subtitle keeps `terminal / selected` readable at normal text size and
  places the `files` or `assets` unit on its own line instead of shrinking the
  complete string to fit.
- Skips and failures advance file-transfer progress.
- Media left and files left use their own denominators.
- Current speed remains separate from ETA.
- ETA must not appear before final planned bytes are known; elapsed time is used
  instead. Once totals are final, ETA may temporarily say `Calculating...` while
  the smoothed rate warms up or becomes stale.
- Recent activity shows a compact one- or two-row preview. Its disclosure opens
  an upward page sheet with a virtualized, scrollable list, requested filename,
  status, and final saved name when Windows allocated a collision suffix.

## Error presentation

- Per-file errors retain a plain-language message and typed internal stage/code.
  The error sheet groups repeated reasons with an exact affected count and
  bounded filename examples instead of repeating the same paragraph thousands
  of times.
- Preparation failures do not block unrelated files.
- Optional-component failures name the failed role (for example Live Photo
  motion, RAW companion, or original rendition) and explicitly leave a
  successful primary component successful.
- A mixed summary shows uploaded, skipped, and failed counts without a fatal
  alert.
- Fatal alerts are limited to authentication/session loss or unrecoverable
  transfer failure.
- Cancellation remains available throughout preparation and upload.
- Cleanup and optional diagnostic/history failures never convert a successfully
  transferred file into a failed file or leave the transfer screen locked.

## Completion

Show one of: completed, mixed, cancelled, or fatal. The summary includes:

- selected, uploaded, skipped, failed;
- selected and transferred bytes;
- selected primary/current media bytes, optional additional-component bytes,
  and total transfer content when additional components are present;
- bandwidth avoided before upload and bytes uploaded before a finalization
  duplicate decision, when nonzero;
- duration;
- average and peak media MB/s;
- access to all results and errors when present.

If preparation fails before a component's size is known, label the discovered
byte total `Prepared`, not `Selected`, and state that unprepared media is
excluded. Never imply that equal prepared/transferred bytes mean the entire
selection succeeded when the file summary is mixed.

## Diagnostics

- Settings lists up to five recent sanitized reports, newest first.
- The user can export one report or all retained reports.
- Export uses the iOS share sheet only after a user action.
- If storage or sharing fails, show a specific unavailable/export error rather
  than claiming the report exists.

## Accessibility and layout

- Controls have descriptive accessibility labels and roles.
- Status is conveyed by text and icon, not color alone.
- Large counts use locale formatting.
- Long filenames truncate visually without changing the transferred value.
- Compact and wide layouts preserve the same state and actions.
