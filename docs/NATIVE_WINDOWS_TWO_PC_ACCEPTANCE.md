# Native Windows two-PC acceptance

## Purpose and safety boundary

This is the focused physical acceptance procedure for native Windows transfer
v1. It covers private-LAN discovery, first-pair security-code confirmation,
receiver approval, the 1,000-file protocol boundary, sender cancellation,
receiver restart/grant invalidation, and post-restart recovery.

The runner is deliberately opt-in and interactive. It does not run from
`scripts/verify.ps1 -Target all`. Supplying `--confirm-two-pc` confirms that the
operator understands that generated files will be written to the receiver's
configured upload folder. Use two computers that you control on a trusted
private network.

The runner reuses production security code:

- discovery packets remain credential-free and bounded to 1,024 private IPv4
  destinations;
- manual entry accepts only private/local IPv4 addresses;
- first pairing uses the isolated certificate-capture client, independently
  computed code, confirmation HMAC, and explicit receiver approval;
- all later requests use the exact certificate pin;
- the trusted credential can request approval but cannot upload;
- every test transfer requires a new exact-manifest grant;
- restart and cancellation never fall back to a browser or iOS session token.

Do not publish raw `server.log` files. They can contain normal operational
details unrelated to this runner. The receiver monitor copies only allow-listed
native lifecycle events and numeric file/byte counts into its report. Sender
reports likewise contain stage outcomes and stable error codes only. Neither
report contains addresses, computer/device names, credentials, security codes,
certificate fingerprints, request or transfer IDs, filenames, paths, or
manifests.

## Preparation on both PCs

1. Build or install the same commit on both computers. Keep both applications
   in the same environment (`production` with `production`, or `test` with
   `test`). Prefer the TEST build during development because it has visibly
   distinct storage, ports, mutex, and pipe identities.
2. Connect both PCs to the same private Wi-Fi or Ethernet LAN. Disable neither
   TLS verification nor Windows Firewall. Record whether a VPN is active.
3. On the receiver, open the WinUI **Receive** page, start its server, and enable
   **Nearby desktop discovery** if the discovery case will be exercised.
4. Open two repository-root terminals, one on each PC. The receiver diagnostic
   terminal should remain open through the server restart.
5. Decide where to keep the ignored JSON reports. The default is
   `artifacts/native-windows-acceptance/` under each clone.

Build and unit-check the runner on either PC before the physical run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\test_csharp.ps1
dotnet build .\tools\LocalMediaTransfer.NativeWindowsAcceptance\LocalMediaTransfer.NativeWindowsAcceptance.csproj -c Release
```

These commands compile and test the runner. They do not perform network access
or write receiver files.

## Exact receiver command

Run this from the repository root on the receiving PC before starting the
sender:

```powershell
dotnet run --project .\tools\LocalMediaTransfer.NativeWindowsAcceptance\LocalMediaTransfer.NativeWindowsAcceptance.csproj `
  -c Release -- `
  --role receiver `
  --environment production `
  --duration-minutes 60 `
  --confirm-two-pc
```

For TEST builds, replace `production` with `test`. If the server uses a
non-default data root, pass the exact local log file with
`--receiver-log <path-to-server.log>`. The monitor begins at the current end of
the log, observes only new diagnostic events, tolerates the expected server-log
reopen/restart, and stops after the duration or Ctrl+C.

## Exact sender command

Run this from the repository root on the sending PC:

```powershell
dotnet run --project .\tools\LocalMediaTransfer.NativeWindowsAcceptance\LocalMediaTransfer.NativeWindowsAcceptance.csproj `
  -c Release -- `
  --role sender `
  --environment production `
  --large-file-mib 512 `
  --cancel-after-mib 16 `
  --restart-after-mib 16 `
  --confirm-two-pc
