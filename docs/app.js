/* Tagged Table - no build step, pure JS.
 * Data model:
 * {
 *   version: 1,
 *   nextId: number,
 *   tags: string[],
 *   elements: Array<{ id: number, text: string, tags: Record<string, number> }>
 * }
 */
const STORAGE_KEY = "tagged_table_state_v1";

const Tri = { OFF: 0, POS: 1, NEG: 2 };
const SortTri = { OFF: 0, ASC: 1, DESC: 2 };

const defaultState = () => ({
  version: 1,
  nextId: 1,
  tags: [],
  elements: [],
  ui: {
    filterText: "",
    filterTags: {}, // tag -> Tri
    sort: {
      order: SortTri.ASC, // default ON asc
      text: SortTri.OFF,
      tags: {}, // tag -> SortTri
    },
    enabledSort: ["order"], // keys: "order", "text", "tag:<name>"
  },
});

let state = loadState();

function $(id) { return document.getElementById(id); }

function toast(msg) {
  const el = $("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 1400);
}

function normalizeTagName(name) { return name.trim(); }
function isValidTagName(name) { return !!name && !/[\u0000-\u001f]/.test(name); }

function pruneKeys(obj, allowedKeys) {
  const out = {};
  for (const k of Object.keys(obj || {})) if (allowedKeys.includes(k)) out[k] = obj[k];
  return out;
}

function saveState() {
  const toSave = structuredClone(state);
  toSave.ui.filterTags = pruneKeys(toSave.ui.filterTags, toSave.tags);
  toSave.ui.sort.tags = pruneKeys(toSave.ui.sort.tags, toSave.tags);
  toSave.ui.enabledSort = toSave.ui.enabledSort.filter(
    (k) => k === "order" || k === "text" || (k.startsWith("tag:") && toSave.tags.includes(k.slice(4)))
  );
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
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

function toSortTri(v, fallback) {
  if (v === SortTri.OFF || v === SortTri.ASC || v === SortTri.DESC) return v;
  return fallback;
}

function migrateAndNormalize(s) {
  const base = defaultState();
  const out = { ...base, ...s };

  out.version = 1;
  out.nextId = typeof out.nextId === "number" && out.nextId >= 1 ? Math.floor(out.nextId) : 1;

  out.tags = Array.isArray(out.tags)
    ? out.tags.filter((t) => typeof t === "string").map(normalizeTagName).filter(isValidTagName)
    : [];
  out.tags = Array.from(new Set(out.tags));

  out.elements = Array.isArray(out.elements) ? out.elements : [];
  out.elements = out.elements
    .map((e) => ({
      id: typeof e?.id === "number" ? Math.floor(e.id) : null,
      text: typeof e?.text === "string" ? e.text : "",
      tags: typeof e?.tags === "object" && e.tags ? e.tags : {},
    }))
    .filter((e) => e.id !== null);

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

  out.ui = out.ui && typeof out.ui === "object" ? out.ui : base.ui;
  out.ui.filterText = typeof out.ui.filterText === "string" ? out.ui.filterText : "";
  out.ui.filterTags = out.ui.filterTags && typeof out.ui.filterTags === "object" ? out.ui.filterTags : {};
  out.ui.sort = out.ui.sort && typeof out.ui.sort === "object" ? out.ui.sort : base.ui.sort;
  out.ui.sort.order = toSortTri(out.ui.sort.order, SortTri.ASC);
  out.ui.sort.text = toSortTri(out.ui.sort.text, SortTri.OFF);
  out.ui.sort.tags = out.ui.sort.tags && typeof out.ui.sort.tags === "object" ? out.ui.sort.tags : {};
  out.ui.enabledSort = Array.isArray(out.ui.enabledSort) ? out.ui.enabledSort.slice() : ["order"];
  if (!out.ui.enabledSort.includes("order")) out.ui.enabledSort.unshift("order");
  out.ui.enabledSort = out.ui.enabledSort.filter(
    (k) => k === "order" || k === "text" || (k.startsWith("tag:") && out.tags.includes(k.slice(4)))
  );
  if (out.ui.enabledSort.length === 0) out.ui.enabledSort = ["order"];

  out.ui.filterTags = pruneKeys(out.ui.filterTags, out.tags);
  out.ui.sort.tags = pruneKeys(out.ui.sort.tags, out.tags);

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

function cycleTri(current) {
  if (current === Tri.OFF) return Tri.POS;
  if (current === Tri.POS) return Tri.NEG;
  return Tri.OFF;
}

function cycleSortTri(current) {
  if (current === SortTri.OFF) return SortTri.ASC;
  if (current === SortTri.ASC) return SortTri.DESC;
  return SortTri.OFF;
}

function sortKeyKind(key) {
  if (key === "order") return { kind: "order" };
  if (key === "text") return { kind: "text" };
  if (key.startsWith("tag:")) return { kind: "tag", tag: key.slice(4) };
  return { kind: "unknown" };
}

function getSortKeyLabel(key) {
  if (key === "order") return "order";
  if (key === "text") return "text";
  if (key.startsWith("tag:")) return key.slice(4);
  return key;
}

function ensureTagUi(tag) {
  if (!(tag in state.ui.filterTags)) state.ui.filterTags[tag] = Tri.OFF;
  if (!(tag in state.ui.sort.tags)) state.ui.sort.tags[tag] = SortTri.OFF;
}

function enableSortKey(key) {
  state.ui.enabledSort = state.ui.enabledSort.filter((k) => k !== key);
  state.ui.enabledSort.unshift(key);
}

function disableSortKey(key) {
  state.ui.enabledSort = state.ui.enabledSort.filter((k) => k !== key);
  if (state.ui.enabledSort.length === 0) {
    state.ui.sort.order = SortTri.ASC;
    state.ui.enabledSort = ["order"];
  }
}

function currentSortTriForKey(key) {
  if (key === "order") return state.ui.sort.order;
  if (key === "text") return state.ui.sort.text;
  if (key.startsWith("tag:")) return state.ui.sort.tags[key.slice(4)] ?? SortTri.OFF;
  return SortTri.OFF;
}

function setSortTriForKey(key, tri) {
  if (key === "order") state.ui.sort.order = tri;
  else if (key === "text") state.ui.sort.text = tri;
  else if (key.startsWith("tag:")) state.ui.sort.tags[key.slice(4)] = tri;
}

function filterElement(el) {
  const ft = (state.ui.filterText || "").trim().toLowerCase();
  if (ft && !el.text.toLowerCase().includes(ft)) return false;

  for (const tag of state.tags) {
    const mode = state.ui.filterTags[tag] ?? Tri.OFF;
    if (mode === Tri.OFF) continue;
    const has = Object.prototype.hasOwnProperty.call(el.tags, tag);
    if (mode === Tri.POS && !has) return false;
    if (mode === Tri.NEG && has) return false;
  }
  return true;
}

function compareByKey(a, b, key) {
  const { kind, tag } = sortKeyKind(key);
  const tri = currentSortTriForKey(key);
  const dir = tri === SortTri.DESC ? -1 : 1;

  if (kind === "order") {
    const ia = state.elements.findIndex((e) => e.id === a.id);
    const ib = state.elements.findIndex((e) => e.id === b.id);
    return dir * (ia - ib);
  }

  if (kind === "text") {
    const ta = (a.text || "").toLowerCase();
    const tb = (b.text || "").toLowerCase();
    if (ta < tb) return -1 * dir;
    if (ta > tb) return 1 * dir;
    return 0;
  }

  if (kind === "tag") {
    const hasA = a.tags && Object.prototype.hasOwnProperty.call(a.tags, tag);
    const hasB = b.tags && Object.prototype.hasOwnProperty.call(b.tags, tag);
    if (hasA && !hasB) return -1;
    if (!hasA && hasB) return 1;
    if (!hasA && !hasB) return 0;

    const pa = Number(a.tags[tag]);
    const pb = Number(b.tags[tag]);
    if (pa < pb) return -1 * dir;
    if (pa > pb) return 1 * dir;
    return 0;
  }

  return 0;
}

function getVisibleElements() {
  const filtered = state.elements.filter(filterElement);
  const enabled = state.ui.enabledSort
    .slice()
    .filter((k) => currentSortTriForKey(k) !== SortTri.OFF);

  if (enabled.length === 0) return filtered;

  return filtered.slice().sort((a, b) => {
    for (const key of enabled) {
      const c = compareByKey(a, b, key);
      if (c !== 0) return c;
    }
    return 0;
  });
}

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
  downloadJson("tagged_table.json", {
    version: 1,
    nextId: state.nextId,
    tags: state.tags,
    elements: state.elements,
  });
  toast("Exported JSON");
}

function resetProject() {
  if (!confirm("Start a new project? This will clear all current data.")) return;
  state = defaultState();
  saveState();
  render();
  toast("Started a new project");
}

function handleImportFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const obj = JSON.parse(String(reader.result || ""));
      importStateFromObject(obj);
    } catch (e) {
      console.error(e);
      toast("Invalid JSON");
      alert("Invalid JSON file.");
    }
  };
  reader.readAsText(file);
}

