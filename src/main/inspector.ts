import { BrowserWindow, ipcMain } from 'electron'
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Inspector overlay code — injected into the preview iframe via
 * WebFrameMain.executeJavaScript(). Self-contained IIFE combining
 * fiber-walker, style-extractor, and overlay UI.
 *
 * Key improvement: extracts RICH context (real component name, file/line,
 * text content, props, parent chain) so Claude can act immediately
 * without searching or taking screenshots.
 */
const OVERLAY_JS = `(function() {
  // Remove old overlay on re-injection (code updates)
  var old = document.getElementById('__claude_inspector__');
  if (old) { old.remove(); }
  var oldStyle = document.getElementById('__claude_inspector_style__');
  if (oldStyle) { oldStyle.remove(); }

  // ── Fiber Walker (enhanced) ────────────────────────────────────
  function getFiberFromDOM(el) {
    var key = Object.keys(el).find(function(k) {
      return k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance');
    });
    return key ? el[key] : null;
  }

  // Walk the React fiber tree to extract comprehensive component info.
  // Returns: { name, chain, source, props }
  function getComponentInfo(el) {
    var fiber = getFiberFromDOM(el);
    var result = { name: el.tagName.toLowerCase(), chain: [], source: null, props: {} };
    if (!fiber) return result;

    var foundComponent = false;
    var current = fiber;
    while (current && result.chain.length < 8) {
      var isComponent = typeof current.type === 'function' ||
        (typeof current.type === 'object' && current.type !== null);

      if (isComponent) {
        var compName = current.type && (current.type.displayName || current.type.name);
        // Skip unnamed wrappers, fragments, internal React components
        if (compName && compName !== 'Fragment' && compName.charAt(0) !== '_') {
          if (!foundComponent) {
            result.name = compName;
            foundComponent = true;
            // Extract serializable props (skip React internals)
            if (current.memoizedProps) {
              var skip = { children:1, key:1, ref:1, __source:1, __self:1, style:1 };
              for (var k in current.memoizedProps) {
                if (skip[k]) continue;
                var v = current.memoizedProps[k];
                if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
                  result.props[k] = v;
                }
              }
            }
          }
          result.chain.push(compName);
        }
      }

      // Capture source info from the nearest fiber that has it
      if (!result.source && current._debugSource) {
        result.source = {
          fileName: current._debugSource.fileName,
          lineNumber: current._debugSource.lineNumber,
          columnNumber: current._debugSource.columnNumber
        };
      }

      current = current.return;
    }

    return result;
  }

  // Get visible text content (direct children first, then fallback)
  function getTextContent(el) {
    var direct = '';
    for (var i = 0; i < el.childNodes.length; i++) {
      if (el.childNodes[i].nodeType === 3) direct += el.childNodes[i].textContent;
    }
    direct = direct.trim();
    if (direct) return direct.substring(0, 120);
    // Fallback: all nested text
    var all = (el.textContent || '').trim();
    return all.substring(0, 120);
  }

  // ── Accessibility Info Extractor ──────────────────────────────
  // Inspired by Cursor's selector tool: use a11y tree for stable,
  // semantic element identification (role + accessible name + state).
  function getA11yInfo(el) {
    var info = {};

    // Compute accessible role
    var role = el.getAttribute('role');
    if (!role) {
      var roleMap = {
        A: 'link', BUTTON: 'button', INPUT: 'textbox', SELECT: 'combobox',
        TEXTAREA: 'textbox', IMG: 'img', H1: 'heading', H2: 'heading',
        H3: 'heading', H4: 'heading', H5: 'heading', H6: 'heading',
        NAV: 'navigation', MAIN: 'main', ASIDE: 'complementary',
        FOOTER: 'contentinfo', HEADER: 'banner', FORM: 'form',
        TABLE: 'table', UL: 'list', OL: 'list', LI: 'listitem'
      };
      // Refine INPUT types
      if (el.tagName === 'INPUT') {
        var t = el.type;
        if (t === 'checkbox') role = 'checkbox';
        else if (t === 'radio') role = 'radio';
        else if (t === 'range') role = 'slider';
        else if (t === 'submit' || t === 'button') role = 'button';
        else role = 'textbox';
      } else {
        role = roleMap[el.tagName] || null;
      }
    }
    if (role) info.role = role;

    // Compute accessible name (label)
    var name = el.getAttribute('aria-label')
      || el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.textContent
      || el.getAttribute('title')
      || el.getAttribute('alt')
      || el.getAttribute('placeholder');
    // For inputs, check associated label
    if (!name && el.id) {
      var label = document.querySelector('label[for="' + el.id + '"]');
      if (label) name = label.textContent.trim();
    }
    // Fallback: direct text content for buttons/links
    if (!name && (el.tagName === 'BUTTON' || el.tagName === 'A')) {
      name = el.textContent.trim().substring(0, 60);
    }
    if (name) info.name = name;

    // Capture key states
    if (el.disabled) info.disabled = true;
    if (el.checked) info.checked = true;
    if (el.getAttribute('aria-expanded')) info.expanded = el.getAttribute('aria-expanded') === 'true';
    if (el.getAttribute('aria-selected')) info.selected = el.getAttribute('aria-selected') === 'true';
    if (el.value !== undefined && el.value !== '') info.value = String(el.value).substring(0, 60);

    return info;
  }

  // ── Style Extractor ────────────────────────────────────────────
  var STYLE_KEYS = [
    'display','position','width','height','padding','margin',
    'backgroundColor','color','fontSize','fontWeight','borderRadius','border',
    'gap','flexDirection','justifyContent','alignItems'
  ];

  function extractStyles(el) {
    var computed = getComputedStyle(el);
    var styles = {};
    STYLE_KEYS.forEach(function(key) {
      var val = computed.getPropertyValue(key.replace(/([A-Z])/g, '-$1').toLowerCase());
      if (val && val !== 'none' && val !== 'normal' && val !== '0px' && val !== 'auto'
          && val !== 'static' && val !== 'visible' && val !== 'start') {
        styles[key] = val;
      }
    });
    return styles;
  }

  // ── Inspector Overlay UI ───────────────────────────────────────
  var active = false;
  var currentElement = null;

  // Inject pulse animation
  var styleEl = document.createElement('style');
  styleEl.id = '__claude_inspector_style__';
  styleEl.textContent = '@keyframes __ci_pulse{0%,100%{border-color:rgba(74,234,255,0.8)}50%{border-color:rgba(74,234,255,0.3)}}';
  document.head.appendChild(styleEl);

  var container = document.createElement('div');
  container.id = '__claude_inspector__';
  container.style.cssText =
    'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:999999;';
  document.body.appendChild(container);

  // Hover highlight (visible only during inspector mode)
  var highlight = document.createElement('div');
  highlight.style.cssText =
    'position:fixed;pointer-events:none;transition:all 0.1s ease;' +
    'border:2px solid #4AEAFF;background:rgba(74,234,255,0.08);border-radius:2px;display:none;';
  container.appendChild(highlight);

  var tooltip = document.createElement('div');
  tooltip.style.cssText =
    'position:fixed;pointer-events:none;background:rgba(10,15,26,0.95);' +
    'color:#C8D6E5;padding:6px 10px;font-size:11px;border-radius:4px;' +
    "font-family:'JetBrains Mono',monospace;display:none;white-space:nowrap;" +
    'border:1px solid rgba(74,234,255,0.3);max-width:500px;overflow:hidden;text-overflow:ellipsis;';
  container.appendChild(tooltip);

  // ── Multi-element persistent highlights ─────────────────────
  var persistHighlights = []; // Array of {el, persist, label}

  var PERSIST_STYLE = 'position:fixed;pointer-events:none;border:2px solid rgba(74,234,255,0.8);' +
    'border-radius:3px;animation:__ci_pulse 2s ease-in-out infinite;' +
    'box-shadow:0 0 8px rgba(74,234,255,0.15);';

  var LABEL_STYLE = 'position:fixed;pointer-events:none;background:rgba(74,234,255,0.9);' +
    'color:#0A0F1A;padding:2px 6px;font-size:9px;border-radius:2px;' +
    "font-family:'JetBrains Mono',monospace;font-weight:600;letter-spacing:0.5px;";

  function addPersistHighlight(el, name) {
    var index = persistHighlights.length + 1;

    var p = document.createElement('div');
    p.style.cssText = PERSIST_STYLE;
    container.appendChild(p);

    var lbl = document.createElement('div');
    lbl.style.cssText = LABEL_STYLE;
    lbl.textContent = index + '. ' + (name || 'selected');
    container.appendChild(lbl);

    var entry = { el: el, persist: p, label: lbl };
    persistHighlights.push(entry);
    updateOnePersistPosition(entry);
  }

  function clearAllPersistHighlights() {
    persistHighlights.forEach(function(h) {
      h.persist.remove();
      h.label.remove();
    });
    persistHighlights = [];
  }

  function fadeAllPersistHighlights() {
    if (persistHighlights.length === 0) return;
    persistHighlights.forEach(function(h) {
      h.persist.style.transition = 'opacity 0.6s ease';
      h.persist.style.opacity = '0';
      h.label.style.transition = 'opacity 0.6s ease';
      h.label.style.opacity = '0';
    });
    setTimeout(clearAllPersistHighlights, 600);
  }

  function updateOnePersistPosition(h) {
    if (!h.el || !document.body.contains(h.el)) return false;
    var rect = h.el.getBoundingClientRect();
    h.persist.style.top = rect.top + 'px';
    h.persist.style.left = rect.left + 'px';
    h.persist.style.width = rect.width + 'px';
    h.persist.style.height = rect.height + 'px';
    var labelTop = rect.top - 16;
    if (labelTop < 2) labelTop = rect.bottom + 2;
    h.label.style.top = labelTop + 'px';
    h.label.style.left = rect.left + 'px';
    return true;
  }

  function updateAllPersistPositions() {
    persistHighlights = persistHighlights.filter(function(h) {
      if (!updateOnePersistPosition(h)) {
        h.persist.remove();
        h.label.remove();
        return false;
      }
      return true;
    });
  }

  function hideHighlight() {
    highlight.style.display = 'none';
    tooltip.style.display = 'none';
    currentElement = null;
    document.body.style.cursor = '';
  }

  // Update persistent highlight positions on scroll/resize/HMR reflows
  var rafPending = false;
  function scheduleUpdate() {
    if (rafPending || persistHighlights.length === 0) return;
    rafPending = true;
    requestAnimationFrame(function() { rafPending = false; updateAllPersistPositions(); });
  }
  window.addEventListener('scroll', scheduleUpdate, true);
  window.addEventListener('resize', scheduleUpdate);

  // MutationObserver: reposition only (fadeout is triggered by renderer via postMessage)
  new MutationObserver(scheduleUpdate).observe(document.body, { childList: true, subtree: true, attributes: true });

  function showHighlight(el) {
    var rect = el.getBoundingClientRect();
    highlight.style.top = rect.top + 'px';
    highlight.style.left = rect.left + 'px';
    highlight.style.width = rect.width + 'px';
    highlight.style.height = rect.height + 'px';
    highlight.style.display = 'block';

    var info = getComponentInfo(el);
    var tag = el.tagName.toLowerCase();
    var label = info.name !== tag ? '<' + tag + '> ' + info.name : '<' + tag + '>';
    if (info.source) label += ' (' + info.source.fileName.split('/').pop() + ':' + info.source.lineNumber + ')';
    var text = getTextContent(el);
    if (text) label += ' "' + text.substring(0, 40) + '"';
    tooltip.textContent = label;

    var tooltipTop = rect.top - 28;
    if (tooltipTop < 4) tooltipTop = rect.bottom + 4;
    tooltip.style.top = tooltipTop + 'px';
    tooltip.style.left = rect.left + 'px';
    tooltip.style.display = 'block';

    document.body.style.cursor = 'crosshair';
  }

  document.addEventListener('mousemove', function(e) {
    if (!active) return;
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el.id === '__claude_inspector__' || container.contains(el)) return;
    if (el === currentElement) return;
    currentElement = el;
    showHighlight(el);
  }, true);

  // Hide hover highlight when cursor leaves the iframe
  document.addEventListener('mouseleave', function() {
    if (!active) return;
    hideHighlight();
  });

  document.addEventListener('click', function(e) {
    if (!active) return;
    e.preventDefault();
    e.stopPropagation();

    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || container.contains(el)) return;

    var rect = el.getBoundingClientRect();
    var info = getComponentInfo(el);
    var styles = extractStyles(el);
    var textContent = getTextContent(el);
    var a11y = getA11yInfo(el);

    // Add persistent highlight on the clicked element (multi-select: each click adds)
    var displayName = a11y.role && a11y.name
      ? a11y.role + ' "' + a11y.name.substring(0, 30) + '"'
      : info.name;
    addPersistHighlight(el, displayName);

    window.parent.postMessage({
      type: 'inspector:elementSelected',
      element: {
        tagName: el.tagName.toLowerCase(),
        id: el.id || undefined,
        className: (typeof el.className === 'string') ? el.className : undefined,
        componentName: info.name,
        componentChain: info.chain,
        sourceFile: info.source ? info.source.fileName : undefined,
        sourceLine: info.source ? info.source.lineNumber : undefined,
        props: info.props,
        textContent: textContent,
        styles: styles,
        a11y: a11y,
        rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        html: el.outerHTML.substring(0, 500)
      }
    }, '*');
  }, true);

  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'inspector:activate') active = true;
    if (e.data && e.data.type === 'inspector:deactivate') {
      active = false;
      hideHighlight();
      // Persistent highlight stays — it outlives inspector mode
    }
    if (e.data && e.data.type === 'inspector:clearHighlight') {
      clearAllPersistHighlights();
    }
    if (e.data && e.data.type === 'inspector:fadeHighlight') {
      fadeAllPersistHighlights();
    }
  });

  // ── Error Capture ───────────────────────────────────────────
  var errorBuffer = [];
  var MAX_ERRORS = 20;

  function postError(err) {
    if (errorBuffer.length >= MAX_ERRORS) errorBuffer.shift();
    errorBuffer.push(err);
    window.parent.postMessage({ type: 'inspector:runtimeError', error: err }, '*');
  }

  window.onerror = function(message, source, lineno, colno) {
    postError({
      message: String(message),
      file: source ? source.split('/').pop() : null,
      line: lineno || null,
      column: colno || null
    });
  };

  window.addEventListener('unhandledrejection', function(e) {
    var msg = e.reason && e.reason.message ? e.reason.message : String(e.reason);
    postError({ message: 'Unhandled Promise: ' + msg, file: null, line: null, column: null });
  });

  var origConsoleError = console.error;
  console.error = function() {
    origConsoleError.apply(console, arguments);
    var parts = [];
    for (var i = 0; i < arguments.length; i++) {
      var a = arguments[i];
      parts.push(a instanceof Error ? a.message : String(a));
    }
    postError({ message: parts.join(' '), file: null, line: null, column: null });
  };
})();`

