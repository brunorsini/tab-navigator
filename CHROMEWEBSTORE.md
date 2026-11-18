# Tab Navigator Chrome Web Store submission draft

Status: submission materials prepared; not submitted to or published in the Chrome Web Store. The public contact address is support@orsini.org. Developer registration, contact-email verification, current store screenshots, and dashboard submission remain pending.

## Listing

- Name: **Tab Navigator**
- Version: **1.6.2**
- Category suggestion: **Productivity**
- Language: **English**
- Minimum Chrome version: **127**
- Single purpose: Find, switch, and organize browser tabs from one local search interface, with optional browsing-history search.
- Short description (manifest): Find the right tab instantly. Search tabs and history, jump to your last tab, and cycle through recent tabs. All on your device.
- Homepage: https://github.com/brunorsini/tab-navigator
- Support URL: https://github.com/brunorsini/tab-navigator/issues
- Public contact email: **support@orsini.org**
- Privacy URL: https://github.com/brunorsini/tab-navigator/blob/main/PRIVACY.md
- Price: free; no purchases or subscriptions.
- Remote code: **No**. All executable code is bundled.

## Detailed description draft

Your tabs, a few keystrokes away.

Tab Navigator brings a focused search palette to Chrome. Start with recent tabs, most recently used first. Type a title, URL, or tab group and press Enter to jump straight to the result. Exact matches come first, with accent-insensitive matching and tolerance for small typos. Every opening starts with tabs only; enable History to search the same query in browsing history, and disable Tabs if you want history alone. An empty query never shows unrelated browsing history.

Among clearly relevant title and website matches, recently used tabs come first. Group search results by domain to keep a website and its subdomains together. Exact matches stay above the groups, and results stay steady until you reopen search or change the query or filters.

Jump to your last tab and back again with one shortcut. Cycle through your recently used tabs in either direction, across windows or just within the current window. Customize all shortcuts in Chrome.

See the complete matching tab count, select all matches, and close immediately, add to a tab group, or save to a bookmark folder. Each close has its own Restore button for one minute, with a visual countdown. A hover × closes individual search-result tabs the same way. Pair two compatible tabs in Chrome's native split view on Chrome 155 or newer. Bookmark access is optional and requested when used. The selection is saved before the permission dialog and resumed in a dedicated page. Review duplicate addresses with clear Keep/Close choices; possible unsaved input and unchecked pages stay open by default in duplicate cleanup. Restore reopens saved addresses, not unsaved page contents.

Choose dark, light, or system appearance. Enable optional page-text search to find words in descriptions, headings, and loaded text from open websites. Local indexing runs in short idle slices with fixed processing and cache limits. It does not index PDFs, image text, or video transcripts. Clear titles, URLs, and matching text keep the interface light without thumbnails.

Everything is searched on your device. No accounts, analytics, remote search requests, or AI downloads. Page-text search requires optional website access. Tab Navigator does not run in incognito.

Chrome does not directly allow extension shortcuts that use Tab. A tool such as Keyboard Maestro can translate your preferred keys into the extension's accepted shortcuts. Tab Navigator previews a fixed recent-tab list and confirms on Enter and does not replace the operating system's app switcher. Its source is licensed under MIT.

## Permission justifications

| Permission                           | Purpose                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tabs`                               | Read open-tab titles, URLs, and tab metadata to populate and rank search results and find the intended tab.                                                                                                                                                                                                                                                                                               |
| `favicon`                            | Display cached website icons beside tab and history results through Chrome's local `_favicon` resource. No external icon service or direct website request is used.                                                                                                                                                                                                                                       |
| `tabGroups`                          | Read group titles for matching and create or update groups for selected tabs at the user’s request.                                                                                                                                                                                                                                                                                                       |
| `history`                            | Read Chrome history titles, URLs, and visit times for the independently selectable history source. The extension never adds, edits, or deletes history records.                                                                                                                                                                                                                                           |
| `storage`                            | Save preferences, a durable local Undo journal for bulk closes, saved bookmark selections, session recency, preview state, short-lived close reviews, and optional bounded page excerpts.                                                                                                                                                                                                                 |
| `scripting`                          | Inject packaged scripts for optional page-text search and on-demand pre-close input checks, only after optional website access has been granted. Close checks return status flags, never typed values.                                                                                                                                                                                                    |
| Optional `bookmarks`                 | Read folder names and save selected tab titles and URLs to a chosen or newly created folder. Requested only when the user chooses this action.                                                                                                                                                                                                                                                            |
| Optional `http://*/*`, `https://*/*` | Read descriptions, headings, and bounded text excerpts from open pages for optional local text search. Also supports on-demand form/editable-region checks before closing tabs. Disabled by default; page-text search requests access in settings, while close review can request access for only the selected websites. No website access is needed for title/URL/group/history search or tab switching. |

## Data handling and code

All executable JavaScript, CSS, and icons are packaged. No remote code, eval, server calls, analytics, tracking, or advertising. The MIT-licensed tldts domain parser and its Public Suffix List are bundled locally. Rendering uses text nodes; page titles and URLs are never inserted as HTML. The extension page CSP restricts scripts to self and blocks objects and base-URL changes.

Disclose **web history** and **website content** in the dashboard: tab URLs/titles, visit and activation times, optional page excerpts, and bookmark destinations are handled locally. Optional excerpts can contain personal information present on a page; the extension does not classify it or send it elsewhere. Review the dashboard's current categories against `PRIVACY.md` before submission. Do not claim that the extension handles no user data just because processing is local. [Google explicitly requires local data handling to be disclosed](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).

The extension does not sell or transfer user data to the developer or third parties, use it for unrelated purposes or advertising, or use it for creditworthiness or lending. Chrome may independently sync bookmarks according to the user's browser settings.

## Submission assets and remaining publisher actions

- `dist/tab-navigator-1.6.2.zip`: packaged extension, manifest at archive root.
- `extension/icons/128.png`: application icon, with 16/32/48 px variants in the package.
- `dist/tab-navigator-1.6.2.zip.sha256`: release checksum.
- Capture at least one **1280 × 800** screenshot of the current extension using synthetic browsing data; up to five are allowed. Suggested views: search, selected-tab actions with Restore, and duplicate review. Existing local screenshots are excluded and must not be uploaded. See [Google's graphic asset requirements](https://developer.chrome.com/docs/webstore/cws-dashboard-listing).
- A small 440 × 280 promotional tile and 1400 × 560 marquee are optional. No promotional video is required.
- Complete [developer registration](https://developer.chrome.com/docs/webstore/register), including the developer agreement and one-time fee, and enable two-step verification for the publishing account.
- On the dashboard's **Account** page, set the public contact email to **support@orsini.org**, request verification, and follow the link Google sends to that address. The public contact address is separate from the Google account used to register. See [Google's account setup instructions](https://developer.chrome.com/docs/webstore/set-up-account). Contact-email verification has not yet been completed.
- Review the final permission and data disclosures, upload the ZIP and clean screenshots, and submit for Google's review. No store upload or account registration has been performed.

## Manual release check

After loading the unpacked extension, verify the assigned shortcuts in the actual target Chrome profile, since browser/OS shortcuts and other extensions can take precedence. Confirm tab search and switching on normal pages and internal Chrome pages, with multiple windows. Browser automation supplements but does not replace that final target-profile shortcut check.
