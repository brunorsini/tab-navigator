(() => {
  if (globalThis.__relayContext) {
    globalThis.__relayContext.capture();
    return;
  }
  let stopped = false,
    timer,
    last = 0,
    generation = 0;
  const clean = (value) =>
    String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
  const excluded =
    'script,style,noscript,input,textarea,select,[contenteditable]:not([contenteditable="false"]),[hidden],[aria-hidden="true"],[data-relay-private]';
  function capture() {
    clearTimeout(timer);
    if (stopped || document.visibilityState !== 'visible') return;
    if (Date.now() - last < 5000) {
      timer = setTimeout(capture, 5000 - (Date.now() - last));
      return;
    }
    last = Date.now();
    const root = document.body;
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || parent.closest(excluded) || !node.textContent.trim())
          return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let text = '',
      count = 0,
      spent = 0;
    const token = ++generation,
      url = location.href;
    const headings = [...root.querySelectorAll('h1,h2,h3')]
      .slice(0, 24)
      .filter((node) => !node.closest(excluded))
      .map((node) => clean(node.textContent))
      .join(' · ')
      .slice(0, 1800);
    const description =
      document.querySelector('meta[name="description"],meta[property="og:description"]')?.content ||
      '';
    // Scan loaded page text in short idle slices, including text near the end of articles.
    // Never block input for a full-document scan or index unbounded infinite feeds.
    const defer = (callback) =>
      window.requestIdleCallback
        ? window.requestIdleCallback(callback, { timeout: 1200 })
        : setTimeout(callback, 16);
    function slice() {
      if (
        stopped ||
        token !== generation ||
        location.href !== url ||
        document.visibilityState !== 'visible'
      )
        return;
      const start = performance.now();
      let exhausted = false;
      while (
        performance.now() - start < 4 &&
        text.length < 200000 &&
        count < 12000 &&
        spent < 200
      ) {
        const node = walker.nextNode();
        if (!node) {
          exhausted = true;
          break;
        }
        count++;
        text += ' ' + clean(node.textContent).slice(0, 200000 - text.length);
      }
      spent += performance.now() - start;
      if (!exhausted && text.length < 200000 && count < 12000 && spent < 200) {
        defer(slice);
        return;
      }
      chrome.runtime
        .sendMessage({
          type: 'context',
          url,
          description,
          headings,
          text: text.slice(0, 200000),
          truncated: !exhausted,
        })
        .catch(stop);
    }
    defer(slice);
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(capture, 700);
  }
  const observer = new MutationObserver(schedule);
  // Observe title changes for single-page navigation, not every body mutation.
  const title = document.querySelector('title');
  if (title) observer.observe(title, { childList: true, subtree: true, characterData: true });
  function onMessage(message) {
    if (message.type === 'stop-context') stop();
  }
  function stop() {
    stopped = true;
    generation++;
    clearTimeout(timer);
    observer.disconnect();
    document.removeEventListener('visibilitychange', capture);
    window.removeEventListener('popstate', schedule);
    window.removeEventListener('hashchange', schedule);
    chrome.runtime.onMessage.removeListener(onMessage);
    delete globalThis.__relayContext;
  }
  document.addEventListener('visibilitychange', capture);
  window.addEventListener('popstate', schedule);
  window.addEventListener('hashchange', schedule);
  chrome.runtime.onMessage.addListener(onMessage);
  globalThis.__relayContext = { capture };
  schedule();
})();
