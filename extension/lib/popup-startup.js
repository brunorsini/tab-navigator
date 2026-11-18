// An unpacked update can leave an older popup document beside newer scripts.
// Repair that mismatch before any page-specific listeners are registered.
export async function startPopup({ document, location, build, requiredIds, load }) {
  const matches =
    document.documentElement.dataset.paletteBuild === build &&
    requiredIds.every((id) => document.getElementById(id));
  if (!matches) {
    const next = new URL(location.href);
    if (next.searchParams.get('repaired') !== build) {
      next.searchParams.set('ui', build);
      next.searchParams.set('repaired', build);
      location.replace(next.href);
      return 'reloading';
    }
    recovery(document, location);
    return 'incompatible';
  }
  try {
    await load();
    return 'ready';
  } catch {
    recovery(document, location);
    return 'failed';
  }
}

function recovery(document, location) {
  const section = document.createElement('section');
  section.className = 'startup-recovery';
  const title = document.createElement('h1');
  title.textContent = 'Let’s reopen Tab Navigator.';
  const detail = document.createElement('p');
  detail.textContent =
    'This window could not finish opening. Try again. If it happens again, reload Tab Navigator in Chrome’s Extensions page.';
  const retry = document.createElement('button');
  retry.className = 'text-button';
  retry.textContent = 'Try again';
  retry.addEventListener('click', () => location.reload());
  const close = document.createElement('button');
  close.className = 'text-button';
  close.textContent = 'Close';
  close.addEventListener('click', () => document.defaultView.close());
  section.append(title, detail, retry, close);
  document.body.replaceChildren(section);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') document.defaultView.close();
  });
  retry.focus();
}