function importStateFromObject(obj) {
  const incoming = migrateAndNormalize({ ...obj, ui: state.ui });

  const tagSet = new Set(incoming.tags);
  for (const e of incoming.elements) for (const t of Object.keys(e.tags || {})) tagSet.add(t);
  incoming.tags = Array.from(tagSet);

  for (const t of incoming.tags) {
    if (!(t in incoming.ui.filterTags)) incoming.ui.filterTags[t] = Tri.OFF;
    if (!(t in incoming.ui.sort.tags)) incoming.ui.sort.tags[t] = SortTri.OFF;
  }

  if (!incoming.ui.enabledSort.includes("order")) incoming.ui.enabledSort.unshift("order");
  if (incoming.ui.enabledSort.length === 0) incoming.ui.enabledSort = ["order"];

  state = incoming;
  saveState();
  render();
  toast("Imported JSON");
}

function addTag(name) {
  name = normalizeTagName(name);
  if (!isValidTagName(name)) return toast("Invalid tag name");
  if (state.tags.includes(name)) return toast("Tag already exists");
  state.tags.push(name);
  ensureTagUi(name);
  saveState();
  render();
}

function renameTag(oldName, newName) {
  newName = normalizeTagName(newName);
  if (!isValidTagName(newName)) return toast("Invalid tag name");
  if (oldName === newName) return;
  if (state.tags.includes(newName)) return toast("Tag already exists");

  state.tags = state.tags.map((t) => (t === oldName ? newName : t));

  state.ui.filterTags[newName] = state.ui.filterTags[oldName] ?? Tri.OFF;
  delete state.ui.filterTags[oldName];

  state.ui.sort.tags[newName] = state.ui.sort.tags[oldName] ?? SortTri.OFF;
  delete state.ui.sort.tags[oldName];

  state.ui.enabledSort = state.ui.enabledSort.map((k) =>
    k === `tag:${oldName}` ? `tag:${newName}` : k
  );

  for (const el of state.elements) {
    if (Object.prototype.hasOwnProperty.call(el.tags, oldName)) {
      el.tags[newName] = el.tags[oldName];
      delete el.tags[oldName];
    }
  }

  saveState();
  render();
}

