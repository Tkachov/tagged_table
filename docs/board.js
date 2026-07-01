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

// Interactive mode
let intActive = false;
let intQueue = [];      // element IDs to process (snapshot, in order, no "l" tag at start)
let intCursor = 0;      // current position in intQueue (start of current batch)
let intPending = {};    // elementId → value: 1=green, 0=yellow, null=remove tag

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

  for (const el of state.elements) {
    const cell = document.createElement("div");
    cell.className = `word-cell word-cell--${getWordColor(el)}`;
    cell.textContent = el.text;
    cell.title = el.text;
    grid.appendChild(cell);
  }
}

// ── Interactive mode ──────────────────────────────────────────────────────────

function startInteractiveMode() {
  // Snapshot of element IDs without the "l" tag, in original order
  intQueue = state.elements
    .filter((el) => !Object.prototype.hasOwnProperty.call(el.tags || {}, L_TAG))
    .map((el) => el.id);
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
  return "gray"; // elements in the queue have no "l" tag by definition
}

function cycleCardState(elementId) {
  const current = intPending[elementId];
  // gray (undefined/null) → green (1) → yellow (0) → gray (null)
  if (current === undefined || current === null) {
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
  // Ensure "l" tag exists in the tag registry
  if (!state.tags.includes(L_TAG)) {
    state.tags.push(L_TAG);
  }

  for (const [idStr, value] of Object.entries(intPending)) {
    const id = Number(idStr);
    const el = state.elements.find((e) => e.id === id);
    if (!el) continue;

    if (value === null) {
      // Explicitly set to gray means leave untagged; skip (it was already untagged)
      // (do nothing – the element stays without "l" tag)
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
    toast("Done! All words have been reviewed.");
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
