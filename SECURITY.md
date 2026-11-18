# Security

## Report a vulnerability privately

Use [GitHub's private vulnerability reporting](https://github.com/brunorsini/tab-navigator/security/advisories/new). Please do not put credentials, private browsing data, or exploitable vulnerabilities in a public issue.

Include the affected version, a minimal reproduction using synthetic URLs/data, and the expected impact. Do not send browser profiles, storage exports, or personal screenshots.

Security fixes target the latest release. No response-time guarantee is offered.

## Security boundaries

- Tab Navigator has no backend, telemetry, remote code, or external search service.
- Extension-page connections are blocked by the content security policy. User-requested navigation and Chrome's own bookmark sync remain browser functions.
- Website access and bookmark access are optional. Content scripts receive only the page-text capture task; privileged actions are handled by the service worker for the extension's own pages.
- Page titles, URLs, and text excerpts are rendered as text, not HTML.
- Undo records and unfinished bookmark selections are local browser data, not source files. They must never be included in bug reports or release artifacts.

The packaging script checks an explicit file list, versions, JavaScript syntax, packaged resources, image metadata, and the bundled parser against the pinned dependency. Run a separate secret scanner against the staged Git snapshot and the extracted release before publishing. These checks reduce risk; they are not a guarantee that software is free of vulnerabilities.