function deleteTag(name) {
  if (!confirm(`Delete tag "${name}"? This removes it from all elements.`)) return;

  state.tags = state.tags.filter((t) => t !== name);
  delete state.ui.filterTags[name];
  delete state.ui.sort.tags[name];
  state.ui.enabledSort = state.ui.enabledSort.filter((k) => k !== `tag:${name}`);

  for (const el of state.elements) delete el.tags[name];

  if (state.ui.enabledSort.length === 0) {
    state.ui.sort.order = SortTri.ASC;
    state.ui.enabledSort = ["order"];
  }

  saveState();
  render();
}

function addElement(text) {
  text = String(text ?? "").trim();
  if (!text) return toast("Empty element");
  state.elements.push({ id: state.nextId++, text, tags: {} });
  saveState();
  render();
}

function deleteElement(id) {
  const idx = state.elements.findIndex((e) => e.id === id);
  if (idx < 0) return;
  if (!confirm(`Delete element #${id}?`)) return;
  state.elements.splice(idx, 1);
  saveState();
  render();
}

function setElementText(id, text) {
  const el = state.elements.find((e) => e.id === id);
  if (!el) return;
  el.text = String(text ?? "");
  saveState();
  render();
}

function setElementTagPriority(id, tag, priority) {
  const el = state.elements.find((e) => e.id === id);
  if (!el) return;

  ensureTagUi(tag);
  if (!state.tags.includes(tag)) state.tags.push(tag);

  const n = Number(priority);
  if (!Number.isFinite(n)) return;
  el.tags[tag] = Math.trunc(n);
  saveState();
  render();
}

