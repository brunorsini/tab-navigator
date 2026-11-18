# Artwork

The project uses two supplied illustrations:

- `schnauzer-sailor.png`: the mascot used in the search field and extension pages.
- `spyglass-toolbar.png`: the simpler icon used in Chrome's toolbar.

Sized PNG variants are included in `extension/icons/`. Published images contain pixel and color data only; descriptive metadata is removed. Older artwork and local design files are not part of the repository or release.

The search popup plays two transparent animated WebP clips from `extension/icons/`. The sailor pops into view in `sailor-arrival.webp`, then searches through his telescope in `sailor-watch.webp`. Only the second clip loops. Both display at 44 × 44 CSS pixels. With reduced motion enabled, the popup shows the still PNG.
