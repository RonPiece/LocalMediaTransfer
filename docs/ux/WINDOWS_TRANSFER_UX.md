# Windows Transfer UX

## Scope

This specification owns the WinUI Receive and Send pages, pairing approval, destination and
conflict settings, desktop status, history, and recovery. Protocol meaning
remains in [Shared Transfer Behavior](SHARED_TRANSFER_BEHAVIOR.md).

## Receive, Activity, and server state

- Distinguish starting, ready, receiving, stopping, stopped, and conflict/error
  states.
- Show the QR pairing action only when the owned server is ready.
- Keep Receive focused on connection methods and receiver readiness. Show
  current speed, files transferred, bytes transferred, session duration, a
  bounded speed graph, and transfer history on the separate Activity page.
- A server owned by another process is never silently terminated. Recovery
  explains the conflict and requires explicit user approval.
- If the owned server stops unexpectedly, keep the GUI responsive and present a
  restart action with a useful status message.
- Navigation order is Receive, Send, Activity, Network, Security, then About
  and Settings.
- Receive separates **Receive from Windows computers**, **Connect an iPhone**,
  and the secondary **Browser transfer (compatibility)**. Browser options open
  in an anchored flyout and must not resize the Receive page. The complete
  one-time link remains readable/selectable and has a separately named Copy
  action. Opening Receive or the flyout does not create a browser credential;
  the user explicitly creates one when the sending device is ready. The flyout
  shows a five-minute countdown and a browser-specific QR containing the same
  complete link. Creating a replacement invalidates the old link. An iPhone
  pairing QR and a browser URL/QR are never presented under one ambiguous label.

## Native Windows Send

- State progression is consent, searching, receiver selected, pairing or
  connected, file selection, preparation, approval, uploading, and a terminal
  completed/mixed/cancelled/error result.
- Remembered receivers precede discovered receivers. Duplicate names show IP
  address and trust state; names are display labels, not identity.
- Rescan and manual private-IPv4 entry remain available. An older receiver is
  labeled Browser transfer available and native routes are not attempted.
- Multi-file selection accepts ordinary file types, at most 1,000 non-empty
  files, and no directory trees. Skip identical files defaults on.
- First pairing compares the same eight-digit code on both computers. A changed
  certificate blocks the connection and offers only Forget and Pair Again.
- Every transfer approval identifies sender name, source IP, file count, total
  size, and up to five expandable filenames. Incoming pairing/transfer prompts
  are bounded, deduplicated, and queued rather than discarded.
- Sending and receiving maintain separate state and metrics. Minimizing keeps
  active transfers running; exiting during activity requires confirmation.

## Pairing and trust

- QR and manual credentials are treated as temporary passwords and are not
  copied into ordinary logs.
- New-device approval identifies the requesting device without exposing secret
  material.
- Trusted-device revocation and session-token reset explain which devices must
  pair again.
- Nearby discovery is independently opt-in on Windows and iPhone. Enabling it
  explains that discovery itself carries no credential.

## Settings

Windows owns:

- destination folder;
- same-name/different-content policy: keep both or reject;
- HTTP compatibility permission;
- minimize-to-tray behavior;
- its own nearby-discovery consent.

The Windows UI does not offer an exact-duplicate switch. It explains that exact
duplicate behavior is chosen by the sending device.

Changing a server-owned setting that requires restart shows the pending action,
restarts only the process owned by this GUI instance, and reports success or
failure. A failed settings write or server restart must not display the new
state as confirmed.

## Incoming transfer presentation

- Server telemetry is session-scoped and best effort; missing telemetry does
  not imply file failure.
- Show filename collision allocation using the final saved name returned by the
  server.
- Exact duplicates appear as skipped only when the sender requested skipping
  and the server verified full-file content.
- Different content saved under `(2)`, `(3)`, and later suffixes appears as
  uploaded, not skipped.
- Partial sessions show uploaded, skipped, and failed counts separately.

## History

- Transfer history stores session summaries, not media.
- Clearing history never deletes uploaded files.
- History distinguishes completed and mixed outcomes and uses decimal MB/s.
- A history persistence failure does not interrupt an active transfer; the UI
  may explain that the session could not be added to history.

## Errors and recovery

- Authentication errors tell the iPhone to pair again; Windows does not present
  them as disk or network retries.
- Destination permission, disk-space, filename-policy rejection, and server
  process failure use distinct user-facing messages.
- Failed or cancelled upload sessions are cleaned only through authenticated
  session ownership or owned-process shutdown.
- The GUI stops only the exact process instance it launched and verified by
  process ID, creation time, environment, instance ID, authenticated control
  credential, and matching pipe endpoint.
- Optional logging and chart updates never crash named-pipe transport.
- Expected operation failures are handled at their owning boundary and mapped
  to safe user actions. XAML, AppDomain, and unobserved-task observers are a
  diagnostic last resort: they redact secrets and do not routinely suppress a
  fatal exception or continue from potentially inconsistent state.

## Accessibility and layout

- Compact and expanded navigation remain usable at the minimum supported window
  size.
- Security cards in the same row remain top-aligned. Connection history uses a
  bounded vertical viewport with its own scrollbar so a short history does not
  create a large empty card and a long history does not expand the page without
  limit.
- Status uses text and icon in addition to color.
- Buttons remain disabled while their operation is in flight.
- Send actions and progress have accessible names, progress uses terminal-file
  semantics, snapped layouts stack horizontal action groups, and progress does
  not rely on animation or color alone.
- Destructive security or history actions require explicit confirmation and
  state clearly what will and will not be deleted.

## About and open-source information

- About describes user-visible capabilities across the iPhone app, browser
  sender, Windows application, and local transfer service. It does not use an
  implementation-detail checklist as product documentation.
- The application identity card shows the packaged product logo at a compact
  fixed size without changing the logo's aspect ratio.
- Display name and version come from the running build so TEST and production
  remain distinguishable.
- Project links point only to maintained repository resources: source,
  documentation, issues, contribution guidance, private security reporting,
  privacy policy, license, and third-party notices.
- Legal text identifies the Apache License 2.0 and preserves third-party license
  obligations. It does not use "all rights reserved" language that could
  contradict the distributed open-source license.
