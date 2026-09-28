# iOS styling and appearance

## Responsibility map

- `src/LocalMediaTransfer.iOS/src/theme/tokens.json`: paired Light/Dark semantic
  colors. Existing Light values are retained, except that redundant connection
  colors have been removed in favor of `success` and feature-selected tones.
- `src/theme/index.ts`: effective appearance, active palette, reduced motion and
  Reduce Transparency subscriptions. `src/theme/ThemeProvider.tsx` owns the saved
  System/Light/Dark preference, synchronizes React Native Appearance and
  NativeWind, and rejects stale hydration after an explicit choice.
- `src/theme/appearance.ts`: pure typed recipes for tones, actions, interaction
  feedback, tabs, grouped/segmented controls and navigation material. No React state or feature logic.
- `tailwind.config.js`: static NativeWind semantic classes from the same tokens.
  Keep NativeWind 2's native dark variant; do not set browser `darkMode: 'media'`.
- Shared UI owns control rendering, geometry and accessibility properties.
  Features own status meaning, text, layout, handlers and domain state.

Paths beginning with `src/theme` refer to the iOS application's source folder.
Palette values passed through native props are intentional: icons, Switch, SVG
and BlurView cannot all be styled through class names.

## Surface and action roles

- `background`: page canvas.
- `surface`: ordinary solid content cards.
- `elevatedSurface`: emphasized/transient modal cards and opaque navigation.
- `surfaceInset`: nested panels and manual-entry input groups.
- `border`: quiet card/control edge; `separator`: row and navigation divisions.
- `primary`: accent foreground; `primaryFill`: filled action/selection color.
- `primarySoft`, `successSoft`, `warningSoft`, `errorSoft`: semantic tinted fills.
- `disabledFill`: unavailable action fill, independent of border color.
- `navigationOverlay`: native material backing, independent of content cards.

Primary actions are filled; secondary actions are tinted; destructive actions
use soft error treatment; plain actions have no fill. Existing button APIs and
component dimensions are preserved. NativeWind owns static geometry and surface
classes; recipes resolve state-dependent native colors.

## State precedence

Disabled overrides pressed. Selection persists independently of a press. Busy
state remains feature-owned: callers decide availability, labels and progress.

`TouchableOpacity` consumes the recipe's `activeOpacity`; `Pressable` consumes
its state-dependent `opacity`. Do not apply both feedback adapters to one control.
Disabled actions use muted foreground/fill without a second opacity reduction.
Rows and unavailable tabs use their respective interaction profiles. Settings
descriptions remain readable while only the unavailable native Switch is dimmed.
Switch touch feedback remains native. Grouped actions smoothly transition
opacity and recipe colors without scale animations. Reduce Motion disables
these transitions.

`toneAppearance` supplies foreground and background for badges and banners.
Neutral is a nested-surface treatment, not an unavailable control. Feature code
chooses a tone; it does not construct alpha-based status backgrounds.

## Grouped controls and appearance preference

`components/ui/controls.tsx` renders a continuous elevated tray with a quiet
border. `SegmentedControl` uses the `segmentAppearance` recipe for selected,
pressed and disabled colors; disabled overrides the other states. History
uses four equal-width pills: All, Completed, Skipped and Failed. Failed
includes sessions with failed files, including mixed outcomes, and fatal status.
Cancellation without failures remains in All. Skipped includes every session
with skipped files, including mixed results. The Settings appearance selector uses
the same control. Optional scrollable selectors retain their scroll affordance.

`groupedControlMetrics` in the same file is the shared sizing setting: 36-point
pills, fully rounded corners, 12-point labels and 4-point tray padding/gaps.
Vertical hit slop inside the tray retains at least 44-point touch height. Labels
can wrap with larger text. Connect uses fixed-width actions so searching does
not move the help button, with icon-only actions on narrow screens/large text.

Refresh and Disconnect share `ControlGroup` and `GroupAction`. They remain
independent actions with info/error soft fills and muted disabled fills; they
are not represented as mutually exclusive selected options. Busy/connecting
states disable conflicting actions, including the discovery retry action.
The help button and tray have a uniform gap. Connected QR pairing has one
instruction and no chevron; it remains disabled. Mixed upload/skipped sessions
keep their Completed badge and show `DuplicateSkipMarker` on Home and History:
small warning-colored text on a warning-soft marker background. The all-skipped History badge uses compact text.

