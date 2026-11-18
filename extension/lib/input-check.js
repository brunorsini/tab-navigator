// Executed on demand in isolated page worlds. Only status flags leave the page;
// never return field values, editor contents, filenames, or passwords.
export function inspectPageInputs() {
  const start = performance.now();
  let visited = 0,
    frames = 0,
    uncertain = false;
  const roots = [document];
  const result = (status, reason) => ({ status, reason, url: location.href, frames });
  while (roots.length) {
    const walker = document.createTreeWalker(roots.pop(), NodeFilter.SHOW_ELEMENT);
    let el;
    while ((el = walker.nextNode())) {
      if (++visited > 12000 || performance.now() - start > 16)
        return result('unknown', 'This page exceeded the quick-check limit.');
      const tag = el.localName;
      if (tag === 'iframe' || tag === 'frame') frames++;
      if (el.shadowRoot) roots.push(el.shadowRoot);
      if (el.disabled || el.readOnly) continue;
      if (tag === 'input') {
        if (['hidden', 'submit', 'reset', 'button', 'image'].includes(el.type)) continue;
        if (el.type === 'file' && el.files?.length)
          return result('possible', 'A file is selected on this page.');
        if (['checkbox', 'radio'].includes(el.type)) {
          if (el.checked !== el.defaultChecked)
            return result('possible', 'A form choice differs from its initial value.');
        } else if (el.type === 'password' ? Boolean(el.value) : el.value !== el.defaultValue) {
          return result('possible', 'A form field may contain unsaved input.');
        }
      } else if (tag === 'textarea' && el.value !== el.defaultValue) {
        return result('possible', 'A text field may contain unsaved input.');
      } else if (tag === 'select') {
        if (el.options.length > 1000)
          return result('unknown', 'This form exceeded the quick-check limit.');
        const options = [...el.options];
        // A single-select with no explicit default selects its first option.
        const implicit = !el.multiple && !options.some((option) => option.defaultSelected);
        if (
          options.some(
            (option, i) => option.selected !== (option.defaultSelected || (implicit && i === 0)),
          )
        ) {
          return result('possible', 'A form choice differs from its initial value.');
        }
      } else if (el.isContentEditable && !el.parentElement?.isContentEditable) {
        // Content may already be saved: a populated editor is a reason to review,
        // not proof of unsaved work. Do not read or serialize its full contents.
        if (el.hasChildNodes())
          return result('possible', 'This page contains an editable document.');
      }
      if (
        tag === 'canvas' ||
        (el.getAttribute('role') === 'textbox' && !['input', 'textarea'].includes(tag))
      )
        uncertain = true;
    }
  }
  return uncertain
    ? result('unknown', 'A custom editor or canvas cannot be checked reliably.')
    : result('clear', 'No changed standard fields detected. Custom app state may still exist.');
}

export async function checkTabInput(api, tab) {
  const unknown = (reason) => ({ status: 'unknown', reason });
  if (tab.discarded || tab.frozen) return unknown('Sleeping tab — left asleep.');
  if ((tab.pendingUrl && tab.pendingUrl !== tab.url) || tab.status === 'loading')
    return unknown('This tab is navigating or loading.');
  if (!/^https?:\/\//.test(tab.url || ''))
    return unknown('Chrome does not allow this page to be checked.');
  const origin = `${new URL(tab.url).origin}/*`;
  if (!api.scripting || !(await api.permissions.contains({ origins: [origin] }).catch(() => false)))
    return unknown('Website access has not been granted.');
  let timer;
  try {
    const responses = await Promise.race([
      api.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: inspectPageInputs,
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('timeout')), 1800);
      }),
    ]);
    const main = responses.find((row) => row.frameId === 0)?.result;
    if (!main || main.url !== tab.url) return unknown('The page changed during its check.');
    const signals = responses.map((row) => row.result).filter(Boolean);
    const possible = signals.find((row) => row.status === 'possible');
    if (possible) return { status: 'possible', reason: possible.reason };
    if (signals.length < 1 + signals.reduce((n, row) => n + (row.frames || 0), 0))
      return unknown('Some embedded frames could not be checked.');
    const uncertain = signals.find((row) => row.status !== 'clear');
    return uncertain ? unknown(uncertain.reason) : { status: 'clear', reason: main.reason };
  } catch {
    return unknown('This page could not be checked.');
  } finally {
    clearTimeout(timer);
  }
}

export async function checkTabsInput(api, tabs) {
  const results = new Array(tabs.length);
  const deadline = Date.now() + 8000;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, tabs.length) }, async () => {
      while (next < tabs.length) {
        const index = next++;
        results[index] = {
          ...tabs[index],
          check:
            Date.now() > deadline
              ? {
                  status: 'unknown',
                  reason: 'The batch reached its quick-check limit. Review this tab separately.',
                }
              : await checkTabInput(api, tabs[index]),
        };
      }
    }),
  );
  return results;
}
