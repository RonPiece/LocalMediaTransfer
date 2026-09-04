# Publication checklist

Use this checklist before changing the GitHub repository from private to
public. Publishing source and distributing Windows/iOS binaries are separate
release decisions.

The public repository was initialized from a reviewed clean snapshot of the
legacy private development repository. Keep the legacy repository private and
never import its Git history, branches, tags, releases, or artifacts into the
public repository.

## Repository contents

- Confirm `git status --short` contains only intended release changes.
- Remove temporary patches, diagnostics, build output, certificates, exported
  reports, and media. `diff.txt` is not a release artifact.
- Keep dated files under `docs/development-sessions` local and Git-ignored.
- Keep `CHANGELOG_DEV.md` local and Git-ignored. It may contain sanitized
  engineering context for the developer, but it is not a public project file.
- Confirm `git ls-files --error-unmatch CHANGELOG_DEV.md` fails. If the file was
  ever pushed, removing it in a later commit is insufficient; remove it from
  every reachable public commit and re-run the history audit.
- `AGENTS.md` and `.agents/skills` may be public: they contain sanitized build,
  test, reliability, and contribution guidance. Review them like any other
  documentation before publishing.
- Keep `.codex` ignored because it is local Codex project configuration rather
  than application source.
- The first public README intentionally omits placeholder screenshots. Add
  real, reviewed screenshots later only when they are available.

## Git history and refs

Changing visibility exposes reachable commit history, branches, tags, and
release artifacts, not only the current `main` files. Run the history audit
from the repository root before publication:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  .\scripts\audit-git-history.ps1 `
  -GitleaksPath "C:\path\to\gitleaks.exe"
```

Do not use Gitleaks 8.30.1: upstream reports show that its release binaries can
silently miss known secrets, and the audit script rejects that version. Use
8.30.0 or a later release whose fix and official checksum have been verified.

Gitleaks detects many secrets, but it does not prove that the history is free
of personal paths, private media, compiled binaries, certificates, or other
unwanted data. Review all remote branches, tags, GitHub Releases, Actions
artifacts, and the script's risky-path inventory.

The legacy private history previously contained personal absolute paths,
certificate files on a remote branch, a compiled executable in a tag, and the
tracked `diff.txt` patch. Those objects are not part of the clean public
repository. Do not connect the public repository to the legacy repository with
an import, ordinary merge, or force-push. Future public development must build
on the clean public `main` history.

Never treat a successful Gitleaks scan as permission to ignore known non-secret
privacy or binary-history findings.

## Source license and binary notices

- Keep the project `LICENSE`, `NOTICE`, and `THIRD_PARTY_NOTICES.md` in the
  public source repository.
- Verify the source and license of every vendored font, icon, script, and other
  asset.
- Before attaching Windows artifacts, run the installer build with
  `-ReleaseArtifacts`. It creates `THIRD_PARTY_LICENSES` from the exact NuGet
  and vcpkg runtime closure plus the vendored browser assets and installer
  runtime. Review the generated metadata, license, copyright, and NOTICE files;
  do not rely only on the source-level summary.
- Before attaching an IPA, create a notice bundle from the exact JavaScript and
  CocoaPods closure. CocoaPods acknowledgement output and package license files
  are useful inputs, but the final bundle still needs review.
- Include the resulting notices with each binary distribution and make them
  reachable from the release page/application documentation.

The iOS lockfile's three entries without a modern `license` field are not three
unknown licenses: their installed package metadata/files identify `exit` as
MIT, `qrcode-terminal` as Apache-2.0 (with an additional MIT component notice),
and `requireg` as MIT. The lockfile alone is therefore not the authoritative
notice source. An iOS binary release remains blocked until its complete bundled
closure is generated and reviewed. Windows artifacts must likewise use and pass
review of their generated exact-closure bundle; a public source repository does
not need to wait for an installer or IPA.

## GitHub security settings

- Keep `.github/dependabot.yml`. It opens reviewable dependency-update pull
  requests; it does not merge them automatically. Pay special attention to
  Expo SDK 54 compatibility and do not accept broad iOS upgrades blindly.
- After the repository is public, enable **CodeQL default setup** in
  `Settings > Advanced Security`. Default setup is preferred here because
  GitHub maintains the generated configuration and recognizes the repository's
  C++, C#, and JavaScript/TypeScript languages.
- Enable the dependency graph, Dependabot alerts/security updates, secret
  scanning and push protection, and private vulnerability reporting.
- Protect `main`: require pull requests and successful Windows CI before merge.
- Review workflow permissions and keep the default token read-only unless a job
  has a documented need for more access.

## Release acceptance

- Update `CHANGELOG.md` and replace the release heading's `Unreleased` marker
  with the release date.
- Run `scripts/set-version.ps1 -Check` and the full verification dispatcher.
- Verify the Windows installer on a clean supported Windows system.
- Run the unsigned-IPA workflow from the intended committed and pushed branch;
  treat its macOS Swift build as the native compiler gate.
- Perform the documented physical-iPhone and two-Windows-PC acceptance checks.
- Publish only artifacts built from the tagged commit, with checksums and the
  reviewed third-party notice bundle.
