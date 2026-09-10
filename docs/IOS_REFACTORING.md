# iOS maintainability plan

Preserve observable transfer, pairing, privacy and cancellation behavior while
separating responsibilities. Existing passing tests are the baseline; add
behavioral coverage for newly isolated boundaries. No dependency upgrades.

1. Extract a narrow retry executor, transport authorization predicate, typed
   native event adapter and shared media pagination. Preserve response parsing,
   unauthorized notifications, bounded retries and request cancellation.
2. Separate diagnostic types, pure aggregation, sanitized persistence and
   per-transfer orchestration. Preserve the existing DiagnosticStore import
   facade and retention/redaction tests.
3. Encapsulate cohesive transfer accounting (worker activity, rates and terminal
   outcomes) behind operations and snapshots, rather than a generic object of
   public mutable fields. Keep pipeline ownership in UploadManager.
4. Extract pairing handshake steps and transfer UI timing/state responsibilities.
   Keep failure cleanup and lifecycle ownership explicit. Preserve newest-first
   recent results and the existing 60-item bound.
5. Group navigator inputs by domain while retaining explicit screen dependencies.
   Introduce React Context only if a concrete ownership or rendering benefit is
   demonstrated; the current shallow forwarding does not require it.
6. Run `scripts/verify.ps1 -Target ios-tests` (Jest, TypeScript, ESLint and Expo
   compatibility), plus repository validation. Record exact outcomes locally.

Native actors, URLSession async APIs and Network.framework remain a separately
evaluated modernization option. The current task does not replace working
native cancellation or synchronous reservation-before-write contracts merely
to adopt a newer API. Any future migration needs an owned-task cancellation
design, bounded discovery with the existing version-2 JSON protocol, macOS
compilation and physical PhotoKit/network acceptance.

Keep runtime validation of unknown JSON and native events. Do not log raw
pairing parse exceptions or replace endpoint parsers with unchecked generic
casts. Windows JavaScript tests do not certify native/device behavior.

## Implemented boundaries

Paths below are relative to `src/LocalMediaTransfer.iOS/src`.

| Responsibility | Owner |
|---|---|
| HTTP error identity and 401 predicate | `api/errors.ts`; ApiClient retains its public error re-export |
| Compatibility chunk retry/timeout/abort ownership | `services/upload/RetryPolicy.ts` |
| Native event validation | `services/nativeEvents.ts`; NativeCapabilities uses Expo's typed event map |
| Media pagination | MediaScanner's shared `forEachMediaPage` traversal |
| Diagnostic schema | `services/diagnostics/DiagnosticTypes.ts` |
| Pure diagnostic aggregation | `services/diagnostics/DiagnosticAggregation.ts` |
| Redaction, retention, persistence and export | `services/diagnostics/DiagnosticStorage.ts` |
| Session diagnostic lifecycle | `services/diagnostics/TransferDiagnostics.ts`; existing DiagnosticStore facade preserved |
| Terminal outcomes and worker accounting | `services/upload/TransferAccounting.ts`; mutation occurs through operations |
| Consistent acknowledged byte/rate state | `services/upload/ThroughputTracker.ts` |
| Consent, environment and pin setup | `app/hooks/pairingTransport.ts` |
| Bounded approval and credential activation | `app/hooks/pairingHandshake.ts` |
| UI rate/ETA clock and completion snapshot | `features/transfer/useTransferMetrics.ts` |
| Queue notice dwell/hold/cancellation | `features/transfer/QueueNotice.ts` |
| Explicit navigation inputs | AppNavigator's navigation, connection, preferences and discovery prop groups |

UploadManager continues to own the preparation/upload pipeline and resource
teardown. The remaining local variables describe preparation orchestration;
they are not moved into a generic mutable context solely to shrink the method.
Screen components retain explicit props and there is no new global context.

Three deliberate hardening changes accompany the extractions: invalid native
progress events are ignored, repeated terminal outcomes cannot double-count a
file, and a finished transfer cannot schedule a new queue notice during its
final UI flush. Regression tests exercise those boundaries. The existing
60-item newest-first recent-results behavior remains intact.

The targeted native modernization review found no justification for changing
the socket/locking/cancellation APIs in this refactor. The native acceptance
items in [release acceptance](RELEASE_ACCEPTANCE.md) remain required.
