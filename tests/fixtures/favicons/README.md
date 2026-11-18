# Favicon test fixtures

These small, unmodified website icons are used only by controlled browser-test pages to exercise Chrome's real favicon cache. They are not included in the extension package. Website names and logos belong to their respective owners and are not covered by the project's MIT license. Their inclusion does not imply affiliation or endorsement.

Sources retrieved on 2026-11-16:

- YouTube: https://www.youtube.com/favicon.ico
- GitHub: https://github.com/favicon.ico
- Spotify: https://open.spotify.com/favicon.ico
- Notion: https://www.notion.so/front-static/favicon.ico
- Chrome Developers: https://www.gstatic.com/devrel-devsite/prod/v579d635a54d6e1f40caad46ce407560c5106c8915e5ff7e6341f5b13eb245c5a/chrome/images/favicon.png
- Figma: https://www.figma.com/favicon.ico

Tests serve these bytes as the pages' declared favicons, then assert that the extension receives distinct cached images through its local `_favicon` endpoint. The browser tests require no network connection to these websites.
