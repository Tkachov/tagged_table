/* Board – Tagged Table
 * Uses the same data format as app.js:
 * {
 *   version: 1,
 *   nextId: number,
 *   tags: string[],
 *   elements: Array<{ id: number, text: string, tags: Record<string, number> }>
 * }
 *
 * The "l" tag controls word color:
 *   no "l" tag  → gray
 *   l = 0       → yellow
 *   l = 1       → green
 */

const STORAGE_KEY = "tagged_table_state_v1";
const L_TAG = "l";

// ── State ────────────────────────────────────────────────────────────────────

let state = loadState();
let wordsPerRow = 40;
let rowsPerBreak = 25;

// Interactive mode
let intActive = false;
let intQueue = [];      // element IDs to process (snapshot, in order, no "l" tag at start)
let intCursor = 0;      // current position in intQueue (start of current batch)
let intPending = {};    // elementId → value: 1=green, 0=yellow, null=remove tag
let intMode = "unlabeled";

// ── Helpers ──────────────────────────────────────────────────────────────────

function $(id) { return document.getElementById(id); }

function toast(msg) {
  const el = $("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 1800);
}

function normalizeTagName(name) { return name.trim(); }
function isValidTagName(name) { return !!name && !/[\u0000-\u001f]/.test(name); }

function pruneKeys(obj, allowedKeys) {
  const out = {};
  for (const k of Object.keys(obj || {})) if (allowedKeys.includes(k)) out[k] = obj[k];
  return out;
}

// ── Persistence ───────────────────────────────────────────────────────────────

function defaultState() {
  return { version: 1, nextId: 1, tags: [], elements: [] };
}

function migrateAndNormalize(s) {
  const base = defaultState();
  const out = { ...base, ...s };

  out.version = 1;
  out.nextId = typeof out.nextId === "number" && out.nextId >= 1 ? Math.floor(out.nextId) : 1;

  out.tags = Array.isArray(out.tags)
    ? Array.from(new Set(out.tags.filter((t) => typeof t === "string").map(normalizeTagName).filter(isValidTagName)))
    : [];

  out.elements = Array.isArray(out.elements)
    ? out.elements
        .map((e) => ({
          id: typeof e?.id === "number" ? Math.floor(e.id) : null,
          text: typeof e?.text === "string" ? e.text : "",
          tags: typeof e?.tags === "object" && e.tags ? e.tags : {},
        }))
        .filter((e) => e.id !== null)
    : [];

  const seen = new Set();
  const cleaned = [];
  let maxId = 0;
  for (const e of out.elements) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    maxId = Math.max(maxId, e.id);
    cleaned.push(e);
  }
  out.elements = cleaned;
  out.nextId = Math.max(out.nextId, maxId + 1);

  // Preserve unknown UI fields so the main table page's state is untouched
  if (s && typeof s.ui === "object") out.ui = s.ui;

  for (const el of out.elements) {
    const tmap = {};
    for (const [k, v] of Object.entries(el.tags || {})) {
      if (!out.tags.includes(k)) continue;
      const n = Number(v);
      if (!Number.isFinite(n)) continue;
      tmap[k] = Math.trunc(n);
    }
    el.tags = tmap;
  }

  return out;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return migrateAndNormalize(JSON.parse(raw));
  } catch {
    return defaultState();
  }
}

function saveState() {
  const toSave = structuredClone(state);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
}

// ── Export / Import ───────────────────────────────────────────────────────────

function downloadJson(filename, obj) {
  const text = JSON.stringify(obj, null, 2);
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportState() {
  const toExport = {
    version: state.version,
    nextId: state.nextId,
    tags: state.tags,
    elements: state.elements,
  };
  if (state.ui !== undefined) toExport.ui = state.ui;
  downloadJson("tagged_table.json", toExport);
  toast("Saved JSON");
}

function handleImportFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const obj = JSON.parse(String(reader.result || ""));
      // Preserve existing UI state
      const incoming = migrateAndNormalize({ ...obj, ui: state.ui });

      // Collect tags referenced in elements but not in tags list
      const tagSet = new Set(incoming.tags);
      for (const e of incoming.elements) for (const t of Object.keys(e.tags || {})) tagSet.add(t);
      incoming.tags = Array.from(tagSet);

      state = incoming;
      saveState();
      renderGrid();
      toast("Loaded JSON");
    } catch (err) {
      console.error(err);
      toast("Invalid JSON");
      alert("Invalid JSON file.");
    }
  };
  reader.readAsText(file);
}

