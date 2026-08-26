/**
 * JSON Vision — content script.
 *
 * Detects when the current document IS a raw JSON response (the browser's
 * default "here's some text in a <pre>" view) and replaces it with an
 * interactive, virtualized tree viewer: search, expand/collapse, keyboard
 * navigation, copy-to-clipboard, and a persisted light/dark theme.
 *
 * Everything here is self-contained. No network requests are made, no
 * eval()/Function() is used, and every piece of JSON-derived text is
 * inserted via textContent/createTextNode — never innerHTML — so the
 * viewer is safe to run on untrusted JSON from any origin.
 */
(function () {
  'use strict';

  const ROW_HEIGHT = 22; // px, fixed row height that makes virtual scrolling possible
  const INDENT_PX = 16; // px per tree depth level
  const VIRTUAL_BUFFER = 8; // extra rows rendered above/below the viewport
  const SEARCH_DEBOUNCE_MS = 300;

  // ---- Module state -------------------------------------------------------

  let parsedJson = null;
  let prettyFullText = '';
  let rootNode = null;
  let rows = []; // flattened, currently-visible (expanded) rows
  let nodeToRowIndex = new Map(); // node -> index of its opening row in `rows`
  let renderedEls = new Map(); // rowIndex -> DOM element currently mounted
  let selection = { mode: 'none' }; // {mode:'none'} | {mode:'all'} | {mode:'index', index}
  const searchState = { query: '', matches: [], matchRowIndices: [], currentIndex: -1 };

  let appRootEl = null;
  let viewportEl = null;
  let spacerEl = null;
  let searchInputEl = null;
  let clearButtonEl = null;
  let counterEl = null;
  let themeButtonEl = null;
  let toastEl = null;

  let searchDebounceTimer = null;
  let toastTimer = null;
  let scrollScheduled = false;

  // ---- JSON tree model ------------------------------------------------------

  /** @returns {'object'|'array'|'string'|'number'|'boolean'|'null'} the JSON type of a value */
  function getJsonType(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }

  function isContainerType(type) {
    return type === 'object' || type === 'array';
  }

  /**
   * Builds the full node tree for a parsed JSON value. Uses an explicit
   * stack instead of recursion so pathologically deep JSON (thousands of
   * nested levels) cannot overflow the call stack.
   * @param {*} value the root parsed JSON value
   * @returns {object} the root tree node
   */
  function buildTree(value) {
    const rootType = getJsonType(value);
    const root = {
      key: null,
      path: [],
      depth: 0,
      type: rootType,
      value: isContainerType(rootType) ? undefined : value,
      children: isContainerType(rootType) ? [] : null,
      expanded: true,
      parent: null,
      childCount: 0,
    };
    if (!isContainerType(rootType)) return root;

    const stack = [[root, value]];
    while (stack.length) {
      const [node, nodeValue] = stack.pop();
      const entries = node.type === 'array' ? nodeValue.map((v, i) => [i, v]) : Object.entries(nodeValue);
      node.childCount = entries.length;
      node.expanded = node.depth < 2; // auto-expand the first two levels for a useful initial view
      for (const [key, childValue] of entries) {
        const childType = getJsonType(childValue);
        const child = {
          key,
          path: node.path.concat([key]),
          depth: node.depth + 1,
          type: childType,
          value: isContainerType(childType) ? undefined : childValue,
          children: isContainerType(childType) ? [] : null,
          expanded: false,
          parent: node,
          childCount: 0,
        };
        node.children.push(child);
        if (isContainerType(childType)) stack.push([child, childValue]);
      }
    }
    return root;
  }

  /**
   * Flattens the tree into an ordered list of visible rows, respecting each
   * node's `expanded` flag. Container nodes contribute both an opening row
   * and (when expanded, non-empty) a closing-bracket row. Iterative to stay
   * safe on deep trees.
   */
  function flattenTree(root) {
    const result = [];
    const stack = [{ kind: 'open', node: root, isLast: true }];
    while (stack.length) {
      const item = stack.pop();
      if (item.kind === 'close') {
        result.push({ node: item.node, isClosing: true, isLast: item.isLast });
        continue;
      }
      const { node, isLast } = item;
      result.push({ node, isClosing: false, isLast });
      if (isContainerType(node.type) && node.expanded && node.childCount > 0) {
        stack.push({ kind: 'close', node, isLast });
        for (let i = node.children.length - 1; i >= 0; i--) {
          stack.push({ kind: 'open', node: node.children[i], isLast: i === node.children.length - 1 });
        }
      }
    }
    return result;
  }

  /** Recursively (iteratively) sets `expanded` on every container node. */
  function setAllExpanded(root, expanded) {
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      if (isContainerType(node.type)) {
        node.expanded = expanded;
        for (const child of node.children) stack.push(child);
      }
    }
  }

  /** Walks up from a node to the root, expanding every ancestor container. */
  function expandAncestors(node) {
    let parent = node.parent;
    while (parent) {
      parent.expanded = true;
      parent = parent.parent;
    }
  }

  /**
   * Finds every node whose key or (for leaves) value contains `query`
   * (case-insensitive substring match), in top-to-bottom document order.
   */
  function searchTree(root, query) {
    const matches = [];
    const q = query.toLowerCase();
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      const keyText = node.key === null ? '' : String(node.key);
      let isMatch = keyText.toLowerCase().includes(q);
      if (!isMatch && !isContainerType(node.type)) {
        isMatch = formatPrimitivePreview(node.value).toLowerCase().includes(q);
      }
      if (isMatch) matches.push(node);
      if (isContainerType(node.type)) {
        for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
      }
    }
    return matches;
  }

  /** Renders a JSON primitive the way it would appear in formatted JSON text. */
  function formatPrimitivePreview(value) {
    const type = getJsonType(value);
    if (type === 'string') return JSON.stringify(value);
    if (type === 'null') return 'null';
    return String(value);
  }

  /** Formats a path array like ['data','items',3,'name'] as `data.items[3].name`. */
  function formatPath(path) {
    if (path.length === 0) return '$';
    let out = '';
    const identifierRe = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
    for (const segment of path) {
      if (typeof segment === 'number') {
        out += `[${segment}]`;
      } else if (identifierRe.test(segment)) {
        out += (out ? '.' : '') + segment;
      } else {
        out += `[${JSON.stringify(segment)}]`;
      }
    }
    return out;
  }

  /** Navigates the original parsed JSON by a path array to retrieve a live value. */
  function getByPath(root, path) {
    let current = root;
    for (const segment of path) current = current[segment];
    return current;
  }

  // ---- Row rendering --------------------------------------------------------

  function makePunct(text) {
    const span = document.createElement('span');
    span.className = 'jv-punct';
    span.textContent = text;
    return span;
  }

  /**
   * Writes `text` into `el`, wrapping every case-insensitive occurrence of
   * the active search query in a <mark>. Always uses textContent/DOM nodes
   * for the underlying data, never innerHTML, so untrusted JSON content
   * (e.g. a string value containing "<script>") can never be parsed as markup.
   */
  function renderTextWithHighlight(el, text) {
    const query = searchState.query;
    if (!query) {
      el.textContent = text;
      return;
    }
    const lower = text.toLowerCase();
    const q = query.toLowerCase();
    let start = 0;
    let idx = lower.indexOf(q);
    if (idx === -1) {
      el.textContent = text;
      return;
    }
    el.textContent = '';
    while (idx !== -1) {
      if (idx > start) el.appendChild(document.createTextNode(text.slice(start, idx)));
      const mark = document.createElement('mark');
      mark.className = 'jv-mark';
      mark.textContent = text.slice(idx, idx + q.length);
      el.appendChild(mark);
      start = idx + q.length;
      idx = lower.indexOf(q, start);
    }
    if (start < text.length) el.appendChild(document.createTextNode(text.slice(start)));
  }

  /** Builds the DOM element for a single flattened row. */
  function buildRowElement(row, rowIndex) {
    const { node, isClosing, isLast } = row;
    const el = document.createElement('div');
    el.className = 'jv-row jv-row-appear';
    el.style.top = rowIndex * ROW_HEIGHT + 'px';
    el.title = node.key === null ? '$ (root)' : formatPath(node.path);
    if (
      selection.mode === 'all' ||
      (selection.mode === 'index' && rows[selection.index] === row)
    ) {
      el.classList.add('jv-row-selected');
    }

    const lineNo = document.createElement('div');
    lineNo.className = 'jv-lineno';
    lineNo.textContent = String(rowIndex + 1);
    lineNo.addEventListener('click', (e) => {
      e.stopPropagation();
      selectRowByIndex(rowIndex);
    });
    el.appendChild(lineNo);

    const content = document.createElement('div');
    content.className = 'jv-content';
    content.style.paddingLeft = node.depth * INDENT_PX + 'px';

    if (isClosing) {
      content.appendChild(makePunct(node.type === 'array' ? ']' : '}'));
      if (!isLast) content.appendChild(makePunct(','));
    } else {
      const isContainer = isContainerType(node.type);

      if (isContainer && node.childCount > 0) {
        const toggle = document.createElement('span');
        toggle.className = 'jv-toggle' + (node.expanded ? ' jv-toggle-expanded' : '');
        toggle.textContent = '▶'; // ▶
        toggle.addEventListener('click', (e) => {
          e.stopPropagation();
          node.expanded = !node.expanded;
          rebuildRows();
        });
        content.appendChild(toggle);
      } else {
        const spacer = document.createElement('span');
        spacer.className = 'jv-toggle-spacer';
        content.appendChild(spacer);
      }

      if (node.key !== null) {
        const isArrayIndex = node.parent && node.parent.type === 'array';
        const keyText = isArrayIndex ? String(node.key) : JSON.stringify(String(node.key));
        const keyEl = document.createElement('span');
        keyEl.className = isArrayIndex ? 'jv-index' : 'jv-key';
        renderTextWithHighlight(keyEl, keyText);
        keyEl.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          copyPathToClipboard(node);
        });
        content.appendChild(keyEl);
        content.appendChild(makePunct(': '));
      }

      if (isContainer) {
        content.appendChild(makePunct(node.type === 'array' ? '[' : '{'));
        if (node.childCount === 0) {
          content.appendChild(makePunct(node.type === 'array' ? ']' : '}'));
          if (!isLast) content.appendChild(makePunct(','));
        } else if (!node.expanded) {
          const dots = document.createElement('span');
          dots.className = 'jv-collapsed-dots';
          dots.textContent = '…';
          content.appendChild(dots);
          content.appendChild(makePunct(node.type === 'array' ? ']' : '}'));
          if (!isLast) content.appendChild(makePunct(','));
          const badge = document.createElement('span');
          badge.className = 'jv-badge';
          const noun = node.type === 'array' ? 'item' : 'key';
          badge.textContent = ` ${node.childCount} ${noun}${node.childCount === 1 ? '' : 's'}`;
          content.appendChild(badge);
        }
        // else: expanded with children — the opening bracket stays open;
        // children and the matching closing row follow as their own rows.
      } else {
        const valEl = document.createElement('span');
        valEl.className = 'jv-val jv-val-' + node.type;
        renderTextWithHighlight(valEl, formatPrimitivePreview(node.value));
        content.appendChild(valEl);
        if (!isLast) content.appendChild(makePunct(','));
      }
    }

    el.appendChild(content);
    el.addEventListener('click', () => selectRowByIndex(rowIndex));
    return el;
  }

  // ---- Virtual scrolling ------------------------------------------------

  /** Rebuilds the flattened row list after any expand/collapse/search change. */
  function rebuildRows() {
    const prevRow = selection.mode === 'index' ? rows[selection.index] : null;

    rows = flattenTree(rootNode);
    nodeToRowIndex = new Map();
    rows.forEach((row, i) => {
      if (!row.isClosing) nodeToRowIndex.set(row.node, i);
    });

    spacerEl.style.height = rows.length * ROW_HEIGHT + 'px';
    for (const el of renderedEls.values()) el.remove();
    renderedEls.clear();

    if (prevRow) {
      const restored = !prevRow.isClosing && nodeToRowIndex.has(prevRow.node);
      selection = restored ? { mode: 'index', index: nodeToRowIndex.get(prevRow.node) } : { mode: 'none' };
    }

    renderVisible();
  }

  /** Renders only the rows currently within (or near) the viewport. */
  function renderVisible() {
    if (!viewportEl) return;
    const scrollTop = viewportEl.scrollTop;
    const viewportHeight = viewportEl.clientHeight || 0;
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - VIRTUAL_BUFFER);
    const end = Math.min(rows.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + VIRTUAL_BUFFER);

    for (const [idx, el] of renderedEls) {
      if (idx < start || idx >= end) {
        el.remove();
        renderedEls.delete(idx);
      }
    }
    for (let i = start; i < end; i++) {
      if (!renderedEls.has(i)) {
        const el = buildRowElement(rows[i], i);
        viewportEl.appendChild(el);
        renderedEls.set(i, el);
      }
    }
  }

  function onScroll() {
    if (scrollScheduled) return;
    scrollScheduled = true;
    requestAnimationFrame(() => {
      renderVisible();
      scrollScheduled = false;
    });
  }

  // ---- Selection & keyboard navigation -----------------------------------

  function refreshSelectionClasses() {
    for (const [idx, el] of renderedEls) {
      const isSelected = selection.mode === 'all' || (selection.mode === 'index' && selection.index === idx);
      el.classList.toggle('jv-row-selected', isSelected);
    }
  }

  function ensureRowVisible(index) {
    const top = index * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    if (top < viewportEl.scrollTop) {
      viewportEl.scrollTop = top;
    } else if (bottom > viewportEl.scrollTop + viewportEl.clientHeight) {
      viewportEl.scrollTop = bottom - viewportEl.clientHeight;
    }
    renderVisible();
  }

  function selectRowByIndex(index) {
    if (index < 0 || index >= rows.length) return;
    selection = { mode: 'index', index };
    ensureRowVisible(index);
    refreshSelectionClasses();
  }

  function handleArrowRight() {
    if (selection.mode !== 'index') return;
    const row = rows[selection.index];
    const node = row.node;
    if (row.isClosing || !isContainerType(node.type) || node.childCount === 0) return;
    if (!node.expanded) {
      node.expanded = true;
      rebuildRows();
      const idx = nodeToRowIndex.get(node);
      if (idx !== undefined) selectRowByIndex(idx);
    } else {
      selectRowByIndex(selection.index + 1);
    }
  }

  function handleArrowLeft() {
    if (selection.mode !== 'index') return;
    const row = rows[selection.index];
    const node = row.node;
    if (!row.isClosing && isContainerType(node.type) && node.expanded && node.childCount > 0) {
      node.expanded = false;
      rebuildRows();
      const idx = nodeToRowIndex.get(node);
      if (idx !== undefined) selectRowByIndex(idx);
    } else if (node.parent) {
      const idx = nodeToRowIndex.get(node.parent);
      if (idx !== undefined) selectRowByIndex(idx);
    }
  }

  /** Copies the currently selected node's value (or the whole document) as pretty JSON. */
  async function copySelection() {
    try {
      let text;
      if (selection.mode === 'all') {
        text = prettyFullText;
      } else if (selection.mode === 'index') {
        const row = rows[selection.index];
        const value = getByPath(parsedJson, row.node.path);
        text = JSON.stringify(value, null, 2);
      } else {
        return;
      }
      await navigator.clipboard.writeText(text);
      showToast('Copied to clipboard');
    } catch (err) {
      console.error('[JSON Vision] Copy failed:', err);
      showToast('Copy failed — clipboard permission denied');
    }
  }

  async function copyPathToClipboard(node) {
    const text = formatPath(node.path);
    try {
      await navigator.clipboard.writeText(text);
      showToast(`Path copied: ${text}`);
    } catch (err) {
      console.error('[JSON Vision] Failed to copy path:', err);
      showToast('Copy failed — clipboard permission denied');
    }
  }

  /**
   * Global keyboard shortcut handler. Arrow/copy/select-all shortcuts are
   * suppressed while a text input has focus so typing in the search box
   * behaves normally.
   */
  function handleKeydown(e) {
    const mod = e.metaKey || e.ctrlKey;

    if (mod && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      searchInputEl.focus();
      searchInputEl.select();
      return;
    }

    if (e.target === searchInputEl) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (searchInputEl.value) {
          searchInputEl.value = '';
          runSearch('');
        } else {
          searchInputEl.blur();
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) goToPrevMatch();
        else goToNextMatch();
      }
      return;
    }

    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;

    if (mod && e.key.toLowerCase() === 'c') {
      if (selection.mode === 'none') return;
      e.preventDefault();
      copySelection();
      return;
    }

    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      selection = { mode: 'all' };
      refreshSelectionClasses();
      return;
    }

    if (e.key === 'Escape') {
      selection = { mode: 'none' };
      refreshSelectionClasses();
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        selectRowByIndex(selection.mode === 'index' ? selection.index + 1 : 0);
        break;
      case 'ArrowUp':
        e.preventDefault();
        selectRowByIndex(selection.mode === 'index' ? selection.index - 1 : 0);
        break;
      case 'ArrowRight':
        e.preventDefault();
        handleArrowRight();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        handleArrowLeft();
        break;
      default:
        break;
    }
  }

  // ---- Search -------------------------------------------------------------

  function onSearchInput() {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => runSearch(searchInputEl.value), SEARCH_DEBOUNCE_MS);
  }

  /** Runs (or clears) a search, expanding ancestors of every match so they're visible. */
  function runSearch(rawQuery) {
    const query = rawQuery.trim();
    searchState.query = query;
    clearButtonEl.classList.toggle('jv-hidden', query.length === 0);

    if (!query) {
      searchState.matches = [];
      searchState.matchRowIndices = [];
      searchState.currentIndex = -1;
      rebuildRows();
      updateMatchCounterUI();
      return;
    }

    searchState.matches = searchTree(rootNode, query);
    searchState.matches.forEach(expandAncestors);
    rebuildRows();

    searchState.matchRowIndices = searchState.matches
      .map((node) => nodeToRowIndex.get(node))
      .filter((idx) => idx !== undefined);
    searchState.currentIndex = searchState.matchRowIndices.length > 0 ? 0 : -1;

    if (searchState.currentIndex >= 0) {
      selectRowByIndex(searchState.matchRowIndices[0]);
    }
    updateMatchCounterUI();
  }

  function goToNextMatch() {
    if (searchState.matchRowIndices.length === 0) return;
    searchState.currentIndex = (searchState.currentIndex + 1) % searchState.matchRowIndices.length;
    selectRowByIndex(searchState.matchRowIndices[searchState.currentIndex]);
    updateMatchCounterUI();
  }

  function goToPrevMatch() {
    if (searchState.matchRowIndices.length === 0) return;
    const n = searchState.matchRowIndices.length;
    searchState.currentIndex = (searchState.currentIndex - 1 + n) % n;
    selectRowByIndex(searchState.matchRowIndices[searchState.currentIndex]);
    updateMatchCounterUI();
  }

  function updateMatchCounterUI() {
    if (!counterEl) return;
    if (!searchState.query) {
      counterEl.textContent = '';
      return;
    }
    const total = searchState.matchRowIndices.length;
    const current = total > 0 ? searchState.currentIndex + 1 : 0;
    counterEl.textContent = `${current}/${total}`;
  }

  // ---- Theme ----------------------------------------------------------------

  function applyTheme(theme) {
    if (!appRootEl) return;
    appRootEl.classList.remove('jv-theme-light', 'jv-theme-dark');
    const resolved =
      theme === 'auto' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
    appRootEl.classList.add(resolved === 'dark' ? 'jv-theme-dark' : 'jv-theme-light');
  }

  async function toggleTheme() {
    const next = appRootEl.classList.contains('jv-theme-dark') ? 'light' : 'dark';
    applyTheme(next);
    try {
      await chrome.storage.local.set({ theme: next });
    } catch (err) {
      console.warn('[JSON Vision] Could not persist theme preference:', err);
    }
  }

  // ---- Toast ------------------------------------------------------------

  function showToast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add('jv-toast-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('jv-toast-visible'), 1800);
  }

  // ---- Toolbar ------------------------------------------------------------

  function buildToolbar() {
    const toolbar = document.createElement('header');
    toolbar.className = 'jv-toolbar';

    const brand = document.createElement('div');
    brand.className = 'jv-brand';
    const brandIcon = document.createElement('span');
    brandIcon.className = 'jv-brand-icon';
    brandIcon.textContent = '{ }';
    const brandText = document.createElement('span');
    brandText.className = 'jv-brand-text';
    brandText.textContent = 'JSON Vision';
    brand.appendChild(brandIcon);
    brand.appendChild(brandText);
    toolbar.appendChild(brand);

    const searchWrap = document.createElement('div');
    searchWrap.className = 'jv-search-wrap';

    searchInputEl = document.createElement('input');
    searchInputEl.type = 'text';
    searchInputEl.className = 'jv-search-input';
    searchInputEl.placeholder = 'Search keys and values…';
    searchInputEl.setAttribute('aria-label', 'Search JSON');
    searchInputEl.addEventListener('input', onSearchInput);
    searchWrap.appendChild(searchInputEl);

    clearButtonEl = document.createElement('button');
    clearButtonEl.type = 'button';
    clearButtonEl.className = 'jv-search-clear jv-hidden';
    clearButtonEl.textContent = '✕';
    clearButtonEl.setAttribute('aria-label', 'Clear search');
    clearButtonEl.addEventListener('click', () => {
      searchInputEl.value = '';
      runSearch('');
      searchInputEl.focus();
    });
    searchWrap.appendChild(clearButtonEl);

    counterEl = document.createElement('span');
    counterEl.className = 'jv-match-counter';
    searchWrap.appendChild(counterEl);

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'jv-icon-btn';
    prevBtn.title = 'Previous match (Shift+Enter)';
    prevBtn.textContent = '↑';
    prevBtn.addEventListener('click', goToPrevMatch);
    searchWrap.appendChild(prevBtn);

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'jv-icon-btn';
    nextBtn.title = 'Next match (Enter)';
    nextBtn.textContent = '↓';
    nextBtn.addEventListener('click', goToNextMatch);
    searchWrap.appendChild(nextBtn);

    toolbar.appendChild(searchWrap);

    const actions = document.createElement('div');
    actions.className = 'jv-actions';

    const expandBtn = document.createElement('button');
    expandBtn.type = 'button';
    expandBtn.className = 'jv-btn';
    expandBtn.textContent = 'Expand All';
    expandBtn.addEventListener('click', () => {
      setAllExpanded(rootNode, true);
      rebuildRows();
    });
    actions.appendChild(expandBtn);

    const collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.className = 'jv-btn';
    collapseBtn.textContent = 'Collapse All';
    collapseBtn.addEventListener('click', () => {
      setAllExpanded(rootNode, false);
      rootNode.expanded = true;
      rebuildRows();
    });
    actions.appendChild(collapseBtn);

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'jv-btn jv-icon-btn';
    copyBtn.title = 'Copy entire JSON';
    copyBtn.textContent = '\u{1F4CB}'; // 📋
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(prettyFullText);
        showToast('Copied entire JSON to clipboard');
      } catch (err) {
        console.error('[JSON Vision] Copy failed:', err);
        showToast('Copy failed');
      }
    });
    actions.appendChild(copyBtn);

    themeButtonEl = document.createElement('button');
    themeButtonEl.type = 'button';
    themeButtonEl.className = 'jv-btn jv-icon-btn';
    themeButtonEl.title = 'Toggle light / dark theme';
    themeButtonEl.textContent = '\u{1F319}'; // 🌙
    themeButtonEl.addEventListener('click', toggleTheme);
    actions.appendChild(themeButtonEl);

    toolbar.appendChild(actions);
    return toolbar;
  }

  // ---- Bootstrap ------------------------------------------------------------

  function isJsonDocument() {
    const contentType = document.contentType || '';
    return contentType === 'application/json' || contentType === 'text/json' || /\+json$/i.test(contentType);
  }

  function getRawJsonText() {
    const pre = document.querySelector('pre');
    if (pre) return pre.textContent || '';
    return (document.body && document.body.textContent) || '';
  }

  /** Tears down Chrome's default plain-text rendering and mounts the JSON Vision UI. */
  function buildViewer(parsedValue, settings) {
    parsedJson = parsedValue;
    prettyFullText = JSON.stringify(parsedValue, null, 2);
    rootNode = buildTree(parsedValue);

    document.title = 'JSON Vision';
    document.body.textContent = '';
    document.body.className = '';

    appRootEl = document.createElement('div');
    appRootEl.id = 'jv-app';
    appRootEl.className = 'jv-app';
    appRootEl.appendChild(buildToolbar());

    viewportEl = document.createElement('div');
    viewportEl.className = 'jv-viewport';
    viewportEl.tabIndex = 0;

    spacerEl = document.createElement('div');
    spacerEl.className = 'jv-spacer';
    viewportEl.appendChild(spacerEl);
    appRootEl.appendChild(viewportEl);

    toastEl = document.createElement('div');
    toastEl.className = 'jv-toast';
    appRootEl.appendChild(toastEl);

    document.body.appendChild(appRootEl);

    applyTheme(settings.theme || 'auto');
    rebuildRows();

    viewportEl.addEventListener('scroll', onScroll);
    window.addEventListener('resize', renderVisible);
    document.addEventListener('keydown', handleKeydown);

    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.theme) applyTheme(changes.theme.newValue);
      });
    } catch (err) {
      console.warn('[JSON Vision] Could not subscribe to settings changes:', err);
    }

    window.addEventListener(
      'pagehide',
      () => {
        clearTimeout(searchDebounceTimer);
        clearTimeout(toastTimer);
        renderedEls.clear();
      },
      { once: true }
    );
  }

  async function init() {
    try {
      if (!isJsonDocument()) return;
      if (document.getElementById('jv-app')) return; // defensive: never double-initialize

      let settings = { enabled: true, theme: 'auto' };
      try {
        const stored = await chrome.storage.local.get(['enabled', 'theme']);
        settings = { ...settings, ...stored };
      } catch (err) {
        console.warn('[JSON Vision] Settings unavailable, using defaults:', err);
      }
      if (settings.enabled === false) return;

      const rawText = getRawJsonText();
      if (!rawText || !rawText.trim()) return;

      let parsedValue;
      try {
        parsedValue = JSON.parse(rawText);
      } catch (err) {
        return; // not valid JSON — leave the browser's default view alone
      }

      buildViewer(parsedValue, settings);
    } catch (err) {
      console.error('[JSON Vision] Failed to initialize viewer:', err);
    }
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  }
})();