Do not put `className` on a `Pressable` with a function-valued `style` in
NativeWind 2. Its wrapper builds an array containing that callback, so React
Native never executes the pressed-state resolver and its colors are lost.
These controls use React Native `StyleSheet` geometry and recipe colors with
an animated Pressable adapter. No function-valued styles or NativeWind classes
are put on the animated controls.

`AnimatedControl` interpolates background, outline, foreground text and press
opacity. `SelectionIndicator` slides/resizes to the selected segment's measured
bounds, including after native text-size/layout changes. Before measurements
exist, the selected segment keeps its own visible fill. Scrollable selectors
place the indicator inside their scroll content. `controlTransitionConfig`
centralizes the 180ms easing and System Reduce Motion policy. When the reduced-
motion hook is enabled, the adapter assigns target values directly instead of
scheduling an animation. Reanimated
handles frames on the UI thread, with no timer/per-frame React state. Connect
has independent action feedback, without a persistent selected-action state.
This fixes an implementation error in the previous discovery button styling.

System is the default. The preference is saved in environment-scoped
AsyncStorage. A choice updates native Appearance, NativeWind classes, palette,
status-bar contrast and navigation material together. System clears the native
override with React Native 0.86's `unspecified` value. Writes are serialized;
failed persistence reports that the choice remains active for the session.

## Address panels and explicit export actions

`addressPanelAppearance` provides inset/background and quiet-outline roles for
the Home address/details area and the address in Connection Security. Both use
explicit style colors, so the three status/address/action regions remain distinct.
`CopyAddressButton` shares accessible button geometry: Home uses a soft fill plus
accent outline and at least 44-point height; details uses a 48-point full-width
primary fill. Clipboard behavior still copies only the public address.

`DiagnosticExportButton` is shared by Settings and the legacy dashboard settings
modal. Report dates/status text and export-all labels sit in ordinary Views;
only the 44-by-44 share icon button triggers export. Export-all is unavailable
until reports have loaded and at least one is present. The loading/error/retry
behavior and export handlers are unchanged.

## Picker selection and completion footer

`mediaSelectionAppearance` in `theme/appearance.ts` chooses the photo-content
contrast treatment. `MediaGridItem.tsx` uses explicit StyleSheet geometry for a
full-thumbnail 35% black overlay, 3-point accent border and 26-point filled blue
check badge with a white outline. Unselected badges are dark translucent with
white outlines. No scaling or numbered-selection bookkeeping is added; per-ID
subscriptions, drag selection, recycling and bounded thumbnail loading remain.
VoiceOver receives the selected state. These overlays do not intercept touches.

`TransferProgressScreen.tsx` uses a normal-flow completion footer above the tab
bar. It reserves space instead of overlapping the summary. The Done action has
explicit 56-point minimum height, full width, primary-fill background and white
text in both appearances, reusing `actionAppearance`. This avoids reliance on
absolute footer utility geometry and opacity-modified background classes. Native
rendering of the previously invisible button still needs device confirmation.

Windows can edit and hot-reload the JavaScript/TypeScript UI, inspect rendered
component props and compile NativeWind styles in Jest. It cannot run the iOS
simulator or verify UIKit, PhotoKit, safe areas or physical contrast. Screenshots
or recordings from the phone remain the native visual review evidence. Changes
to Tailwind config/tokens may require restarting Metro with `--clear`; Fast
Refresh alone does not establish that compiled utility styles were refreshed.
Swift capability changes still require a rebuilt development client.

## Local problem-file previews

`services/history/ProblemPreviewStore.ts` keeps local metadata and thumbnail
keys separate from the receiver's history schema. UploadManager supplies exact
session/file-ID-to-Photos-asset associations after terminal outcomes. Joining
uses environment, receiver address, session and file ID, never filenames.
There is no reliable local association for pre-existing records or transfers
from another phone; those display a placeholder. Changing receiver address can
also make a local association unavailable.

The store retains up to 200 problem-file associations (skipped or failed) for
30 days, with at most three pending capture jobs. It prunes at app launch,
capture and clear; expiry hides records even before cleanup. Images use separate
private AsyncStorage keys. Only keys in this store's namespace are removed.
Clearing receiver history invalidates queued capture and clears that receiver's
local previews after successful remote deletion.