// ── Grid rendering ────────────────────────────────────────────────────────────

function getWordColor(el) {
  const tags = el.tags || {};
  if (!Object.prototype.hasOwnProperty.call(tags, L_TAG)) return "gray";
  const v = tags[L_TAG];
  if (v === 1) return "green";
  if (v === 0) return "yellow";
  return "gray";
}

function renderGrid() {
  const grid = $("boardGrid");
  const cols = Math.max(1, wordsPerRow);
  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  grid.innerHTML = "";

  if (state.elements.length === 0) {
    grid.style.gridTemplateColumns = "";
    const empty = document.createElement("div");
    empty.style.cssText = "padding:24px;color:#64748b;font-size:14px;";
    empty.textContent = "No words yet. Load a JSON file or add elements in the Table view.";
    grid.appendChild(empty);
    return;
  }

  const breakEveryCells = cols * Math.max(1, rowsPerBreak);
  for (let i = 0; i < state.elements.length; i++) {
    const el = state.elements[i];
    const cell = document.createElement("div");
    cell.className = `word-cell word-cell--${getWordColor(el)}`;
    cell.title = el.text;
    cell.setAttribute("aria-label", el.text);
    cell.setAttribute("role", "button");
    cell.tabIndex = 0;
    cell.addEventListener("click", () => startInteractiveMode({ startId: el.id, includeTagged: true }));
    cell.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        startInteractiveMode({ startId: el.id, includeTagged: true });
      }
    });
    grid.appendChild(cell);

    if ((i + 1) % breakEveryCells === 0 && i < state.elements.length - 1) {
      const br = document.createElement("div");
      br.className = "board-grid__break";
      br.setAttribute("aria-hidden", "true");
      grid.appendChild(br);
    }
  }
}

// ── Interactive mode ──────────────────────────────────────────────────────────

function startInteractiveMode(options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const startId = Object.prototype.hasOwnProperty.call(opts, "startId") ? opts.startId : null;
  const includeTagged = opts.includeTagged === true || startId !== null;

  if (includeTagged) {
    const startIndex = state.elements.findIndex((el) => el.id === startId);
    if (startIndex === -1) {
      toast("Could not find the selected word.");
      return;
    }
    intQueue = state.elements.slice(startIndex).map((el) => el.id);
    intMode = "from-grid";
  } else {
    // Snapshot of element IDs without the "l" tag, in original order
    intQueue = state.elements
      .filter((el) => !Object.prototype.hasOwnProperty.call(el.tags || {}, L_TAG))
      .map((el) => el.id);
    intMode = "unlabeled";
  }

  intCursor = 0;
  intPending = {};

  if (intQueue.length === 0) {
    toast(`All words already have the "l" tag.`);
    return;
  }

  intActive = true;
  $("interactiveOverlay").removeAttribute("hidden");
  renderIntCards();
}

function closeInteractiveMode() {
  intActive = false;
  intPending = {};
  $("interactiveOverlay").setAttribute("hidden", "");
}

function getIntBatch() {
  return intQueue.slice(intCursor, intCursor + 5);
}

function cardColorForId(elementId) {
  if (Object.prototype.hasOwnProperty.call(intPending, elementId)) {
    const v = intPending[elementId];
    if (v === null) return "gray";
    if (v === 1) return "green";
    if (v === 0) return "yellow";
  }
  const el = state.elements.find((e) => e.id === elementId);
  if (!el) return "gray";
  return getWordColor(el);
}

function currentCardValue(elementId, el = null) {
  if (Object.prototype.hasOwnProperty.call(intPending, elementId)) return intPending[elementId];
  if (!el) el = state.elements.find((e) => e.id === elementId);
  if (!el || !Object.prototype.hasOwnProperty.call(el.tags || {}, L_TAG)) return null;
  if (el.tags[L_TAG] === 1) return 1;
  if (el.tags[L_TAG] === 0) return 0;
  return null;
}

