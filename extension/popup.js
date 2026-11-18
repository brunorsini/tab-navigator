import { startPopup } from './lib/popup-startup.js';

// The one-shot arrival holds its last drawing until the looping lookout clip is ready.
const mascot = document.querySelector('.search-mascot img');
const motion = document.querySelector('.search-mascot source');
if (mascot && motion) {
  const arrivalUrl = new URL(motion.srcset, document.baseURI).href;
  const arrivalMs = 500;
  let arrivalTimer;
  const playLookoutAfterArrival = () => {
    clearTimeout(arrivalTimer);
    if (mascot.currentSrc === arrivalUrl) {
      arrivalTimer = setTimeout(() => {
        motion.srcset = 'icons/sailor-watch.webp';
      }, arrivalMs);
    }
  };
  const useStill = () => {
    clearTimeout(arrivalTimer);
    motion.remove();
  };
  mascot.addEventListener('load', playLookoutAfterArrival);
  mascot.addEventListener('error', useStill, { once: true });
  if (mascot.complete) {
    if (mascot.naturalWidth) playLookoutAfterArrival();
    else useStill();
  }
}

const build = '1.7.0';
await startPopup({
  document,
  location,
  build,
  requiredIds: [
    'search',
    'results',
    'settings',
    'close-palette',
    'switcher-heading',
    'cancel-preview',
    'switcher-instructions',
    'switcher-finish',
    'selection-shortcut',
    'clear',
    'search-shortcut',
    'tabs-filter',
    'history-filter',
    'tab-count',
    'domain-filter',
    'window-filter',
    'select-all',
    'duplicates',
    'selection-count',
    'clear-selection',
    'bulk-bar',
    'close-tabs',
    'group-tabs',
    'bookmark-tabs',
    'split-tabs',
    'split-hint',
    'result-label',
    'order-hint',
    'empty',
    'empty-title',
    'empty-message',
    'notice',
    'current-tab-notice',
    'result-total',
    'enter-label',
    'bookmark-resume-bar',
    'bookmark-resume-label',
    'bookmark-resume',
    'bookmark-dismiss',
    'undo-bars',
    'action-panel',
    'action-title',
    'action-description',
    'destination-label',
    'destination',
    'new-name-label',
    'new-name',
    'action-error',
    'action-cancel',
    'action-confirm',
  ],
  load: () => import(`./palette.js?ui=${build}`),
});
