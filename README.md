<p align="center"><img src="extension/icons/256.png" width="112" height="112" alt="Tab Navigator's schnauzer sailor mascot"></p>

# Tab Navigator

Find your way through a sea of tabs. A fast, keyboard-friendly Chrome extension for searching, switching, and organizing tabs — with everything processed locally.

[![Checks](https://github.com/brunorsini/tab-navigator/actions/workflows/checks.yml/badge.svg)](https://github.com/brunorsini/tab-navigator/actions/workflows/checks.yml)
[Releases](https://github.com/brunorsini/tab-navigator/releases) · [User guide](docs/usage.md) · [Privacy](PRIVACY.md) · [Report a bug](https://github.com/brunorsini/tab-navigator/issues)

## What it does

- **Find a tab:** search titles, URLs, and tab groups; optionally include browsing history or loaded page text.
- **Switch quickly:** jump to the last tab or preview a stable list of recently used tabs.
- **Organize results:** select individual tabs or every match, then close, group, or bookmark them.
- **Undo closures:** each close action has a separate Restore button and a one-minute countdown.
- **Review duplicates:** compare copies side by side, with possible unsaved input kept open by default.
- **Pair two tabs:** use Chrome's native split view where the browser supports it.

Exact matches come first, followed by clearly relevant results ordered by recent use. Domain grouping keeps related sites together. Results stay stable while you navigate or select.

## Install

**The Chrome Web Store listing is not published yet.** Until then:

1. Download `tab-navigator-1.7.0.zip` from [Releases](https://github.com/brunorsini/tab-navigator/releases/latest) and extract it into a permanent folder.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Choose **Load unpacked** and select the extracted folder containing `manifest.json`.
4. Pin **Tab Navigator** from Chrome's extensions menu.

Requires Chrome 127 or later. Native split view requires Chrome 155+ and is checked at runtime. Loading the extension needs no Node.js, dependency installation, or build step. Developers can load the repository's `extension/` folder directly.

## Keyboard shortcuts

| Action          | macOS              | Windows / Linux  |
| --------------- | ------------------ | ---------------- |
| Open search     | Control + E        | Ctrl + Shift + E |
| Toggle last tab | Option + Q         | Alt + Q          |
| Cycle forward   | Option + R         | Alt + R          |
| Cycle backward  | Option + Shift + R | Alt + Shift + R  |

**Q** for a quick return, **R** for recent tabs; **Shift** reverses. These are new-install defaults. Settings shows your actual assignments, including custom bindings. You can also pin and click the toolbar spyglass to search.

In search, **↑/↓** moves the highlight, **Enter** switches tabs, **Command/Ctrl + Enter** toggles selection, and **Escape** closes the popup. Recent-tab cycling previews your destination; Enter confirms it.

Change shortcuts at `chrome://extensions/shortcuts`. Other apps or extensions can claim the defaults. See the [user guide](docs/usage.md) for optional Keyboard Maestro mappings and detailed behavior.

## Privacy

No accounts, servers, analytics, advertising, or remote code. Search and storage stay in your browser. History is searched only when enabled; page-text search starts disabled and requires optional website access. Bookmark access is requested when you use it. Incognito is disabled.

The local recovery journal stores closed-tab addresses for Undo; pending bookmark selections are also stored locally until completed or discarded. Restore reopens addresses and tab organization, **not unsaved form contents or page state**. The [privacy notice](PRIVACY.md) describes every stored data category and its retention.

## Support

Email [support@orsini.org](mailto:support@orsini.org) for help or privacy questions. For public bug reports and feature requests, use [GitHub Issues](https://github.com/brunorsini/tab-navigator/issues). Please leave out private browsing data and screenshots that contain personal information.

## Development

Use Node.js 22 or later, npm, and the `zip` / `unzip` command-line tools:

```sh
npm ci --ignore-scripts
npm run check
npm run package
```

`check` verifies formatting, JavaScript syntax, release contents, permission boundaries, and the unit tests. `package` builds only the explicitly allowed extension files and writes a SHA-256 checksum alongside the ZIP. CI uses read-only permissions and pinned actions.

The [contribution guide](CONTRIBUTING.md) covers optional browser tests and manual checks. [Architecture notes](docs/architecture.md) describe the code and data flow. See [SECURITY.md](SECURITY.md) for private vulnerability reports.

## License

[MIT](LICENSE). The bundled domain parser retains its own MIT notice. Third-party favicon fixtures are used only in tests; their trademarks belong to their owners and do not imply affiliation.
