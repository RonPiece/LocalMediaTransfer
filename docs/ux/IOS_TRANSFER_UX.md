# iPhone Transfer UX

## Scope

This specification owns iPhone navigation, copy, controls, progress,
accessibility, diagnostics export, and local recovery. Protocol meaning remains
in [Shared Transfer Behavior](SHARED_TRANSFER_BEHAVIOR.md).

## Navigation

- The persistent main tabs are `Home`, `Transfers`, `Connect`, `History`, and
  `Settings`. Disconnected launches select Connect; a successful connection
  selects Home.
- The Photos picker and QR camera are protected full-screen flows without the
  tab bar.
- During preparation and upload the Transfers tab remains selected and the
  other tabs are disabled with a visible and accessible `Transfer in progress`
  explanation. Cancellation or terminal completion unlocks navigation. A
  completed summary remains on Transfers until Done or another tab clears the
  finished session.
- Home owns receiver/security status, the primary Choose Media action,
  and at most two tappable receiver-history rows. It does not duplicate a
  readiness card because selection and transfer occur in protected flows.
  History and Settings are dedicated screens rather than dashboard modals.
- Appearance follows the operating-system light/dark setting. Semantic
  surfaces, text, separators, controls, progress drawing, sheets, and overlays
  must remain readable in both palettes.
- Main-screen changes use a brief fade and five-point lift. Button presses use
  immediate opacity feedback, with light haptics on the key Connect actions.
  When the operating system's Reduce Motion setting is enabled, screen changes
  become fade-only and capsule press scaling is removed.

## Connection

- Show disconnected, connecting, connected, approval-pending, and
  authentication-expired states distinctly.
- QR scan is the primary first-pairing action. Manual address entry remains
  available.
- Connect presents QR, pairing approval, nearby receivers, manual address, the
  one saved trusted receiver, and Secure & Private information in that order.
- Refresh and Disconnect live in the Nearby Receivers header as compact rounded
  action pills with pressed-state and light haptic feedback. Their 34-point
  visual capsules retain a 44-point effective touch target. The actions stack
  beneath the section label on compact widths or enlarged text instead of
  clipping beyond the screen. Disconnect is disabled while disconnected, and
  alternate pairing actions remain disabled until the current receiver is
  disconnected. Disabled pairing surfaces retain grouped-surface contrast
  instead of fading white text into the background.
- The QR camera remains full bleed, while its close and title controls use the
  physical device's initial top safe-area inset plus spacing. A conservative
  iPhone fallback keeps Close below the status area when modal inset reporting
  starts at zero.
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

`Prepare first` is the default for selections of at most 250 items. Larger
installed-app selections automatically use bounded `Transfer while preparing`
to avoid retaining an unbounded amount of temporary PhotoKit output. The
transfer screen discloses this safety adjustment. The setting explains the
tradeoff:

- Off: preparation completes before upload, providing stable totals and ETA.
- On: upload starts sooner while remaining media is prepared; ETA appears only
  after preparation completes.

Settings are namespaced by TEST or production. A persistence failure keeps the
current in-memory choice for the session and must not crash navigation.
Transfer settings are snapshotted when transfer starts; later setting changes
cannot alter the active catalog or duplicate policy.

## Transfer screen

Every active session keeps two stable grouped rows visible: `Preparing media`
and `Transferring files`. Preparation reports selected-asset analysis,
duplicate-checking stage, completion, or storage-saving streaming. Transfer
reports waiting, active terminal-file count, finalizing, or completion. A full
ready queue is expected backpressure while uploads continue, not slow PhotoKit
access and not a normal top-level phase. Asset analysis, acknowledged bytes,
and terminal files remain separate monotonic metrics.

### Prepare first

- The preparation row shows `X of Y media items analyzed`; the transfer row
  remains visibly waiting until preparation and duplicate preflight finish.
- Transfer progress remains zero while preparation is active.
- Show elapsed time rather than an ETA while the final planned bytes are not
  authoritative.
