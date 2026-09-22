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
   Complete the [release acceptance evidence](RELEASE_ACCEPTANCE.md), including
   measured stress and device/installer results, before publishing any draft.
2. Run the complete verification dispatcher:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File `
     .\scripts\verify.ps1 `
     -Target all
   ```

3. Build and inspect the Windows release artifacts. Their default version is
   read from `VERSION`:

   ```powershell
     powershell -NoProfile -ExecutionPolicy Bypass -File `
     .\tools\LocalMediaTransfer.InnoSetup\build.ps1 `
     -ReleaseArtifacts
   ```

   This creates the installer EXE, portable x64 ZIP, and `SHA256SUMS.txt` under
   `tools\LocalMediaTransfer.InnoSetup\output`. Both binaries contain the
   generated license bundle for the exact native, NuGet, and browser runtime
   closure. Review that bundle before publishing and independently recompute
   both SHA-256 hashes before upload.

4. Commit the release preparation, merge it into `main`, and push `main`.
5. Confirm the unsigned iOS PR workflow passed for the candidate. Windows cannot
   compile Swift. The Windows release workflow also calls that reusable macOS
   workflow at its own commit and waits for success before building Windows.
6. After the artifacts and notices are accepted, create an annotated tag:

   ```powershell
   git tag -a v2.0.1 -m "Local Media Transfer 2.0.1"
   git push origin v2.0.1
   ```

7. The tag triggers the Windows release workflow. It verifies that commit,
   builds artifacts, tests the staged server, verifies checksums, and creates a
   **draft** containing the EXE, portable ZIP and `SHA256SUMS.txt`. Review that
   draft rather than uploading untested replacement binaries. Paste the matching
   section from `CHANGELOG.md`, complete the acceptance evidence, then publish.
   A failed workflow must be fixed and rerun; do not bypass its checks by
   manually assembling a public release.

## iOS build number

The user-facing iOS version is the same product version in `VERSION`. Apple's
build number (`CFBundleVersion`) is a separate monotonically increasing value
when distributing multiple builds of the same product version. The current
unsigned-IPA workflow is not an App Store release; if App Store or EAS
distribution is added, document and automate the build-number increment before
the first submission.

## Workflow security

The Windows release build has read-only repository permission. Checkout does
not retain credentials. All actions in that workflow are pinned to official
repository commit IDs. Only the separate publish job receives `contents: write`.
It does not check out or execute repository/artifact code, restore dependencies,
or access build caches. It downloads this run's artifact by immutable artifact
ID, verifies the exact expected checksum entries and creates a draft release.
Branch dispatch still builds artifacts without creating a release.

`tests/test_release_workflow.ps1` executes the actual inline publisher script
against synthetic artifacts with a local `gh` stub. It checks valid publication
and rejection of missing/duplicate/wrong checksums, path traversal, invalid
versions and mismatched tags. It performs no GitHub writes. A hosted tagged run
is still required to validate real Actions permissions and artifact handoff.

This follows [GitHub's secure-use guidance](https://docs.github.com/en/actions/reference/security/secure-use)
on immutable action references and job-level least privilege.

The separate provenance job downloads the immutable tested artifact and uses
GitHub artifact attestations. Only that job receives `id-token: write` and
`attestations: write`; it does not execute repository or artifact code. The
draft publisher requires successful attestation. Verify a downloaded artifact
with `gh attestation verify <artifact-path> --repo RonPiece/LocalMediaTransfer`.
Provenance is not Windows Authenticode signing. A signing identity and an
installation acceptance run are still required before claiming signed release
readiness. See [GitHub artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations).

The iOS build records its commit, Xcode, Swift, Node, CocoaPods and generated
`Podfile.lock` alongside the unsigned IPA. This makes resolution inspectable;
it does not freeze the hosted image or turn the generated lockfile into a
locked input. Establish a reviewed native lockfile/toolchain baseline from a
successful macOS run before claiming fully reproducible native iOS builds.
