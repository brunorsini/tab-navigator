# Contributing to Tab Navigator

Keep the extension focused on two jobs: finding a tab or history result and moving through recently used tabs. Favor simple text lists, native browser APIs, and bounded local work.

## Local setup

Use Node.js 22 or later for development. No build step or dependency installation is required to load `extension/` in Chrome. The local tldts domain parser is bundled in `extension/vendor`; after an intentional dependency update, regenerate it with `npm run vendor` and retain its license.

```sh
npm ci --ignore-scripts
npm run check
npm run package
```

CI runs formatting, release checks, unit tests, the dependency audit, and packaging. Use `npm run format` to format first-party code. Add new runtime files to `scripts/release-files.json` deliberately; packaging rejects unlisted files and symbolic links.

Optional browser tests can be run with `npx playwright install chromium` followed by `npm run test:browser` in an environment that permits browser automation. They use disposable profiles and synthetic test tabs. Page-text tests pregrant website access in a temporary copy; the shipped manifest keeps it optional. These tests are not part of the CI gate and are not a claim of current visual verification. Native OS shortcuts, Keyboard Maestro routing, split-view compatibility, and permission dialogs need manual checks in the target browser.

## Changes

- Keep page contents, history, and search terms on the device.
- Preserve service-worker restart recovery and deterministic recent-tab order.
- Add regression tests for behavioral bugs. Run the relevant tests for changed behavior.
- Include real screenshots for visible changes, with controlled test tabs rather than personal browsing information.
- Keep `PRIVACY.md` and `CHROMEWEBSTORE.md` consistent with requested permissions and retention.
- Do not add a framework, AI model, background polling, thumbnails, or remote service without first establishing why the two core jobs need it.

When reporting a bug, include Chrome version, operating system, reproduction steps, and whether another extension or keyboard tool uses the same shortcut. Avoid sharing private URLs or page contents.

Contributions are licensed under the project's MIT license.

## Before publishing

Inspect `git diff --cached` and the complete staged file list. Never commit personal screenshots, browser data, local assistant instructions, credentials, or absolute home-directory paths. Keep private email addresses out of commit metadata by configuring Git's author email appropriately.

Scan both the staged export and the unpacked release with a secret scanner, and run `npm audit`. The included Gitleaks configuration extends the default rules and only exempts three literal Chrome keyboard combinations in the browser-test assertions. Review the source for personal examples; a credential scanner alone does not detect those. Verify the release checksum after upload. Store screenshots must show real current UI using synthetic browsing data.
