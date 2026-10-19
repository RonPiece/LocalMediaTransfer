# TEST mobile UI Preview

UI Preview is an on-device developer catalog of the application's real screens
with repeatable sample state. It is available only after the installed app and
JavaScript environment both resolve to TEST. Production bundles exclude the
preview workspace, catalog, fixtures, and sample assets at build time.

## Open it on an iPhone

1. Open the installed TEST development client with Metro running:

   ```powershell
   cd src\LocalMediaTransfer.Mobile
   npm run start:dev-client -- --clear
   ```

2. Open **Settings → UI Preview**. This is the only preview entry, and is
   available before pairing with a Windows receiver.
3. Choose Home, Connect, Media Picker, Transfers, History, or Settings, then a
   named state. iOS has 47 scenarios and Android has 43, including direct access to
   the album, QR layout, connection-security, file-results, history-details,
   and problem-files dialogs.
4. Drag the **Preview controls** handle away from content and tap it to change
   the scenario or appearance. Normal screen controls and tabs interact with
   sample state inside the workspace.
   Controls, screen categories and scenarios have semantic icons. Returning to
   the catalog restores the last category and its scroll position, and marks
   the last scenario with an outline, checkmark and **Last viewed** label.
5. Tap **Exit to normal TEST app** to leave preview and return to Connect.

These changes are TypeScript only. An already compatible TEST development IPA
can load them through Metro and Fast Refresh; Swift and native dependency
changes still require a new IPA. A TEST release IPA includes preview when built
from this source and uses its embedded JavaScript.

## Transfer controls and screenshots

- The controls sheet uses a solid primary Return action and outlined secondary
  actions on a neutral surface. Selected appearance options and catalog tabs
  use a solid primary fill with on-primary text in both themes.
- Named scenarios freeze preparation, duplicate checks, overlapping streaming,
  queue catch-up, upload, completion, errors, duplicates, or cancellation.
- The progress track supports touch scrubbing and VoiceOver increment/decrement
  actions. Terminal scenarios use their complete result snapshot.
- **Play from here** advances the current transfer state. **Replay full
  transfer** runs preparation, checking, streaming, upload, and completion in
  approximately 25 seconds. Backgrounding the app pauses playback.
- **Reset this scenario** restores its initial data and closes local dialogs.
- **Clean screenshot** pauses playback and hides all developer controls for ten
  seconds. The handle returns automatically. A dialog can also be opened
  directly from the catalog, captured, and closed with its normal controls.
- Light/Dark/System choices are held in preview memory and the original app
  appearance is restored on exit. Use the iPhone's real Text Size, VoiceOver,
  and Reduce Motion settings when reviewing those behaviors.

When reporting a visual issue, include the screenshot, scenario name,
appearance, relevant text-size setting, and the desired change. The captured
screen is the same presentation used by the normal app.

## Isolation and limits

Entering preview unmounts the live app controllers. Preview uses in-memory
callbacks and synthetic, embedded media illustrations; it does not pair,
discover receivers, upload, load Photos, mount a camera, persist transfer
history or preferences, or read saved diagnostic reports. File result counts
and byte totals are derived from typed fixtures. Sample history deliberately
has no persisted session identity, so its dialogs cannot load local media.
Problem Files receives synthetic photo/video thumbnails through the TEST
integration, including when opened from sample session details. These images
never enable a real Photos original lookup. Normal iPhone sessions continue to
use their saved local thumbnails, with placeholders for unavailable images.

The iOS media preview supports tapping and Select All; Android uses the real
media-review layout with sample Add and Remove actions. Real drag auto-scroll,
PhotoKit/iCloud export, iOS permission dialogs, actual QR decoding, certificate
pinning, network failures, and throughput require separate native/device
testing. Cancellation opens the existing cancelled-session history details;
the normal live app navigates away from the transfer on cancellation.

## Code map

- `src/LocalMediaTransfer.Mobile/src/dev/preview/scenarios.ts`: catalog and
  deterministic playback stages.
- `src/LocalMediaTransfer.Mobile/src/dev/preview/fixtures.ts`: generated media,
  coherent transfer snapshots, and sample history.
- `PreviewHost.tsx` and `PreviewControls.tsx`: catalog, lifecycle, controls,
  screenshot mode, and temporary appearance.
- `PreviewScene.tsx` and `PreviewMediaPicker.ios.tsx` / `.android.tsx`: in-memory
  screen adapters selected for the target phone.
- `src/dev/preview/UiPreviewContext.tsx`: TEST entry and display overrides.
- `src/integrations/uiPreview`: typed integration contract and production no-op.
- `metro.config.js` and `build-tools/preview-resolver.cjs`: build-time module
  selection and rejection of production imports from the preview directory.
- `AppShell.tsx`: installed TEST identity gate before mounting the workspace.
- `TransferProgressView`, `ConnectionScreenView`, and `MediaPickerView`: shared
  presentations; their normal wrappers retain the real controllers.

Keep future scenarios in typed fixture/adaptor files. Do not add fake progress
branches to the upload algorithm or bypass the installed-environment gate.

See [Architecture and build exclusion](MOBILE_UI_PREVIEW_ARCHITECTURE.md).
`npm run verify:preview-bundles` exports source maps for both environments on
both platforms and asserts production exclusion and the correct TEST adapter.
The IPA workflow runs this command before native project generation. Export
source maps are local build outputs, and ESLint excludes `.expo` artifacts.
Restart Metro after changing its configuration or the selected environment.