`PhotoThumbnailService.swift` captures local-only 160 × 160 JPEGs in batches of
at most 20, on a dedicated serial utility queue. Each request is limited to
500 ms and 24 KB of JPEG data, with no iCloud download. NativeCapabilities checks
returned IDs, encoding and length. An older installed client or Expo Go safely
retains only the asset association and shows a placeholder; tapping still
resolves the original. No `ph://` image fallback is rendered automatically
because Expo Image enables iCloud downloads for that loader.
A new native build is required for saved JPEG capture.

`HistoryProblemDetailsModal.tsx` displays the preview plus outcome marker.
Tapping a photo resolves the exact asset through Expo MediaLibrary and opens an
in-app original preview. An explicit tap may download an iCloud original;
background capture never does. Denied/limited access, deleted originals,
loading failures and late responses after closing have fallbacks. Video posters
are shown without a photo-only original action. No undocumented Photos URL
scheme is used. Photos references and JPEG bytes are never added to transfer
history requests or redacted diagnostic reports.

## Connection presentation

`features/dashboard/connectionPresentation.ts` resolves the security header's
label and tone together. Checking/retrying uses info; unavailable uses warning;
HTTP uses error; verified HTTPS uses success. A connection without confirmed
verification cannot show the verified green header.

There are no `connected` or `disconnected` color tokens. Connection domain states
retain those names. The Local network chip reports connectivity and uses success
when connected; it does not assert verified TLS. Its meaning differs from the
security header.

## Navigation material

The existing five tabs and bottom placement are preserved. iOS uses Expo BlurView
with system chrome Light/Dark material and semantic backing/separator colors.
Blur intensity remains 72 as the existing component calibration; it is pending
physical-device comparison. Reduce Transparency replaces blur with a solid
elevated surface and follows native preference changes.

This is standard UIKit blur material, not an implementation of Liquid Glass.
Content cards remain solid. The tab bar is below the content, so content does not
scroll underneath it; changing that would require a separate layout decision.

## Verification and device acceptance

From `src/LocalMediaTransfer.iOS`:

```powershell
npx tsc --noEmit
npm run lint
npx jest --runInBand
```

Recipe tests cover both palettes, disabled/pressed precedence, action hierarchy,
selected/unavailable tabs and the solid navigation fallback. NativeWind compiler
tests switch Light → Dark → Light and check semantic color mappings. Contrast
tests check new Dark body/status text and white filled-action text at 4.5:1.
They do not establish whole-app accessibility conformance or prove native blur
appearance. Existing Light token values are protected; its previous contrast
choices have not been globally redesigned.

Physical-iPhone acceptance remains required:

1. Restart Metro with `npm run start:dev-client -- -c` and open the development
   client. Release builds require an IPA from committed/pushed source.
2. In Settings, select System → Light → Dark → System, reopen the app and
   check persistence. Change iOS appearance while System is selected and while
   an explicit override is selected; classes, native props, modals, status bar
   and tab material must agree.
3. Review Home, Transfers, Connect, History, Settings, the picker and every modal.
4. Check enabled/disabled, pressed, selected and busy controls; settings switch
   labels/help must remain readable when the switch is unavailable.
5. Review reconnecting, verified HTTPS, HTTP and disconnected presentation, plus
   preparation, active upload, skipped, failed and completed transfer states.
6. Check status-bar icons, navigation material and the QR camera's light status
   content against their backgrounds.
7. Check history segments on small screens and large text; inspect the action
   tray enabled, pressed, searching, disconnected, connecting and connected.
   The connected QR card must show the disconnect instruction without a second
   green banner. Check both light and dark backgrounds on the physical display.
8. After rebuilding the native client, transfer skipped/failed media, restart,
   reopen Problem Files, then test deleted/limited-access/iCloud originals and
   clear history while capture is pending. Test old records without associations.
9. Enable Reduce Transparency and Reduce Motion; also inspect increased contrast
   and larger text. Material strength and inset/elevated surface separation need
   review on a real display. Compare across supported iOS versions where possible.

Windows TypeScript/Jest checks are separate from Swift compilation on macOS and
native/PhotoKit/visual acceptance on the device.

Animation references: [Expo SDK 57 Reanimated](https://docs.expo.dev/versions/v57.0.0/sdk/reanimated/)
and [Reanimated timing/Reduce Motion](https://docs.swmansion.com/react-native-reanimated/docs/animations/withTiming/).
