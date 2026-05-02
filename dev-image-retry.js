const retryState = new WeakMap();
const retryDelays = [150, 400, 900, 1600, 2600, 4000, 6000];

function getBaseSrc(img) {
  const src = img.getAttribute('src');

  if (!src) {
    return null;
  }

  const url = new URL(src, window.location.href);
  url.searchParams.delete('__mermaid_retry');

  return `${url.pathname}${url.search}`;
}

function clearRetryTimers(img) {
  const existingState = retryState.get(img);

  if (!existingState) {
    return;
  }

  for (const timerId of existingState.timerIds) {
    window.clearTimeout(timerId);
  }
}

function scheduleRetries(img) {
  const baseSrc = getBaseSrc(img);

  if (!baseSrc) {
    return;
  }

  const existingState = retryState.get(img);
  if (existingState?.baseSrc === baseSrc) {
    return;
  }

  clearRetryTimers(img);

  const timerIds = retryDelays.map((delay, index) =>
    window.setTimeout(() => {
      if (!img.isConnected || getBaseSrc(img) !== baseSrc) {
        return;
      }

      const url = new URL(baseSrc, window.location.href);
      url.searchParams.set('__mermaid_retry', `${index}-${Date.now()}`);
      img.setAttribute('src', `${url.pathname}${url.search}`);
    }, delay)
  );

  retryState.set(img, { baseSrc, timerIds });
}

function collectImages(root) {
  if (!root) {
    return [];
  }

  if (
    root instanceof HTMLImageElement &&
    root.closest('figure.static-mermaid-figure')
  ) {
    return [root];
  }

  if (!(root instanceof Element || root instanceof Document)) {
    return [];
  }

  return Array.from(root.querySelectorAll('figure.static-mermaid-figure img'));
}

function observeMermaidImages() {
  const refreshImages = (root = document) => {
    for (const img of collectImages(root)) {
      scheduleRetries(img);
    }
  };

  refreshImages();

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        refreshImages(mutation.target);
        continue;
      }

      for (const node of mutation.addedNodes) {
        refreshImages(node);
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src'],
  });
}

if (typeof window !== 'undefined' && typeof MutationObserver !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observeMermaidImages, {
      once: true,
    });
  } else {
    observeMermaidImages();
  }
}