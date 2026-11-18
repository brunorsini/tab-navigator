# Tab Navigator privacy notice

Tab Navigator searches browser tabs and history locally. It has no server, accounts, analytics, advertising, telemetry, or AI service, and does not transmit search terms, browsing history, page content, or settings to its developer or another service.

## Data used

- Tab titles, URLs, group names, identifiers, and access times are used to display, rank, and activate tabs.
- Website favicons are read through Chrome's local favicon cache to identify tab and history results. The extension does not contact external favicon services or fetch icons directly from websites. Chrome itself manages its browser favicon database.
- Chrome history titles, URLs, and visit times are read when history search is enabled. Tab Navigator does not modify or delete your browser history.
- Appearance, domain grouping, window scope, and the page-text setting are stored in Chrome's local extension storage. Search source choices last only while the palette is open and reset to tabs only when reopened.
- Tab recency and cycling state are stored in Chrome's extension session storage.
- After closing or restoring tabs, a one-use tab identifier and timestamp in session storage let the search highlight follow the active tab, including if Chrome dismisses the popup. The target is valid for one minute and discarded when the popup consumes it; it contains no page content.
- If you enable page-text search and grant website access, descriptions, headings, and bounded text excerpts from open HTTP/HTTPS pages are stored in extension session storage. Form fields, editable areas, explicitly hidden elements, and elements marked `data-relay-private` are skipped. Other page text can contain personal information. The feature does not capture screenshots or audio and does not retrieve content from a server.

- Closing stores tab URLs, titles, positions, pins and group metadata in a local recovery journal before removing tabs. Each batch can be restored for 60 seconds after closing, including after popup closure or worker suspension. Successful restores remove completed entries; failed restores keep only the remaining entries with another minute to retry. Expired entries are discarded on the next close or restore, or when the extension is removed. The journal is not uploaded and does not capture form data or navigation stacks.
- Duplicate-cleanup reviews inspect standard form controls and editable regions on demand, only where website access was granted. The inspection returns status flags and reasons, not typed values, passwords, file names, or document text. Review tokens and URL/status metadata are stored in session storage for up to ten minutes (at most six reviews). Pages that cannot be inspected are kept by default in duplicate cleanup. Explicit Close actions in search close immediately without scanning page contents or requesting website access. No continuous input monitoring is installed.
- Bookmark selections are saved locally before opening the permission dialog, including selected titles/URLs and folder choices. Pending selections remain until completed, discarded, or the extension is removed. Completed selections discard their saved URLs and retain counts and outcome information. Search offers to resume the latest unfinished selection.
- Optional bookmark access is requested when you choose the bookmark-folder action. Folder names are read to let you choose a destination, and selected tab titles/URLs are saved there. Group actions modify Chrome tab groups at your request.
- Split view moves two selected compatible tabs next to each other and pairs them using Chrome's native split-view API. No page contents are read for this action.

## Retention and controls

Search queries and history results are held in memory while the search palette is open. Chrome history is queried only after history is enabled and a nonempty query is entered. Tab text is capped at 200,000 characters per page and two million combined text/heading/description characters across at most 350 pages. Older captures are evicted when the budget is reached. Tab text is removed on tab closure and invalidated when the tab navigates. Session data is cleared at browser session end or extension reload; preferences remain until changed or the extension is removed. The extension does not sync its settings, saved selections, or recovery journal. Bookmarks created at your request may sync through Chrome according to your browser settings.

Page-text search is off initially. You can disable it in Tab Navigator settings to stop capture, clear excerpts, and revoke website access, or clear excerpts separately. Website access can also be requested from close review for only the websites being checked; this does not enable page-text search. Disabling page-text search revokes website access, including access used for close checks. Chrome can also revoke extension site permissions. Tab Navigator does not run in incognito.

Selecting a history result may open its website, which then follows that site's own data practices. Tab Navigator's search itself makes no remote requests.

Tab Navigator's use of information received from Chrome APIs follows the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data), including its Limited Use requirements. Data is used only for the tab navigation and organization features described here. It is not sold, used for advertising, or used to determine creditworthiness.

For questions, use [GitHub Issues](https://github.com/brunorsini/tab-navigator/issues) with a description that contains no private browsing data. Security issues can be reported [privately](https://github.com/brunorsini/tab-navigator/security/advisories/new). GitHub operates separately under its own privacy policy; submitting a report there is your choice.

Last updated: November 18, 2026.
