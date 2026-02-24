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

  // ── Clean up old mouse/keyboard listeners from previous injection ──
  if (window.__ciMouseMoveHandler) {
    document.removeEventListener('mousemove', window.__ciMouseMoveHandler, true);
  }
  if (window.__ciClickHandler) {
    document.removeEventListener('click', window.__ciClickHandler, true);
  }
  if (window.__ciMouseLeaveHandler) {
    document.removeEventListener('mouseleave', window.__ciMouseLeaveHandler);
  }
  if (window.__ciMutationObserver) {
    window.__ciMutationObserver.disconnect();
  }
  if (window.__ciScrollHandler) {
    window.removeEventListener('scroll', window.__ciScrollHandler, true);
    window.removeEventListener('resize', window.__ciScrollHandler);
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

  // ── Layout Visualization Container ────────────────────────────
  // Holds all layout overlay elements: box model, flex/grid indicators
  var layoutContainer = document.createElement('div');
  layoutContainer.id = '__claude_layout_overlay';
  layoutContainer.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:999998;';
  container.appendChild(layoutContainer);

  // Common label style for box-model pixel values and layout info
  var LAYOUT_LABEL_STYLE = "position:fixed;pointer-events:none;background:rgba(0,0,0,0.75);color:#4AEAFF;font-size:10px;padding:1px 4px;border-radius:2px;font-family:'JetBrains Mono',monospace;white-space:nowrap;z-index:999999;";

  // Dynamic elements created per hover — tracked for cleanup
  var layoutElements = [];

  function clearLayoutElements() {
    layoutElements.forEach(function(el) { el.remove(); });
    layoutElements = [];
  }

  function createLayoutDiv(css) {
    var d = document.createElement('div');
    d.style.cssText = css;
    layoutContainer.appendChild(d);
    layoutElements.push(d);
    return d;
  }

  function createLayoutLabel(text, top, left) {
    var lbl = createLayoutDiv(LAYOUT_LABEL_STYLE);
    lbl.textContent = text;
    lbl.style.top = top + 'px';
    lbl.style.left = left + 'px';
    return lbl;
  }

  // ── Box Model Overlay (shown for ALL elements) ──────────────
  function showBoxModelOverlay(el, computed, rect) {
    var mt = parseFloat(computed.marginTop) || 0;
    var mr = parseFloat(computed.marginRight) || 0;
    var mb = parseFloat(computed.marginBottom) || 0;
    var ml = parseFloat(computed.marginLeft) || 0;

    var pt = parseFloat(computed.paddingTop) || 0;
    var pr = parseFloat(computed.paddingRight) || 0;
    var pb = parseFloat(computed.paddingBottom) || 0;
    var pl = parseFloat(computed.paddingLeft) || 0;

    var hasMargin = mt || mr || mb || ml;
    var hasPadding = pt || pr || pb || pl;

    // Margin area — orange semi-transparent outer region
    if (hasMargin) {
      // Top margin strip
      if (mt > 0) {
        createLayoutDiv('position:fixed;pointer-events:none;background:rgba(255,155,0,0.15);' +
          'top:' + (rect.top - mt) + 'px;left:' + (rect.left - ml) + 'px;' +
          'width:' + (rect.width + ml + mr) + 'px;height:' + mt + 'px;');
      }
      // Bottom margin strip
      if (mb > 0) {
        createLayoutDiv('position:fixed;pointer-events:none;background:rgba(255,155,0,0.15);' +
          'top:' + rect.bottom + 'px;left:' + (rect.left - ml) + 'px;' +
          'width:' + (rect.width + ml + mr) + 'px;height:' + mb + 'px;');
      }
      // Left margin strip
      if (ml > 0) {
        createLayoutDiv('position:fixed;pointer-events:none;background:rgba(255,155,0,0.15);' +
          'top:' + rect.top + 'px;left:' + (rect.left - ml) + 'px;' +
          'width:' + ml + 'px;height:' + rect.height + 'px;');
      }
      // Right margin strip
      if (mr > 0) {
        createLayoutDiv('position:fixed;pointer-events:none;background:rgba(255,155,0,0.15);' +
          'top:' + rect.top + 'px;left:' + rect.right + 'px;' +
          'width:' + mr + 'px;height:' + rect.height + 'px;');
      }

      // Margin pixel labels (show non-zero values)
      if (mt > 0) createLayoutLabel(Math.round(mt) + '', rect.top - mt / 2 - 6, rect.left + rect.width / 2 - 8);
      if (mb > 0) createLayoutLabel(Math.round(mb) + '', rect.bottom + mb / 2 - 6, rect.left + rect.width / 2 - 8);
      if (ml > 0) createLayoutLabel(Math.round(ml) + '', rect.top + rect.height / 2 - 6, rect.left - ml / 2 - 8);
      if (mr > 0) createLayoutLabel(Math.round(mr) + '', rect.top + rect.height / 2 - 6, rect.right + mr / 2 - 8);
    }

    // Padding area — green semi-transparent inner region
    if (hasPadding) {
      // Top padding strip
      if (pt > 0) {
        createLayoutDiv('position:fixed;pointer-events:none;background:rgba(0,200,100,0.15);' +
          'top:' + rect.top + 'px;left:' + rect.left + 'px;' +
          'width:' + rect.width + 'px;height:' + pt + 'px;');
      }
      // Bottom padding strip
      if (pb > 0) {
        createLayoutDiv('position:fixed;pointer-events:none;background:rgba(0,200,100,0.15);' +
          'top:' + (rect.bottom - pb) + 'px;left:' + rect.left + 'px;' +
          'width:' + rect.width + 'px;height:' + pb + 'px;');
      }
      // Left padding strip
      if (pl > 0) {
        createLayoutDiv('position:fixed;pointer-events:none;background:rgba(0,200,100,0.15);' +
          'top:' + (rect.top + pt) + 'px;left:' + rect.left + 'px;' +
          'width:' + pl + 'px;height:' + (rect.height - pt - pb) + 'px;');
      }
      // Right padding strip
      if (pr > 0) {
        createLayoutDiv('position:fixed;pointer-events:none;background:rgba(0,200,100,0.15);' +
          'top:' + (rect.top + pt) + 'px;left:' + (rect.right - pr) + 'px;' +
          'width:' + pr + 'px;height:' + (rect.height - pt - pb) + 'px;');
      }

      // Padding pixel labels (show non-zero values)
      if (pt > 0) createLayoutLabel(Math.round(pt) + '', rect.top + pt / 2 - 6, rect.left + rect.width / 2 - 8);
      if (pb > 0) createLayoutLabel(Math.round(pb) + '', rect.bottom - pb / 2 - 6, rect.left + rect.width / 2 - 8);
      if (pl > 0) createLayoutLabel(Math.round(pl) + '', rect.top + rect.height / 2 - 6, rect.left + pl / 2 - 8);
      if (pr > 0) createLayoutLabel(Math.round(pr) + '', rect.top + rect.height / 2 - 6, rect.right - pr / 2 - 8);
    }

    // Content area — 1px cyan border around the actual content box
    var contentTop = rect.top + pt;
    var contentLeft = rect.left + pl;
    var contentWidth = rect.width - pl - pr;
    var contentHeight = rect.height - pt - pb;
    if (contentWidth > 0 && contentHeight > 0) {
      createLayoutDiv('position:fixed;pointer-events:none;' +
        'border:1px solid rgba(74,234,255,0.4);background:rgba(74,234,255,0.1);' +
        'top:' + contentTop + 'px;left:' + contentLeft + 'px;' +
        'width:' + contentWidth + 'px;height:' + contentHeight + 'px;');
    }
  }

  // ── Flex Container Overlay ────────────────────────────────────
  function showFlexOverlay(el, computed, rect) {
    var dir = computed.flexDirection;
    var justify = computed.justifyContent;
    var align = computed.alignItems;
    var gap = computed.gap;

    // Direction arrow overlay — large centered arrow showing flex direction
    var arrowMap = { row: '\u2192', column: '\u2193', 'row-reverse': '\u2190', 'column-reverse': '\u2191' };
    var arrow = arrowMap[dir] || '\u2192';
    var arrowEl = createLayoutDiv(
      'position:fixed;pointer-events:none;display:flex;align-items:center;justify-content:center;' +
      'color:rgba(74,234,255,0.5);font-size:28px;font-weight:bold;' +
      'top:' + rect.top + 'px;left:' + rect.left + 'px;' +
      'width:' + rect.width + 'px;height:' + rect.height + 'px;'
    );
    arrowEl.textContent = arrow;

    // Semi-transparent flex container tint
    createLayoutDiv('position:fixed;pointer-events:none;' +
      'background:rgba(74,234,255,0.05);border:1px dashed rgba(74,234,255,0.3);' +
      'top:' + rect.top + 'px;left:' + rect.left + 'px;' +
      'width:' + rect.width + 'px;height:' + rect.height + 'px;');

    // Justify-content label (positioned at top-left of element)
    var justifyLabel = createLayoutDiv(LAYOUT_LABEL_STYLE);
    justifyLabel.textContent = 'justify: ' + justify;
    justifyLabel.style.top = (rect.bottom + 2) + 'px';
    justifyLabel.style.left = rect.left + 'px';

    // Align-items label (positioned next to justify)
    var alignLabel = createLayoutDiv(LAYOUT_LABEL_STYLE);
    alignLabel.textContent = 'align: ' + align;
    alignLabel.style.top = (rect.bottom + 2) + 'px';
    // Offset to the right of justify label — estimate width
    alignLabel.style.left = (rect.left + (justify.length + 10) * 6.5) + 'px';

    // Gap label if present
    if (gap && gap !== 'normal' && gap !== '0px') {
      var gapLabel = createLayoutDiv(LAYOUT_LABEL_STYLE);
      gapLabel.textContent = 'gap: ' + gap;
      gapLabel.style.top = (rect.bottom + 16) + 'px';
      gapLabel.style.left = rect.left + 'px';
    }

    // Visualize gap as dotted-line regions between flex children
    if (gap && gap !== 'normal' && gap !== '0px') {
      var children = el.children;
      for (var ci = 0; ci < children.length - 1; ci++) {
        var childRect = children[ci].getBoundingClientRect();
        var nextRect = children[ci + 1].getBoundingClientRect();
        var gapDiv;
        if (dir === 'row' || dir === 'row-reverse') {
          var gapLeft = childRect.right;
          var gapWidth = Math.max(0, nextRect.left - childRect.right);
          if (gapWidth > 0) {
            gapDiv = createLayoutDiv(
              'position:fixed;pointer-events:none;' +
              'background:repeating-linear-gradient(90deg,rgba(74,234,255,0.2) 0px,rgba(74,234,255,0.2) 2px,transparent 2px,transparent 5px);' +
              'border-left:1px dotted rgba(74,234,255,0.4);border-right:1px dotted rgba(74,234,255,0.4);' +
              'top:' + rect.top + 'px;left:' + gapLeft + 'px;' +
              'width:' + gapWidth + 'px;height:' + rect.height + 'px;'
            );
          }
        } else {
          var gapTop = childRect.bottom;
          var gapHeight = Math.max(0, nextRect.top - childRect.bottom);
          if (gapHeight > 0) {
            gapDiv = createLayoutDiv(
              'position:fixed;pointer-events:none;' +
              'background:repeating-linear-gradient(0deg,rgba(74,234,255,0.2) 0px,rgba(74,234,255,0.2) 2px,transparent 2px,transparent 5px);' +
              'border-top:1px dotted rgba(74,234,255,0.4);border-bottom:1px dotted rgba(74,234,255,0.4);' +
              'top:' + gapTop + 'px;left:' + rect.left + 'px;' +
              'width:' + rect.width + 'px;height:' + gapHeight + 'px;'
            );
          }
        }
      }
    }
  }

  // ── Grid Container Overlay ────────────────────────────────────
  function showGridOverlay(el, computed, rect) {
    var colsRaw = computed.gridTemplateColumns;
    var rowsRaw = computed.gridTemplateRows;
    var gap = computed.gap;
    var rowGap = computed.rowGap;
    var colGap = computed.columnGap;

    // Parse track sizes from computed style (e.g. "200px 200px 200px")
    var colSizes = colsRaw && colsRaw !== 'none' ? colsRaw.split(/\\s+/).map(parseFloat).filter(function(n) { return !isNaN(n); }) : [];
    var rowSizes = rowsRaw && rowsRaw !== 'none' ? rowsRaw.split(/\\s+/).map(parseFloat).filter(function(n) { return !isNaN(n); }) : [];

    var numCols = colSizes.length || 1;
    var numRows = rowSizes.length || 1;

    // Semi-transparent grid container tint
    createLayoutDiv('position:fixed;pointer-events:none;' +
      'background:rgba(74,234,255,0.05);border:1px dashed rgba(74,234,255,0.3);' +
      'top:' + rect.top + 'px;left:' + rect.left + 'px;' +
      'width:' + rect.width + 'px;height:' + rect.height + 'px;');

    // Grid badge: "3x2 grid"
    var badge = createLayoutDiv(LAYOUT_LABEL_STYLE);
    badge.style.top = (rect.bottom + 2) + 'px';
    badge.style.left = rect.left + 'px';
    badge.textContent = numCols + '\\u00d7' + numRows + ' grid';

    // Gap label if present
    var effectiveGap = gap && gap !== 'normal' && gap !== '0px' ? gap : null;
    if (effectiveGap) {
      var gapBadge = createLayoutDiv(LAYOUT_LABEL_STYLE);
      gapBadge.style.top = (rect.bottom + 16) + 'px';
      gapBadge.style.left = rect.left + 'px';
      gapBadge.textContent = 'gap: ' + effectiveGap;
    }

    // Parse gap values for track line positioning
    var rGap = parseFloat(rowGap) || 0;
    var cGap = parseFloat(colGap) || 0;

    // Draw vertical column track lines (dashed cyan at 20% opacity)
    if (colSizes.length > 1) {
      var xOffset = rect.left;
      for (var ci = 0; ci < colSizes.length - 1; ci++) {
        xOffset += colSizes[ci];
        // Draw line at this position
        createLayoutDiv('position:fixed;pointer-events:none;' +
          'border-left:1px dashed rgba(74,234,255,0.2);' +
          'top:' + rect.top + 'px;left:' + xOffset + 'px;' +
          'width:0px;height:' + rect.height + 'px;');
        // Visualize column gap as highlighted space
        if (cGap > 0) {
          createLayoutDiv('position:fixed;pointer-events:none;' +
            'background:rgba(74,234,255,0.1);' +
            'top:' + rect.top + 'px;left:' + xOffset + 'px;' +
            'width:' + cGap + 'px;height:' + rect.height + 'px;');
          xOffset += cGap;
        }
      }
    }

    // Draw horizontal row track lines (dashed cyan at 20% opacity)
    if (rowSizes.length > 1) {
      var yOffset = rect.top;
      for (var ri = 0; ri < rowSizes.length - 1; ri++) {
        yOffset += rowSizes[ri];
        // Draw line at this position
        createLayoutDiv('position:fixed;pointer-events:none;' +
          'border-top:1px dashed rgba(74,234,255,0.2);' +
          'top:' + yOffset + 'px;left:' + rect.left + 'px;' +
          'width:' + rect.width + 'px;height:0px;');
        // Visualize row gap as highlighted space
        if (rGap > 0) {
          createLayoutDiv('position:fixed;pointer-events:none;' +
            'background:rgba(74,234,255,0.1);' +
            'top:' + yOffset + 'px;left:' + rect.left + 'px;' +
            'width:' + rect.width + 'px;height:' + rGap + 'px;');
          yOffset += rGap;
        }
      }
    }
  }

  // ── Main Layout Overlay Dispatcher ────────────────────────────
  function showLayoutOverlay(el) {
    clearLayoutElements();
    var computed = getComputedStyle(el);
    var rect = el.getBoundingClientRect();

    // Box model is always shown for any element
    showBoxModelOverlay(el, computed, rect);

    // Flex/grid overlays on top
    var display = computed.display;
    if (display === 'flex' || display === 'inline-flex') {
      showFlexOverlay(el, computed, rect);
    } else if (display === 'grid' || display === 'inline-grid') {
      showGridOverlay(el, computed, rect);
    }
  }

  function hideLayoutOverlay() {
    clearLayoutElements();
  }

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
    hideLayoutOverlay();
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
  window.__ciScrollHandler = scheduleUpdate;
  window.addEventListener('scroll', scheduleUpdate, true);
  window.addEventListener('resize', scheduleUpdate);

  // MutationObserver: reposition only (fadeout is triggered by renderer via postMessage)
  window.__ciMutationObserver = new MutationObserver(scheduleUpdate);
  window.__ciMutationObserver.observe(document.body, { childList: true, subtree: true, attributes: true });

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

    // Show layout overlay (margin/padding/flex/grid)
    showLayoutOverlay(el);
  }

  window.__ciMouseMoveHandler = function(e) {
    if (!active) return;
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el.id === '__claude_inspector__' || container.contains(el)) return;
    if (el === currentElement) return;
    currentElement = el;
    showHighlight(el);
  };
  document.addEventListener('mousemove', window.__ciMouseMoveHandler, true);

  // Hide hover highlight when cursor leaves the iframe
  window.__ciMouseLeaveHandler = function() {
    if (!active) return;
    hideHighlight();
  };
  document.addEventListener('mouseleave', window.__ciMouseLeaveHandler);

  window.__ciClickHandler = function(e) {
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

    // Parent layout context
    var parentLayout = {};
    if (el.parentElement && el.parentElement !== document.body) {
      var parentStyles = getComputedStyle(el.parentElement);
      parentLayout.parentDisplay = parentStyles.display;
      if (parentStyles.display === 'flex' || parentStyles.display === 'inline-flex') {
        parentLayout.parentFlexDirection = parentStyles.flexDirection;
        parentLayout.parentJustifyContent = parentStyles.justifyContent;
        parentLayout.parentAlignItems = parentStyles.alignItems;
      }
      if (parentStyles.display === 'grid' || parentStyles.display === 'inline-grid') {
        parentLayout.parentGridTemplateColumns = parentStyles.gridTemplateColumns;
      }
      var gapVal = parentStyles.gap;
      if (gapVal && gapVal !== 'normal' && gapVal !== '0px') parentLayout.parentGap = gapVal;
    }

    // Sibling count
    var siblingCount = el.parentElement ? el.parentElement.children.length : 0;

    // Event handler names from React fiber
    var eventHandlers = [];
    var fiber = getFiberFromDOM(el);
    if (fiber && fiber.memoizedProps) {
      var eventKeys = Object.keys(fiber.memoizedProps).filter(function(k) {
        return k.startsWith('on') && typeof fiber.memoizedProps[k] === 'function';
      });
      eventHandlers = eventKeys;
    }

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
        parentLayout: parentLayout,
        siblingCount: siblingCount,
        eventHandlers: eventHandlers,
        rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        html: el.outerHTML.substring(0, 500)
      }
    }, window.location.origin);
  };
  document.addEventListener('click', window.__ciClickHandler, true);

  // Store message handler reference for cleanup on re-injection
  if (window.__ciMessageHandler) {
    window.removeEventListener('message', window.__ciMessageHandler);
  }
  window.__ciMessageHandler = function(e) {
    // Only accept messages from the parent frame (same origin)
    if (e.source !== window.parent) return;
    if (!e.data || typeof e.data.type !== 'string') return;
    if (e.data.type === 'inspector:activate') active = true;
    if (e.data.type === 'inspector:deactivate') {
      active = false;
      hideHighlight();
      // Persistent highlight stays — it outlives inspector mode
    }
    if (e.data.type === 'inspector:clearHighlight') {
      clearAllPersistHighlights();
    }
    if (e.data.type === 'inspector:fadeHighlight') {
      fadeAllPersistHighlights();
    }
  };
  window.addEventListener('message', window.__ciMessageHandler);

  // ── Error Capture + Overlay ─────────────────────────────────
  var errorBuffer = [];
  var MAX_ERRORS = 20;
  var overlayVisible = false;

  // Create error overlay (hidden by default)
  var errorOverlay = document.createElement('div');
  errorOverlay.id = '__claude_error_overlay__';
  errorOverlay.style.cssText =
    'position:fixed;bottom:0;left:0;right:0;max-height:40%;overflow-y:auto;' +
    'background:rgba(15,0,0,0.95);color:#ff6b6b;font-family:ui-monospace,monospace;' +
    'font-size:12px;z-index:999998;display:none;border-top:2px solid #ff4444;' +
    'backdrop-filter:blur(8px);';

  var errorHeader = document.createElement('div');
  errorHeader.style.cssText =
    'display:flex;align-items:center;justify-content:space-between;padding:8px 12px;' +
    'background:rgba(255,68,68,0.15);border-bottom:1px solid rgba(255,68,68,0.2);' +
    'position:sticky;top:0;';

  var headerLabel = document.createElement('span');
  headerLabel.style.cssText = 'font-weight:600;color:#ff8888;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;';
  headerLabel.textContent = 'Runtime Errors';
  errorHeader.appendChild(headerLabel);

  var dismissBtn = document.createElement('button');
  dismissBtn.textContent = 'Dismiss';
  dismissBtn.style.cssText =
    'background:none;border:1px solid rgba(255,68,68,0.3);color:#ff8888;font-size:10px;' +
    'padding:2px 8px;border-radius:3px;cursor:pointer;font-family:inherit;';
  dismissBtn.onclick = function() { hideErrorOverlay(); };
  errorHeader.appendChild(dismissBtn);
  errorOverlay.appendChild(errorHeader);

  var errorList = document.createElement('div');
  errorList.style.cssText = 'padding:8px 0;';
  errorOverlay.appendChild(errorList);
  document.body.appendChild(errorOverlay);

  function showErrorOverlay() {
    overlayVisible = true;
    errorOverlay.style.display = 'block';
  }

  function hideErrorOverlay() {
    overlayVisible = false;
    errorOverlay.style.display = 'none';
  }

  function renderErrorItem(err) {
    var item = document.createElement('div');
    item.style.cssText =
      'padding:6px 12px;border-bottom:1px solid rgba(255,255,255,0.05);';
    var msg = document.createElement('div');
    msg.style.cssText = 'color:#ff6b6b;word-break:break-word;';
    msg.textContent = err.message;
    item.appendChild(msg);
    if (err.file || err.line) {
      var loc = document.createElement('div');
      loc.style.cssText = 'color:#666;font-size:10px;margin-top:2px;';
      loc.textContent = (err.file || '?') + (err.line ? ':' + err.line : '') + (err.column ? ':' + err.column : '');
      item.appendChild(loc);
    }
    return item;
  }

  function postError(err) {
    if (errorBuffer.length >= MAX_ERRORS) errorBuffer.shift();
    errorBuffer.push(err);
    window.parent.postMessage({ type: 'inspector:runtimeError', error: err }, window.location.origin);

    // Update overlay
    errorList.appendChild(renderErrorItem(err));
    showErrorOverlay();
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

  // Allow parent to clear/dismiss overlay (handled by __ciMessageHandler above)
  if (window.__ciErrorHandler) {
    window.removeEventListener('message', window.__ciErrorHandler);
  }
  window.__ciErrorHandler = function(e) {
    if (e.source !== window.parent) return;
    if (e.data && e.data.type === 'inspector:clearErrors') {
      errorBuffer = [];
      while (errorList.firstChild) errorList.removeChild(errorList.firstChild);
      hideErrorOverlay();
    }
  };
  window.addEventListener('message', window.__ciErrorHandler);

  // ── Console Log Interception ──────────────────────────────
  var origLog = console.log;
  var origWarn = console.warn;
  var origInfo = console.info;

  function formatArg(a) {
    if (a === null) return 'null';
    if (a === undefined) return 'undefined';
    if (typeof a === 'string') return a;
    if (typeof a === 'number' || typeof a === 'boolean') return String(a);
    if (a instanceof Error) return a.message;
    try { return JSON.stringify(a, null, 2).substring(0, 500); } catch(e) { return String(a); }
  }

  function postLog(level, args) {
    var parts = [];
    for (var i = 0; i < args.length; i++) parts.push(formatArg(args[i]));
    window.parent.postMessage({
      type: 'inspector:consoleLog',
      log: { level: level, message: parts.join(' '), timestamp: Date.now() }
    }, window.location.origin);
  }

  console.log = function() { origLog.apply(console, arguments); postLog('log', arguments); };
  console.warn = function() { origWarn.apply(console, arguments); postLog('warn', arguments); };
  console.info = function() { origInfo.apply(console, arguments); postLog('info', arguments); };
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

    // Validate frame URL — only inject into localhost dev server frames
    const frameUrl = iframeFrame.url
    if (!frameUrl.startsWith('http://localhost') && !frameUrl.startsWith('http://127.0.0.1')) {
      return { success: false, error: `Refusing to inject into non-localhost frame: ${frameUrl}` }
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