function cycleCardState(elementId) {
  const el = state.elements.find((e) => e.id === elementId);
  if (!el) return;
  const current = currentCardValue(elementId, el);
  // gray (undefined/null) → green (1) → yellow (0) → gray (null)
  if (current === null) {
    intPending[elementId] = 1;
  } else if (current === 1) {
    intPending[elementId] = 0;
  } else {
    intPending[elementId] = null;
  }
  renderIntCards();
}

function renderIntCards() {
  const container = $("intCards");
  container.innerHTML = "";

  const batch = getIntBatch();

  if (batch.length === 0) {
    const msg = document.createElement("div");
    msg.className = "int-empty";
    msg.textContent = "No more unlabeled words!";
    container.appendChild(msg);
    return;
  }

  for (const id of batch) {
    const el = state.elements.find((e) => e.id === id);
    if (!el) continue;

    const card = document.createElement("div");
    const color = cardColorForId(id);
    card.className = `int-card int-card--${color}`;
    card.textContent = el.text;
    card.title = "Click to cycle: gray → green → yellow → gray";
    card.addEventListener("click", () => cycleCardState(id));
    container.appendChild(card);
  }
}

function applyIntPending() {
  const pendingValues = Object.values(intPending);
  const hasTagAssignments = pendingValues.length > 0 && pendingValues.some((value) => value !== null);
  if (hasTagAssignments && !state.tags.includes(L_TAG)) state.tags.push(L_TAG);

  for (const [idStr, value] of Object.entries(intPending)) {
    const id = Number(idStr);
    const el = state.elements.find((e) => e.id === id);
    if (!el) continue;

    if (value === null) {
      delete el.tags[L_TAG];
    } else {
      el.tags[L_TAG] = value;
    }
  }

  intPending = {};
}

function intNext() {
  const batch = getIntBatch();
  if (batch.length === 0) {
    closeInteractiveMode();
    return;
  }

  applyIntPending();
  saveState();
  renderGrid();

  intCursor += 5;

  if (intCursor >= intQueue.length) {
    closeInteractiveMode();
    toast(intMode === "from-grid" ? "Done! Reached the end of words." : "Done! All words have been reviewed.");
    return;
  }

  renderIntCards();
}

// ── Menu bar ──────────────────────────────────────────────────────────────────

function closeAllMenus() {
  for (const m of document.querySelectorAll(".menu.menu--open")) {
    m.classList.remove("menu--open");
  }
}

// ── Wiring ────────────────────────────────────────────────────────────────────

function wireEvents() {
  // File menu
  $("menuExport").onclick = () => { closeAllMenus(); exportState(); };
  $("importFile").addEventListener("change", (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    closeAllMenus();
    handleImportFile(file);
    ev.target.value = "";
  });

  // Menu open/close
  for (const trigger of document.querySelectorAll(".menu__trigger")) {
    trigger.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const menu = trigger.closest(".menu");
      const wasOpen = menu.classList.contains("menu--open");
      closeAllMenus();
      if (!wasOpen) menu.classList.add("menu--open");
    });
  }
  document.addEventListener("click", closeAllMenus);

  // Words-per-row control
  const wprInput = $("wordsPerRow");
  wprInput.value = String(wordsPerRow);
  wprInput.addEventListener("change", () => {
    const v = parseInt(wprInput.value, 10);
    if (!Number.isFinite(v) || v < 1) {
      wprInput.value = String(wordsPerRow);
      return;
    }
    wordsPerRow = v;
    renderGrid();
  });
  wprInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") wprInput.blur();
  });

  // Rows-per-break control
  const rpbInput = $("rowsPerBreak");
  rpbInput.value = String(rowsPerBreak);
  rpbInput.addEventListener("change", () => {
    const v = parseInt(rpbInput.value, 10);
    if (!Number.isFinite(v) || v < 1) {
      rpbInput.value = String(rowsPerBreak);
      return;
    }
    rowsPerBreak = v;
    renderGrid();
  });
  rpbInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") rpbInput.blur();
  });

  // Interactive mode
  $("startInteractiveBtn").addEventListener("click", startInteractiveMode);
  $("intClose").addEventListener("click", () => {
    intPending = {};
    closeInteractiveMode();
  });
  $("intNext").addEventListener("click", intNext);

  // Escape closes overlays
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      if (intActive) { intPending = {}; closeInteractiveMode(); }
      closeAllMenus();
    }
  });
}

wireEvents();
renderGrid();
