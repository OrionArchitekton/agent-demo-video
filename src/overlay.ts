/**
 * overlay.ts — injected fake-cursor/overlay layer
 *
 * Pure module: no imports. Returns JS/CSS strings for injection via
 * Playwright's addInitScript / evaluate. Does NOT import playwright.
 */

export function overlayInitScript(): string {
  return `(() => {
  if (window.__demoCursor) return;

  const FIXED_LAYER = 'position: fixed; pointer-events: none; z-index: 2147483647;';

  // --- Cursor dot ---
  const cursor = document.createElement('div');
  cursor.id = '__demoCursor';
  Object.assign(cursor.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '2147483647',
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    background: 'rgba(255, 80, 80, 0.85)',
    boxShadow: '0 0 6px 2px rgba(255,80,80,0.5)',
    transform: 'translate(-50%, -50%)',
    left: '-40px',
    top: '-40px',
    transition: 'left 0.08s linear, top 0.08s linear',
  });

  // --- Click ripple ---
  const ripple = document.createElement('div');
  ripple.id = '__demoRipple';
  Object.assign(ripple.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '2147483646',
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    border: '3px solid rgba(255,80,80,0.7)',
    transform: 'translate(-50%, -50%) scale(0)',
    left: '-80px',
    top: '-80px',
    opacity: '0',
    transition: 'none',
  });

  // --- Chapter banner ---
  const chapter = document.createElement('div');
  chapter.id = '__demoChapter';
  Object.assign(chapter.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '2147483647',
    bottom: '60px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(0,0,0,0.72)',
    color: '#fff',
    fontFamily: 'Arial, sans-serif',
    fontSize: '22px',
    fontWeight: '600',
    padding: '10px 28px',
    borderRadius: '8px',
    letterSpacing: '0.02em',
    opacity: '0',
    transition: 'opacity 0.25s',
    whiteSpace: 'nowrap',
  });

  // --- Highlight box ---
  const highlight = document.createElement('div');
  highlight.id = '__demoHighlight';
  Object.assign(highlight.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '2147483645',
    border: '3px solid rgba(255, 200, 0, 0.9)',
    borderRadius: '4px',
    boxShadow: '0 0 0 4px rgba(255,200,0,0.18)',
    opacity: '0',
    transition: 'opacity 0.2s',
    boxSizing: 'border-box',
  });

  // Attach elements once body is available.
  // addInitScript runs at document-start before <body> exists, so we must defer.
  function attachOverlay() {
    if (document.body) {
      document.body.appendChild(cursor);
      document.body.appendChild(ripple);
      document.body.appendChild(chapter);
      document.body.appendChild(highlight);
    }
  }
  if (document.body) {
    attachOverlay();
  } else {
    document.addEventListener('DOMContentLoaded', attachOverlay);
  }

  // Store ref on window for guard check
  window.__demoCursor = cursor;

  let _curX = -40, _curY = -40;
  let _chapterTimer = null;

  window.__demoMove = function(x, y) {
    _curX = x; _curY = y;
    cursor.style.left = x + 'px';
    cursor.style.top = y + 'px';
  };

  window.__demoClick = function() {
    ripple.style.transition = 'none';
    ripple.style.left = _curX + 'px';
    ripple.style.top = _curY + 'px';
    ripple.style.transform = 'translate(-50%, -50%) scale(0)';
    ripple.style.opacity = '1';
    // Force reflow
    void ripple.offsetWidth;
    ripple.style.transition = 'transform 0.4s ease-out, opacity 0.4s ease-out';
    ripple.style.transform = 'translate(-50%, -50%) scale(2.5)';
    ripple.style.opacity = '0';
  };

  window.__demoChapter = function(text) {
    if (_chapterTimer) clearTimeout(_chapterTimer);
    chapter.textContent = text;
    chapter.style.opacity = '1';
    _chapterTimer = setTimeout(function() {
      chapter.style.opacity = '0';
      _chapterTimer = null;
    }, 2000);
  };

  window.__demoHighlight = function(selector) {
    const el = document.querySelector(selector);
    if (!el) { highlight.style.opacity = '0'; return; }
    const r = el.getBoundingClientRect();
    highlight.style.left = r.left + 'px';
    highlight.style.top = r.top + 'px';
    highlight.style.width = r.width + 'px';
    highlight.style.height = r.height + 'px';
    highlight.style.opacity = '1';
    setTimeout(function() { highlight.style.opacity = '0'; }, 1500);
  };
})()`;
}

export function moveCursorExpr(x: number, y: number): string {
  return `window.__demoMove(${x}, ${y})`;
}

export function clickExpr(): string {
  return `window.__demoClick()`;
}

export function chapterExpr(text: string): string {
  return `window.__demoChapter(${JSON.stringify(text)})`;
}

export function highlightExpr(selector: string): string {
  return `window.__demoHighlight(${JSON.stringify(selector)})`;
}

/**
 * Init script that injects an arbitrary CSS stylesheet into the captured page.
 * Deferred to DOMContentLoaded when <head> is not yet available (addInitScript
 * runs at document-start). The CSS is JSON-escaped so quotes in the rules
 * cannot break out of the injected script. As a stylesheet it persists and
 * applies to elements React renders later.
 */
export function cssInjectScript(css: string): string {
  return `(() => {
  const __apply = () => {
    if (document.getElementById('__demoCustomCss')) return;
    const s = document.createElement('style');
    s.id = '__demoCustomCss';
    s.textContent = ${JSON.stringify(css)};
    (document.head || document.documentElement).appendChild(s);
  };
  if (document.head) __apply(); else document.addEventListener('DOMContentLoaded', __apply);
})()`;
}