export function setupInspectorHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('inspector:inject', async () => {
    const win = getWindow()
    if (!win) return { success: false, error: 'No window' }

    const frames = win.webContents.mainFrame.frames
    // Prefer matching by frame name (set on canvas iframe) for precise targeting
    const iframeFrame = frames.find((f) => {
      try {
        if (f.name === 'claude-canvas-preview') return true
        return f.url.startsWith('http://localhost') || f.url.startsWith('http://127.0.0.1')
      } catch {
        return false
      }
    })

    if (!iframeFrame) {
      return { success: false, error: 'No iframe frame found' }
    }

    try {
      await iframeFrame.executeJavaScript(OVERLAY_JS)
      return { success: true }
    } catch (err) {
      console.error('Inspector injection failed:', err)
      return { success: false, error: String(err) }
    }
  })

  // Find a component's source file by name when _debugSource isn't available
  ipcMain.handle(
    'inspector:findFile',
    async (_event, componentName: string, projectPath: string) => {
      if (!componentName || !projectPath) return null
      const extensions = ['.jsx', '.tsx', '.js', '.ts']
      const result = findFileRecursive(projectPath, componentName, extensions, 0)
      return result ? relative(projectPath, result) : null
    }
  )
}

/**
 * Recursively search for a file matching componentName.{jsx,tsx,js,ts}
 * in src/ directory. Max depth 6 to avoid node_modules etc.
 */
function findFileRecursive(
  dir: string,
  name: string,
  exts: string[],
  depth: number
): string | null {
  if (depth > 6) return null
  const base = depth === 0 ? join(dir, 'src') : dir

  try {
    const entries = readdirSync(base)
    // Check files first (breadth-first)
    for (const entry of entries) {
      for (const ext of exts) {
        if (entry === name + ext) {
          return join(base, entry)
        }
      }
    }
    // Then recurse into subdirectories
    for (const entry of entries) {
      if (entry.startsWith('.') || entry === 'node_modules') continue
      const full = join(base, entry)
      try {
        if (statSync(full).isDirectory()) {
          const found = findFileRecursive(full, name, exts, depth + 1)
          if (found) return found
        }
      } catch {
        // Permission errors etc
      }
    }
  } catch {
    // Directory doesn't exist
  }
  return null
}
