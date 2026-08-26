# Release process

`VERSION` is the source of truth for the Windows GUI, C++ server, iPhone app,
installer, and benchmark client. Product releases use Semantic Versioning in
`MAJOR.MINOR.PATCH` form.

The initial public release is `2.0.0`. After it is released:

- use `2.0.1` for a compatible bug-fix release;
- use `2.1.0` for a backward-compatible feature release;
- use `3.0.0` for an intentionally incompatible product or protocol release.

Do not change the product version after every commit. Change it once while
preparing a release. Protocol versions, database schemas, diagnostic schemas,
and the iOS build number are separate values and are changed only when their
own compatibility rules require it.

## Prepare a version

From the repository root, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  .\scripts\set-version.ps1 `
  -Version "2.0.1"
```

The script updates all product-version locations. Confirm they agree:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  .\scripts\set-version.ps1 `
  -Check
```

Then move the user-visible entries from `Unreleased` into a heading for the
new version. On release day, use the UTC date in `YYYY-MM-DD` format.

## Verify and release

1. Run the publication checklist in `docs/PUBLICATION_CHECKLIST.md`.
2. Run the complete verification dispatcher:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File `
     .\scripts\verify.ps1 `
     -Target all
   ```

3. Build and inspect the Windows installer. Its default version is read from
   `VERSION`:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File `
     .\tools\LocalMediaTransfer.InnoSetup\build.ps1
   ```

4. Commit the release preparation, merge it into `main`, and push `main`.
5. Run the unsigned iOS workflow from the exact pushed commit. Windows cannot
   compile the Swift module, so a successful macOS workflow is required.
6. After the artifacts and notices are accepted, create an annotated tag:

   ```powershell
   git tag -a v2.0.1 -m "Local Media Transfer 2.0.1"
   git push origin v2.0.1
   ```

7. Create the GitHub release from that tag and paste the matching section from
   `CHANGELOG.md` into the release notes.

## iOS build number

The user-facing iOS version is the same product version in `VERSION`. Apple's
build number (`CFBundleVersion`) is a separate monotonically increasing value
when distributing multiple builds of the same product version. The current
manual unsigned-IPA workflow is not an App Store release; if App Store or EAS
distribution is added, document and automate the build-number increment before
the first submission.
