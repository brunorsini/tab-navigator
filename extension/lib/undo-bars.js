import { UNDO_DURATION, undoExpiry } from './undo-time.js';

// One DOM row and one CSS animation per action; a single timeout removes the
// next expired row. Renders never restart the clock or replace focused buttons.
export function createUndoBars(
  container,
  {
    restore,
    document = container.ownerDocument,
    now = Date.now,
    schedule = setTimeout,
    cancel = clearTimeout,
  } = {},
) {
  const rows = new Map();
  let batches = [],
    disabled = false,
    hidden = false,
    timer;
  function render() {
    cancel(timer);
    const time = now(),
      live = batches.filter((batch) => batch.count > 0 && undoExpiry(batch) > time);
    const ids = new Set(live.map((batch) => batch.id));
    for (const [id, row] of rows)
      if (!ids.has(id)) {
        row.element.remove();
        rows.delete(id);
      }
    for (const batch of live) {
      let row = rows.get(batch.id);
      if (!row) {
        const element = document.createElement('div'),
          label = document.createElement('span');
        const button = document.createElement('button'),
          progress = document.createElement('span');
        element.className = 'undo-bar undo-action';
        element.setAttribute('role', 'listitem');
        button.className = 'text-button';
        button.type = 'button';
        progress.className = 'undo-timer';
        progress.setAttribute('aria-hidden', 'true');
        button.addEventListener('click', () => {
          if (!button.disabled) restore(batch.id);
        });
        element.append(progress, label, button);
        // New actions appear above older ones without moving existing DOM nodes.
        container.prepend(element);
        row = { element, label, button, progress };
        rows.set(batch.id, row);
      }
      const count = batch.count.toLocaleString(),
        noun = batch.count === 1 ? 'tab' : 'tabs';
      const label = `${count} ${noun} closed`,
        buttonLabel = `Restore ${count} ${noun}`;
      if (row.label.textContent !== label) row.label.textContent = label;
      if (row.button.textContent !== buttonLabel) row.button.textContent = buttonLabel;
      row.button.disabled = disabled;
      row.button.title = 'Reopen these tabs · available for one minute after closing';
      const expires = undoExpiry(batch);
      if (row.expires !== expires) {
        if (row.expires != null) {
          const progress = row.progress.cloneNode();
          row.progress.replaceWith(progress);
          row.progress = progress;
        }
        row.expires = expires;
        row.progress.style.animationDuration = `${UNDO_DURATION}ms`;
        row.progress.style.animationDelay = `${Math.min(0, expires - time - UNDO_DURATION)}ms`;
      }
    }
    container.hidden = hidden || !live.length;
    if (live.length)
      timer = schedule(render, Math.max(1, Math.min(...live.map(undoExpiry)) - time + 1));
  }
  return {
    set(value, options = {}) {
      batches = value || [];
      disabled = Boolean(options.disabled);
      hidden = Boolean(options.hidden);
      render();
    },
    dispose() {
      cancel(timer);
    },
  };
}
