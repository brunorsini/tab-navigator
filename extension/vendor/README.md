# Bundled domain parser

`tldts.js` is the self-contained ESM bundle from tldts 7.5.4, licensed under MIT
(see `tldts-LICENSE`). Source: https://github.com/remusao/tldts

It includes the Public Suffix List, including private suffixes, to identify
registered domains correctly without network access. The source-map comment is
removed because the source map is not shipped.

Reproduce from the project root with `npm ci` followed by `npm run vendor`.
The committed bundle is ready to use; installing this extension needs no build.