function removeElementTag(id, tag) {
  const el = state.elements.find((e) => e.id === id);
  if (!el) return;
  if (Object.prototype.hasOwnProperty.call(el.tags, tag)) {
    delete el.tags[tag];
    saveState();
    render();
  }
}

function pillClass(tri) {
  let cls = "pill";
  if (tri === Tri.POS) cls += " pill--pos";
  if (tri === Tri.NEG) cls += " pill--neg";
  return cls;
}

function sortPillClass(tri) {
  let cls = "pill";
  if (tri === SortTri.ASC) cls += " pill--pos";
  if (tri === SortTri.DESC) cls += " pill--neg";
  return cls;
}

function renderTagsPanel() {
  const list = $("tagList");
  list.innerHTML = "";

  if (state.tags.length === 0) {
    const empty = document.createElement("div");
    empty.className = "subtitle";
    empty.textContent = "No tags yet. Add one above.";
    list.appendChild(empty);
    return;
  }

  for (const tag of state.tags) {
    const row = document.createElement("div");
    row.className = "tagRow";

    const name = document.createElement("div");
    name.className = "tagRow__name";
    name.textContent = tag;

    const actions = document.createElement("div");
    actions.className = "tagRow__actions";

    const renameBtn = document.createElement("button");
    renameBtn.className = "iconBtn";
    renameBtn.textContent = "Rename";
    renameBtn.onclick = () => {
      const next = prompt(`Rename tag "${tag}" to:`, tag);
      if (next == null) return;
      renameTag(tag, next);
    };

    const delBtn = document.createElement("button");
    delBtn.className = "iconBtn";
    delBtn.textContent = "Delete";
    delBtn.onclick = () => deleteTag(tag);

    actions.append(renameBtn, delBtn);
    row.append(name, actions);
    list.appendChild(row);
  }
}

function renderTagChip(el, tagName) {
  const chip = document.createElement("span");
  chip.className = "tagChip";

  const name = document.createElement("span");
  name.className = "tagChip__name";
  name.textContent = tagName;

  const input = document.createElement("input");
  input.type = "number";
  input.step = "1";
  input.value = String(el.tags[tagName] ?? 0);
  input.title = "Priority";
  input.addEventListener("change", () => setElementTagPriority(el.id, tagName, input.value));

  const rm = document.createElement("button");
  rm.className = "tagChip__remove";
  rm.textContent = "×";
  rm.title = "Remove tag from element";
  rm.onclick = () => removeElementTag(el.id, tagName);

  chip.append(name, input, rm);
  return chip;
}

