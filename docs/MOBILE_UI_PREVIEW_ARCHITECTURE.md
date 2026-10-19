# Mobile UI Preview architecture

## Requirement and build contract

UI Preview belongs to TEST builds on iOS and Android. Production must exclude
the catalog, fixtures, sample assets, playback controller, and preview adapters
from its JavaScript dependency graph. A runtime check alone does not meet this
requirement. Shared real screen presentations remain production application
code because both real operation and preview render them.
The only normal-app entry is Settings, including when disconnected; Connect
does not expose a preview control. Connected receiver fixture data stays in the
TEST directory and enters real presentations through the public connection model.

## Dependency boundaries

1. `src/features` and `src/platform`: actual typed screen presentations. Real
   wrappers mount transfer, connection, media, and persistence controllers.
2. `@lmt/ui-preview`: one build-selected integration contract in
   `src/integrations/uiPreview`. Production uses
   a no-op implementation with no imports from the preview directory. TEST
   uses the workspace, entry control, and optional display overrides.
3. `src/dev/preview`: TEST-only catalog, coherent typed fixtures, playback,
   temporary appearance, screenshot controls, and platform adapters. It may
   import real views; production views must not import this directory directly.
4. Metro configuration: choose the integration implementation from the explicit
   application environment, default to production, and reject any accidental
   production dependency on the preview directory.
5. `.ios.tsx` and `.android.tsx`: select the actual platform presentation for
   media review. Shared scenarios cover common screens; platform-specific
   states such as iOS albums are filtered from the other platform's catalog.

```text
production build -> production integration (no-op) -> real views/controllers
TEST build       -> TEST integration -> preview host -> fixtures -> real views
                                                       |-> iOS adapter
                                                       |-> Android adapter
```

The installed environment gate still runs before mounting the TEST workspace.
Preview sessions unmount live application controllers. Display overrides and
sample interactions stay in memory. No global upload-manager monkey patches,
fake network endpoints, real media identifiers, or persistence are used.
The typed integration may supply display-only Problem Files thumbnails. These
do not provide Photos asset identities or enable original-file access. Normal
iOS sessions retain their existing local thumbnail store and original lookup.

## Verification and acceptance

- Unit/component tests: entry isolation, controller unmounting, no uploads,
  camera/Photos access or diagnostic reads, appearance restoration, screenshot
  pause/restore, deterministic playback and fixture totals.
- Metro resolver tests: production default, explicit TEST selection, both
  platforms, and fail-closed handling of an accidental preview import.
- Export source maps for production and TEST on iOS and Android. Verify that
  production has the no-op integration and no preview module, and TEST contains
  the workspace plus the appropriate platform adapter. Exports verify JS
  dependency graphs, not Swift/Kotlin compilation or device rendering.
- Run mobile Jest, TypeScript, lint and dependency compatibility checks.
- Physical iPhone/Android review remains required for fonts, appearance,
  enlarged text, accessibility, sheet positioning and gesture behavior.

## Native boundary

This feature is implemented in React Native/TypeScript. It does not add mock
branches, preview exports, or preview resources to Swift or Kotlin modules.
Future native-only developer features must use native compile-time boundaries
(Swift compilation conditions or Android variant source sets), rather than a
user-visible runtime toggle. Environment and Debug/Release are independent:
TEST release can contain preview; production Debug must still exclude it.
Android native and Play release work remain paused.

## Basis in official documentation

- [Expo Metro aliases](https://docs.expo.dev/guides/customizing-metro/#aliases):
  select implementations through a custom resolver and chain to Expo's default.
- [React visual state and props](https://react.dev/learn/thinking-in-react):
  separate the visual component hierarchy and derive state consistently.
- [TypeScript type-only imports](https://www.typescriptlang.org/docs/handbook/modules/reference#type-only-imports-and-exports):
  keep contract dependencies out of emitted runtime imports.
- [React Native platform-specific files](https://reactnative.dev/docs/platform-specific-code):
  use platform extensions for substantial iOS/Android differences.
- [Swift conditional compilation](https://docs.swift.org/swift-book/documentation/the-swift-programming-language/statements/#Conditional-Compilation-Block)
  and [Android source sets](https://developer.android.com/build/build-variants#sourcesets):
  native compile-time separation if a future native preview capability is needed.

## Current implementation status

The workspace, build-selected boundary, separate iOS/Android media adapters,
and source-map assertion command are implemented. The IPA workflow runs
`npm run verify:preview-bundles` before native generation; the Metro resolver
also rejects accidental production imports from `src/dev/preview`.
TypeScript checks include both iOS-first and Android-first module resolution.
Jest uses an explicit TEST integration mapping; a separate test imports the
production no-op and verifies production resolver behavior.

Sample thumbnails are generated PNG data URLs inside the TEST directory so
both platforms can render them without native permissions or networking.
Physical-device review and new native builds remain separate, unverified
acceptance gates. No Swift or Kotlin preview behavior has been added.
