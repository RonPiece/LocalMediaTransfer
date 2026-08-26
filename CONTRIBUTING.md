# Contributing

## Development setup

1. Install Visual Studio 2022 or later with the x64 C++ toolchain.
2. Install the .NET 8 SDK and Node.js.
3. Run `scripts\bootstrap-dependencies.ps1`.
4. Run `scripts\verify.ps1 -Target validate`.

If vcpkg reports `fatal error RC1107` from the Windows resource compiler after
a Visual Studio/MSVC update, rerun the bootstrap command with
`-PreferVisualStudioTools`. That path keeps the pinned vcpkg baseline but
prefers the Visual Studio-bundled CMake and vcpkg-acquired helper tools.

The repository must build without personal absolute paths. Do not commit
`vcpkg`, `bin`, `obj`, `out`, `.vs`, uploads, databases, logs, test results,
installer staging, or installer binaries.

## Making changes

- Preserve process ownership: normal stop and exit paths may terminate only the
  server process launched by that GUI or test.
- Keep tests isolated under `%TEMP%\LocalMediaTransfer.Tests\<guid>`.
- Keep benchmark mode opt-in and separate from normal operation.
- Keep actual uploaded bytes separate from duplicate-skipped/completed bytes.
- Describe file I/O as memory-mapped or reduced-copy, not strict zero-copy.
- Chunks are sequential within a file; concurrency may occur across files.

## Verification

Use the smallest relevant target while developing:

```powershell
.\scripts\verify.ps1 -Target frontend-tests
.\scripts\verify.ps1 -Target csharp-tests
.\scripts\verify.ps1 -Target server-tests -SkipLargeBoundaryTests
```

Before opening a pull request, run:

```powershell
.\scripts\verify.ps1 -Target all
```

GUI lifecycle changes also require the local Debug and Release tray smoke tests
described in `tests\README.md`.

## Pull requests

Describe the problem, behavioral change, tests, and any remaining risk. Add a
regression test for deterministic bug fixes. Do not include unrelated formatting
or generated output.

Release preparation follows [the release process](docs/RELEASING.md). Do not
change product versions on ordinary development commits.
