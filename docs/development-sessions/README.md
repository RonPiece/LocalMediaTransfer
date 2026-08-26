# Development Session Records

This is a repository-wide policy. It is not limited to iOS or to tasks that load
the iOS skill.

Create one local Markdown note for every repository task, including planning,
review, diagnosis, testing, and implementation tasks that make no source change.
Any task that creates, modifies, renames, or deletes source, tests,
documentation, workflows, configuration, tooling, or assets in this repository
must update its note before the task ends.

Dated notes are intentionally matched by `.gitignore`. They stay on the
developer's machine and must not be force-added or published. This README is
tracked so every checkout documents the local-record format.

## Filename

Use UTC:

```text
YYYY-MM-DD-HHmmZ-short-topic.md
```

If two tasks would use the same minute and topic, append `-2`, `-3`, and so on.

## Required structure

```markdown
# Short task title

## Objective and initial state

## Decisions and reasoning

## Changes

## Verification

## Failures and classification

## Unverified and follow-up

## Source-control state
```

Include exact verification commands and factual results. Classify failures as
source, environment, permissions, or stale build state. Explicitly distinguish
Jest/TypeScript checks, macOS Swift compilation, and physical-device evidence.

`CHANGELOG_DEV.md` remains the reconciled current status. These notes are the
chronological engineering record.

## Privacy rules

Do not include credentials, tokens, credential-bearing URLs, personal absolute
paths, media filenames, Photos identifiers, GPS data, certificate
fingerprints, media contents, or raw diagnostic exports. Use repository-relative
paths and coarse, privacy-safe evidence.