- Duplicate windows keep the preparation title stable while its status changes
  among `Finding possible matches`, `Checking file contents`, or `Verifying
  matches on Windows`.
- When preparation and preflight complete, reset the ring for the file-transfer
  phase so it cannot display 100% while files are still uploading.
- Honor prepare-first through one 250-item preparation window. Above that bound,
  switch visibly to streaming and release prepared temporary files continuously.

### Transfer while preparing

- Before the first acknowledged upload, the transfer row says it is waiting for
  prepared media.
- After upload starts, the same two fixed-height rows remain in place:
  preparation shows analyzed selected media and its session-wide percentage;
  transfer shows its active state and monotonic terminal-file count.
- Put media left to analyze, acknowledged bytes transferred, and current speed
  together in the stats row. Do not expose a streaming window's `0 of 16`
  duplicate counter or other window-local denominator in the normal UI.
- Duplicate work and queue-capacity transitions remain diagnostic while the
  stable streaming headline is active so they cannot make the layout jump.
- Do not expose `Waiting for upload capacity` as a normal phase. If queue
  saturation persists for about one second, show the quiet secondary message
  `Transfer is catching up with prepared files`; hold it briefly on clear to
  avoid flicker. Exact waits remain in diagnostics.
- Show elapsed time while the final transfer size is unknown. Switch the same
  field to remaining-time ETA only after preparation/preflight finish and final
  planned upload bytes are authoritative.

### Progress

- Before overlapping upload begins, the preparation ring represents analyzed
  Photos assets divided by selected Photos assets. During overlap, the two
  compact phase rows carry preparation and transfer separately.
- After authoritative expansion, the ring resets for the transfer phase and
  represents terminal files divided by expanded transfer entries. Its label and
  unit change with the denominator, so the reset is explicit rather than a false
  100% completion signal. Skips and failures advance transfer progress.
- The file denominator grows monotonically as additional PhotoKit components
  are discovered and can never display below the terminal-file count. When the
  additional-components setting is active, a short note explains that the total
  may grow during preparation.
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
  an upward page sheet with a virtualized, scrollable list, thumbnail when an
  originating Photos asset URI is safely available, requested filename,
  component role, status, and final saved name when Windows allocated a
  collision suffix. Preparing/uploading uses an indeterminate indicator;
  uploaded, duplicate, and failed use green, orange, and red icon-plus-text
  states. No per-file percentage is shown without item-level acknowledged
  bytes.

## Receiver history

- History is receiver-hosted, refreshes on tab focus and post-transfer, and is
  cleared immediately from presentation on disconnect.
- Aggregates cover only returned recent sessions: sessions, uploaded files,
  duplicates skipped, and uploaded bytes.
- Filters are All, Completed, Skipped, and Needs Attention. Mixed, fatal, and
  cancelled outcomes are Needs Attention.
- Rows and details show only returned counts, timestamps, bytes, durations,
  speeds, retry counts, media expansion, and file outcomes. Durations use
  human-readable hours/minutes/seconds. Generic phone/desktop decoration must
  not imply a known device model, PC name, transfer title, or local lifetime
  archive.
- Home's two-row preview uses compact status words such as `Skipped` and
  `Issues` so the transfer title and date remain readable on narrow iPhones;
  full status wording remains in details and accessibility labels.
- Cancellation is recorded as a receiver-history session with explicit
  `cancelled` completion status and the real partial counts known at the time.
  For receiver records created before explicit completion status existed, an
  expanded-file total greater than all terminal outcomes is presented as
  Canceled instead of Completed.
- Clear All is confirmed and explicitly deletes history from the connected
  receiver.

## Error presentation

- Per-file errors retain a plain-language message and typed internal stage/code.
  The error sheet groups repeated reasons with an exact affected count and
  bounded filename examples, offers a virtualized list of every affected full
  filename, and puts incomplete-size and recovery guidance at the top.
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

The completion summary omits the large progress ring and keeps Done fixed above
the tab bar. The metrics remain scrollable, while the exit action and now-
unlocked tabs stay immediately reachable.

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