function renderElements() {
  const container = $("elements");
  container.innerHTML = "";

  const els = getVisibleElements();
  if (els.length === 0) {
    const empty = document.createElement("div");
    empty.className = "subtitle";
    empty.textContent = "No elements match the current filter.";
    container.appendChild(empty);
    return;
  }

  for (const el of els) {
    const card = document.createElement("div");
    card.className = "element";

    const top = document.createElement("div");
    top.className = "element__top";

    const id = document.createElement("div");
    id.className = "element__id";
    id.textContent = `#${el.id}`;

    const textWrap = document.createElement("div");
    textWrap.className = "element__text";

    const input = document.createElement("input");
    input.className = "input";
    input.value = el.text;
    input.onchange = () => setElementText(el.id, input.value);
    input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") input.blur(); });

    textWrap.appendChild(input);

    const actions = document.createElement("div");
    actions.className = "element__actions";

    const del = document.createElement("button");
    del.className = "iconBtn";
    del.textContent = "Delete";
    del.onclick = () => deleteElement(el.id);

    actions.appendChild(del);
    top.append(id, textWrap, actions);

    const tags = document.createElement("div");
    tags.className = "element__tags";

    for (const tagName of state.tags) {
      if (!Object.prototype.hasOwnProperty.call(el.tags, tagName)) continue;
      tags.appendChild(renderTagChip(el, tagName));
    }

    const addChip = document.createElement("span");
    addChip.className = "tagChip";
    const addLabel = document.createElement("span");
    addLabel.className = "tagChip__name";
    addLabel.textContent = "Add tag";

    const select = document.createElement("select");
    select.className = "input";
    select.style.padding = "6px 10px";
    select.style.width = "160px";

    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "Choose…";
    select.appendChild(opt0);

    for (const tagName of state.tags) {
      if (Object.prototype.hasOwnProperty.call(el.tags, tagName)) continue;
      const opt = document.createElement("option");
      opt.value = tagName;
      opt.textContent = tagName;
      select.appendChild(opt);
    }

    select.onchange = () => {
      const t = select.value;
      if (!t) return;
      setElementTagPriority(el.id, t, 1);
      select.value = "";
    };

    addChip.append(addLabel, select);
    tags.appendChild(addChip);

    card.append(top, tags);
    container.appendChild(card);
  }
}

function renderFilterPanel() {
  const ft = $("filterText");
  ft.value = state.ui.filterText;
  ft.oninput = () => {
    state.ui.filterText = ft.value;
    saveState();
    renderElements();
  };

  const pills = $("filterTagPills");
  pills.innerHTML = "";

  if (state.tags.length === 0) {
    const empty = document.createElement("div");
    empty.className = "subtitle";
    empty.textContent = "No tag filters yet.";
    pills.appendChild(empty);
    return;
  }

  for (const tag of state.tags) {
    ensureTagUi(tag);
    const tri = state.ui.filterTags[tag];

    const pill = document.createElement("button");
    pill.className = pillClass(tri);
    pill.title = "Filter: off → include → exclude";
    pill.onclick = () => {
      state.ui.filterTags[tag] = cycleTri(state.ui.filterTags[tag] ?? Tri.OFF);
      saveState();
      render();
    };

    const k = document.createElement("span");
    k.className = "pill__k";
    k.textContent = tag;

    pill.appendChild(k);
    pills.appendChild(pill);
  }
}

let dndWired = false;
function wireEnabledSortDnD() {
  if (dndWired) return;
  dndWired = true;

  const enabled = $("enabledSort");
  let draggingKey = null;

  enabled.addEventListener("dragstart", (ev) => {
    const item = ev.target.closest(".enabledItem");
    if (!item) return;
    draggingKey = item.dataset.key;
    ev.dataTransfer.effectAllowed = "move";
    ev.dataTransfer.setData("text/plain", draggingKey);
  });

  enabled.addEventListener("dragover", (ev) => {
    ev.preventDefault();
    const item = ev.target.closest(".enabledItem");
    if (!item) return;
    item.classList.add("dragOver");
    ev.dataTransfer.dropEffect = "move";
  });

  enabled.addEventListener("dragleave", (ev) => {
    const item = ev.target.closest(".enabledItem");
    if (!item) return;
    item.classList.remove("dragOver");
  });

  enabled.addEventListener("drop", (ev) => {
    ev.preventDefault();
    const item = ev.target.closest(".enabledItem");
    if (!item) return;

    const targetKey = item.dataset.key;
    const fromKey = draggingKey || ev.dataTransfer.getData("text/plain");
    draggingKey = null;

    for (const n of enabled.querySelectorAll(".enabledItem.dragOver")) n.classList.remove("dragOver");
    if (!fromKey || !targetKey || fromKey === targetKey) return;

    const list = state.ui.enabledSort.slice();
    const fromIdx = list.indexOf(fromKey);
    const toIdx = list.indexOf(targetKey);
    if (fromIdx < 0 || toIdx < 0) return;

    list.splice(fromIdx, 1);
    list.splice(toIdx, 0, fromKey);

    state.ui.enabledSort = list;
    saveState();
    renderElements();
    renderSortPanel();
  });

  enabled.addEventListener("dragend", () => {
    for (const n of enabled.querySelectorAll(".enabledItem.dragOver")) n.classList.remove("dragOver");
    draggingKey = null;
  });
}

