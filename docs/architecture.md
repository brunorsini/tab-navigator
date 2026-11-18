# Architecture

Tab Navigator is a Manifest V3 extension written in JavaScript, HTML, and CSS. It uses browser APIs directly. No application build step or runtime package manager is needed.

## Main pieces

| Path                            | Responsibility                                                                            |
| ------------------------------- | ----------------------------------------------------------------------------------------- |
| `extension/background.js`       | Service-worker events, recency state, command routing, and messages from extension pages. |
| `extension/popup.js`            | Version and markup checks before starting the popup.                                      |
| `extension/palette.js`          | Search, selection, virtualized rows, recent-tab preview, and bulk-action controls.        |
| `extension/lib/search.js`       | Text normalization, match quality, and ranking.                                           |
| `extension/lib/result-view.js`  | Domain grouping, stable result order, and virtual layout.                                 |
| `extension/lib/bulk.js`         | Tab closing, recovery journal, groups, and bookmark writes.                               |
| `extension/lib/close-review.js` | Short-lived duplicate-close reviews and final authorization checks.                       |
| `extension/lib/input-check.js`  | Bounded, on-demand inspection for possible unsaved input.                                 |
| `extension/context.js`          | Optional page-text extraction in idle slices.                                             |
| `extension/review.js`           | Duplicate comparison and Keep/Close decisions.                                            |
| `extension/bookmarks.js`        | Resumable destination selection and bookmark permission flow.                             |
| `extension/options.js`          | Preferences, optional website access, and shortcut status.                                |

## Data flow

The popup requests a snapshot from the service worker, which reads open tabs, groups, recency, and optional cached excerpts. Search ranking happens locally. A query can also request history candidates when History is enabled. New snapshots preserve the visible order until the query or filters change.

Mutating service-worker operations are serialized. Recent-tab previews keep a frozen list so activation cannot continually rearrange the cycling order. Session storage preserves that state when the service worker sleeps.

Explicit close actions first persist a recovery batch in local storage. Failure to save the batch prevents closure. Duplicate cleanup additionally requires a current review and repeats input checks before removal. Undo recreates tabs using the saved addresses and metadata; it does not restore unsaved work.

Bookmark selections are persisted before permission is requested. A dedicated extension page continues the task even if Chrome dismisses the popup. The saved selection is removed or reduced after completion, cancellation, or partial failure.

The [privacy notice](../PRIVACY.md) is the source of truth for retention and controls.

## Dependencies and releases

The only bundled third-party executable code is `tldts`, used for Public Suffix List domain grouping. Its exact source and license are retained in `extension/vendor/`. Node dependencies are development tools; they are not shipped in the extension ZIP.

`scripts/release-files.json` explicitly lists every shipped file. Adding a runtime file requires updating that list. `npm run package` checks the list and produces a ZIP plus SHA-256 checksum. Tests, source artwork, local configuration, browser profiles, screenshots, and reports are excluded from the extension package.