```

Use `--environment test` for TEST builds. To test the manual-address fallback
instead of UDP selection, add the receiver's private address, for example:

```powershell
--manual 192.168.1.20:8443
```

Manual entry still performs first pairing and certificate verification. It is
not an identity or approval bypass.

## Interactive sequence and expected results

1. **Discovery**: select the receiver shown with its source IP and native-v1
   capability. For a manual run, the identity probe must succeed. A browser-only
   receiver is a failure for this native procedure.
2. **Pairing code**: when prompted by the sender, open the receiver's two-minute
   **Pair a Windows computer** window. Compare both displays. Type `MATCH` on
   the sender only when every digit agrees, then approve on the receiver. The
   sender creates an ephemeral acceptance identity and does not persist its
   credential to disk.
3. **1,000 files**: approve the request showing exactly 1,000 files. The sender
   creates 1,000 unique 1 KiB files beneath
   `%TEMP%\LocalMediaTransfer.Tests\<guid>`, sends all of them, and requires all
   1,000 to finish as newly completed files. A skip, failure, or cancellation
   fails this stage.
4. **Cancellation**: approve the generated large-file request. The runner
   cancels after at least the configured acknowledged-byte threshold and calls
   authenticated receiver cleanup. The sender stage must finish as Cancelled;
   the receiver diagnostics should observe `transfer_cancelled`.
5. **Receiver restart**: approve the next generated large-file request. At the
   threshold, the sender pauses and instructs the receiver operator to use the
   GUI's **Restart Server** command. Wait until the receiver is ready, then
   press Enter on the sender. The old grant must not complete the transfer.
   The receiver report must observe another `receiver_server_started` event.
6. **Recovery**: approve the final small transfer. The existing pinned receiver
   identity and trusted credential should reconnect, but the upload must use a
   newly approved grant. The one-file recovery transfer must complete.

The runner prints an eight-character cleanup label. After both reports are
saved:

- open the receiver upload folder and remove only generated files beginning
  `LMT-Acceptance-<label>-`;
- confirm there is no partial cancellation/restart file left behind;
- revoke the trusted device named `LMT acceptance <label>` from the receiver's
  Security page;
- stop the receiver monitor with Ctrl+C if it is still running;
- retain the two sanitized JSON reports with the test record, not in Git.

The sender deletes only its own validated temporary directory. It never deletes
from the receiver. `--keep-source-files` is available for investigation and
prints the retained sender path.

## Failure interpretation

| Observation | Classification / next check |
|---|---|
| No receiver discovered | Check discovery consent, private profile firewall rule, VPN, guest isolation, and same environment; repeat with `--manual`. |
| Manual address rejected | Use a private IPv4 literal and the environment's HTTPS port; public addresses and DNS names are intentionally rejected. |
| Pairing window closed/expired | Reopen it and start a new run; do not reuse the candidate code or credential. |
| Codes differ | Do not type `MATCH`; deny the receiver request and investigate identity/address selection. |
| Pairing or transfer denied | Expected only when intentionally testing denial; a normal acceptance run stops and reports the stable error. |
| 1,000-file mixed result | Inspect receiver free space, filename policy, and sanitized reports; do not treat partial completion as a boundary pass. |
| Cancellation completes before threshold | Increase `--large-file-mib` or reduce the threshold while keeping it at least 8 MiB. |
| Old transfer completes after restart | Security failure: preserve sanitized reports and investigate grant lifetime/server ownership before release. |
| Restart recovery reports TLS identity failure | The receiver identity changed. There is no bypass; forget and pair again only after confirming the reset was intended. |

## Verification boundary

Passing this runner proves only the exercised topology, build, network, and
operator sequence. Repeat separately on private Wi-Fi and Ethernet where those
claims matter. It does not automatically prove installer firewall rule
creation, guest-network isolation, VPN combinations, sleep/resume, sustained
throughput, simultaneous bidirectional sending, tray notifications, Windows
high contrast/Narrator, iOS behavior, or browser compatibility. Record every
unexercised item as a verification limit.