function renderSortPanel() {
  const available = $("availableSort");
  const enabled = $("enabledSort");
  available.innerHTML = "";
  enabled.innerHTML = "";

  const allKeys = ["order", "text", ...state.tags.map((t) => `tag:${t}`)];
  const enabledEntries = state.ui.enabledSort
    .slice()
    .map((key) => ({ key, tri: currentSortTriForKey(key) }))
    .filter((entry) => entry.tri !== SortTri.OFF);
  const enabledSet = new Set(enabledEntries.map((entry) => entry.key));
  const availKeys = allKeys.filter((k) => !enabledSet.has(k));

  for (const key of availKeys) {
    const pill = document.createElement("button");
    pill.className = sortPillClass(SortTri.OFF);
    pill.title = "Enable sort (asc)";
    pill.onclick = () => {
      setSortTriForKey(key, SortTri.ASC);
      enableSortKey(key);
      saveState();
      render();
    };

    const k = document.createElement("span");
    k.className = "pill__k";
    k.textContent = getSortKeyLabel(key);
    pill.appendChild(k);
    available.appendChild(pill);
  }

  if (enabledEntries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "subtitle";
    empty.textContent = "No active sort criteria.";
    enabled.appendChild(empty);
    return;
  }

  for (const { key, tri } of enabledEntries) {
    const row = document.createElement("button");
    row.className = `${sortPillClass(tri)} enabledItem`;
    row.draggable = true;
    row.dataset.key = key;
    row.type = "button";
    row.textContent = `${getSortKeyLabel(key)} ${tri === SortTri.ASC ? "asc" : "desc"}`;
    row.title = "Click: asc → desc → off. Drag to reorder.";
    row.setAttribute("aria-label", `${getSortKeyLabel(key)} sort ${tri === SortTri.ASC ? "asc" : "desc"}. Click to change. Drag to reorder.`);
    row.onclick = () => {
      const next = cycleSortTri(currentSortTriForKey(key));
      setSortTriForKey(key, next);
      if (next === SortTri.OFF) disableSortKey(key);
      saveState();
      render();
    };

    enabled.appendChild(row);
  }

  wireEnabledSortDnD();
}

function render() {
  for (const t of state.tags) ensureTagUi(t);
  renderTagsPanel();
  renderFilterPanel();
  renderSortPanel();
  renderElements();
}

function wireEvents() {
  $("newProjectBtn").onclick = resetProject;
  $("exportBtn").onclick = exportState;
  $("importFile").addEventListener("change", (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    handleImportFile(file);
    ev.target.value = "";
  });

  const newElement = $("newElementText");
  $("addElementBtn").onclick = () => {
    addElement(newElement.value);
    newElement.value = "";
    newElement.focus();
  };
  newElement.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") $("addElementBtn").click();
  });

  const newTag = $("newTagName");
  $("addTagBtn").onclick = () => {
    addTag(newTag.value);
    newTag.value = "";
    newTag.focus();
  };
  newTag.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") $("addTagBtn").click();
  });

  $("resetFiltersBtn").onclick = () => {
    state.ui.filterText = "";
    state.ui.filterTags = {};
    for (const t of state.tags) state.ui.filterTags[t] = Tri.OFF;
    saveState();
    render();
    toast("Filters reset");
  };

  $("resetSortBtn").onclick = () => {
    state.ui.sort.order = SortTri.ASC;
    state.ui.sort.text = SortTri.OFF;
    state.ui.sort.tags = {};
    for (const t of state.tags) state.ui.sort.tags[t] = SortTri.OFF;
    state.ui.enabledSort = ["order"];
    saveState();
    render();
    toast("Sort reset");
  };
}

wireEvents();
render();
