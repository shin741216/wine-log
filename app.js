// ワイン記録 — 飲んだワインを端末内（IndexedDB）に記録する個人用PWA
// 画面: 一覧(list) / 詳細(detail) / 入力(form) / 設定(settings)
// データは端末内にだけ保存される。バックアップは設定画面のJSONエクスポートで。

const COLORS = ["白", "赤", "ロゼ", "泡", "その他"];
const DB_NAME = "wine-log";
const DB_VER = 1;
const STORE = "wines";

// ---------- IndexedDB ----------
let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: "id" });
        s.createIndex("date", "date");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
async function dbRun(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const dbAll = () => dbRun("readonly", (s) => s.getAll());
const dbGet = (id) => dbRun("readonly", (s) => s.get(id));
const dbPut = (rec) => dbRun("readwrite", (s) => s.put(rec));
const dbDel = (id) => dbRun("readwrite", (s) => s.delete(id));
const dbPutMany = (recs) => dbRun("readwrite", (s) => { recs.forEach((r) => s.put(r)); return null; });
const dbClear = () => dbRun("readwrite", (s) => s.clear());

// ---------- state ----------
const state = {
  screen: "list",
  filter: { q: "", color: "すべて", sort: "date" },
  wines: [],
  current: null, // 詳細・編集中のid
  draft: null,   // 入力中のレコード
  stack: [],     // 戻る用
};

const $ = (sel) => document.querySelector(sel);
const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC_MAP[c]);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const stars = (n) => {
  n = Number(n) || 0;
  if (!n) return `<span class="stars"><span class="off">☆☆☆☆☆</span></span>`;
  return `<span class="stars">${"★".repeat(n)}<span class="off">${"☆".repeat(5 - n)}</span></span>`;
};
const fmtPrice = (p) => (p === "" || p == null) ? "" : `¥${Number(p).toLocaleString()}`;
const colorBadge = (c) => `<span class="color-badge c-${esc(c)}">${esc(c)}</span>`;

let toastTimer = null;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 1800);
}

// ---------- navigation ----------
function go(screen, opts = {}) {
  if (!opts.replace) state.stack.push({ screen: state.screen, current: state.current });
  state.screen = screen;
  if ("current" in opts) state.current = opts.current;
  render();
}
function back() {
  const prev = state.stack.pop();
  if (!prev) { state.screen = "list"; state.current = null; }
  else { state.screen = prev.screen; state.current = prev.current; }
  render();
}

async function render() {
  const main = $("#screen");
  const title = $("#header-title");
  const btnBack = $("#btn-back");
  const spacerL = $("#header-spacer-l");
  const btnSettings = $("#btn-settings");
  const spacerR = $("#header-spacer-r");
  const footer = $("#footer-bar");
  const bAdd = $("#btn-add"), bSave = $("#btn-save"), bCancel = $("#btn-cancel");
  [bAdd, bSave, bCancel].forEach((b) => b.classList.add("hidden"));
  footer.classList.remove("hidden");
  const isList = state.screen === "list";
  btnBack.classList.toggle("hidden", isList);
  spacerL.classList.toggle("hidden", !isList);
  btnSettings.classList.toggle("hidden", !isList);
  spacerR.classList.toggle("hidden", isList);

  if (state.screen === "list") {
    title.textContent = "ワイン記録";
    state.wines = await dbAll();
    main.innerHTML = renderList();
    bindList();
    bAdd.classList.remove("hidden");
  } else if (state.screen === "detail") {
    title.textContent = "詳細";
    const w = await dbGet(state.current);
    if (!w) { toast("記録が見つかりません"); state.stack = []; go("list", { replace: true, current: null }); return; }
    main.innerHTML = renderDetail(w);
    bindDetail(w);
    footer.classList.add("hidden");
  } else if (state.screen === "form") {
    title.textContent = state.current ? "記録を編集" : "新しい記録";
    if (!state.draft) {
      state.draft = state.current ? { ...(await dbGet(state.current)) } : blank();
    }
    state.wines = await dbAll();
    main.innerHTML = renderForm(state.draft);
    bindForm();
    bSave.classList.remove("hidden");
    bCancel.classList.remove("hidden");
  } else if (state.screen === "settings") {
    title.textContent = "設定";
    state.wines = await dbAll();
    main.innerHTML = renderSettings();
    bindSettings();
    footer.classList.add("hidden");
  }
  window.scrollTo(0, 0);
}

function blank() {
  return {
    id: newId(), date: today(), name: "", color: "赤", country: "", region: "", producer: "",
    grape: "", vintage: "", price: "", rating: 0, place: "", memo: "",
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}

// ---------- list ----------
function filtered() {
  const { q, color, sort } = state.filter;
  const kw = q.trim().toLowerCase();
  const list = state.wines.filter((w) => {
    if (color !== "すべて" && w.color !== color) return false;
    if (!kw) return true;
    const hay = [w.name, w.country, w.region, w.producer, w.grape, w.vintage, w.place, w.memo].join(" ").toLowerCase();
    return hay.includes(kw);
  });
  const by = {
    date: (a, b) => (b.date || "").localeCompare(a.date || "") || b.createdAt - a.createdAt,
    rating: (a, b) => (b.rating || 0) - (a.rating || 0) || (b.date || "").localeCompare(a.date || ""),
    price: (a, b) => (Number(b.price) || 0) - (Number(a.price) || 0),
    name: (a, b) => (a.name || "").localeCompare(b.name || "", "ja"),
  };
  list.sort(by[sort] || by.date);
  return list;
}

function renderList() {
  const list = filtered();
  const f = state.filter;
  const chips = ["すべて", ...COLORS].map((c) => `<button class="chip ${f.color === c ? "on" : ""}" data-color="${c}">${c}</button>`).join("");
  const emptyMsg = state.wines.length ? "条件に合う記録がありません" : "まだ記録がありません。<br>下の「＋ 記録する」から追加できます。";
  const cards = list.length ? list.map(renderCard).join("") : `<div class="empty">${emptyMsg}</div>`;
  const opt = (v, label) => `<option value="${v}" ${f.sort === v ? "selected" : ""}>${label}</option>`;
  return `
    <div class="search-bar">
      <input id="q" type="search" placeholder="銘柄・産地・品種・メモで検索" value="${esc(f.q)}">
      <select id="sort">${opt("date", "日付順")}${opt("rating", "評価順")}${opt("price", "価格順")}${opt("name", "名前順")}</select>
    </div>
    <div class="chips">${chips}</div>
    <div class="count">${list.length} 件${state.wines.length !== list.length ? ` / 全 ${state.wines.length} 件` : ""}</div>
    ${cards}`;
}

function renderCard(w) {
  const sub = [w.country, w.region, w.grape, w.vintage ? `${w.vintage}年` : ""].filter(Boolean).join(" · ");
  const producer = w.producer ? `<div class="sub">${esc(w.producer)}</div>` : "";
  return `
    <div class="card" data-id="${w.id}">
      <div class="bar c-${esc(w.color)}"></div>
      <div>
        <div class="name">${colorBadge(w.color)}${esc(w.name) || "(銘柄なし)"}</div>
        ${producer}
        <div class="sub">${esc(sub)}</div>
        ${w.memo ? `<div class="memo">${esc(w.memo)}</div>` : ""}
      </div>
      <div class="right">
        ${stars(w.rating)}
        <div>${esc(w.date)}</div>
        <div>${fmtPrice(w.price)}</div>
      </div>
    </div>`;
}

function bindList() {
  $("#q").addEventListener("input", (e) => { state.filter.q = e.target.value; refreshList(); });
  $("#sort").addEventListener("change", (e) => { state.filter.sort = e.target.value; refreshList(); });
  document.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => { state.filter.color = c.dataset.color; refreshList(); }));
  document.querySelectorAll(".card").forEach((c) => c.addEventListener("click", () => go("detail", { current: c.dataset.id })));
}
function refreshList() {
  // 入力中のフォーカスを保つため、描き直した後に検索欄へ戻す
  const q = $("#q");
  const pos = q === document.activeElement ? q.selectionStart : null;
  $("#screen").innerHTML = renderList();
  bindList();
  if (pos != null) { const nq = $("#q"); nq.focus(); nq.setSelectionRange(pos, pos); }
}

// ---------- detail ----------
function renderDetail(w) {
  const rows = [
    ["日付", w.date],
    ["色", w.color],
    ["生産者", w.producer],
    ["生産国", w.country],
    ["地域", w.region],
    ["品種", w.grape],
    ["ヴィンテージ", w.vintage ? `${w.vintage}年` : ""],
    ["価格", fmtPrice(w.price)],
    ["場所", w.place],
    ["メモ", w.memo],
  ].filter(([, v]) => v !== "" && v != null);
  return `
    <div class="detail">
      <h2>${colorBadge(w.color)}${esc(w.name) || "(銘柄なし)"}</h2>
      <div>${stars(w.rating)}</div>
      <dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
      <div class="btn-row">
        <button id="d-edit" class="btn-primary">編集する</button>
        <button id="d-copy" class="btn-secondary">同じワインを記録</button>
      </div>
      <div class="btn-row">
        <button id="d-del" class="btn-danger">この記録を削除</button>
      </div>
    </div>`;
}
function bindDetail(w) {
  $("#d-edit").addEventListener("click", () => { state.draft = null; go("form", { current: w.id }); });
  $("#d-copy").addEventListener("click", () => {
    state.draft = { ...w, id: newId(), date: today(), rating: 0, memo: "", createdAt: Date.now(), updatedAt: Date.now() };
    go("form", { current: null });
  });
  $("#d-del").addEventListener("click", async () => {
    if (!confirm(`「${w.name || "(銘柄なし)"}」の記録を削除します。よろしいですか？`)) return;
    await dbDel(w.id);
    toast("削除しました");
    state.stack = [];
    go("list", { replace: true, current: null });
  });
}

// ---------- form ----------
function uniq(key) {
  return [...new Set(state.wines.map((w) => (w[key] || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
}
function renderForm(d) {
  const dl = (id, key) => `<datalist id="${id}">${uniq(key).map((v) => `<option value="${esc(v)}">`).join("")}</datalist>`;
  const seg = COLORS.map((c) => `<button type="button" class="${d.color === c ? "on" : ""}" data-color="${c}">${c}</button>`).join("");
  const rate = [1, 2, 3, 4, 5].map((n) => `<button type="button" class="${d.rating >= n ? "on" : ""}" data-rate="${n}" aria-label="${n}点">★</button>`).join("");
  return `
    <form class="form" id="form" autocomplete="off">
      <div class="field"><label>銘柄 *</label><input name="name" value="${esc(d.name)}" placeholder="例: シャブリ 1er Cru モンマン" required></div>
      <div class="field"><label>色</label><div class="seg" id="seg-color">${seg}</div></div>
      <div class="field-row">
        <div class="field"><label>日付</label><input name="date" type="date" value="${esc(d.date)}"></div>
        <div class="field"><label>ヴィンテージ</label><input name="vintage" type="number" inputmode="numeric" min="1900" max="2100" value="${esc(d.vintage)}" placeholder="2020"></div>
      </div>
      <div class="field"><label>生産者</label><input name="producer" value="${esc(d.producer)}" list="dl-producer" placeholder="例: ウィリアム・フェーブル">${dl("dl-producer", "producer")}</div>
      <div class="field-row">
        <div class="field"><label>生産国</label><input name="country" value="${esc(d.country)}" list="dl-country" placeholder="フランス">${dl("dl-country", "country")}</div>
        <div class="field"><label>地域</label><input name="region" value="${esc(d.region)}" list="dl-region" placeholder="ブルゴーニュ">${dl("dl-region", "region")}</div>
      </div>
      <div class="field"><label>品種</label><input name="grape" value="${esc(d.grape)}" list="dl-grape" placeholder="シャルドネ">${dl("dl-grape", "grape")}</div>
      <div class="field-row">
        <div class="field"><label>価格（円）</label><input name="price" type="number" inputmode="numeric" min="0" value="${esc(d.price)}" placeholder="3000"></div>
        <div class="field"><label>場所（店・購入先）</label><input name="place" value="${esc(d.place)}" list="dl-place" placeholder="自宅 / まるすけ">${dl("dl-place", "place")}</div>
      </div>
      <div class="field"><label>評価</label>
        <div class="rating-input" id="rating">${rate}<button type="button" class="clear" data-rate="0">クリア</button></div>
      </div>
      <div class="field"><label>メモ</label><textarea name="memo" placeholder="香り・味わい・合わせた料理・また買うかなど">${esc(d.memo)}</textarea></div>
    </form>`;
}
function readForm() {
  const f = $("#form");
  const d = state.draft;
  ["name", "date", "vintage", "producer", "country", "region", "grape", "price", "place", "memo"].forEach((k) => { d[k] = f.elements[k].value.trim(); });
  return d;
}
function bindForm() {
  const d = state.draft;
  $("#form").addEventListener("input", () => readForm());
  $("#form").addEventListener("submit", (e) => { e.preventDefault(); save(); });
  $("#seg-color").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    d.color = b.dataset.color;
    $("#seg-color").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
  }));
  $("#rating").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    d.rating = Number(b.dataset.rate);
    $("#rating").querySelectorAll("button[data-rate]").forEach((x) => {
      const n = Number(x.dataset.rate);
      x.classList.toggle("on", n > 0 && d.rating >= n);
    });
  }));
}
async function save() {
  const d = readForm();
  if (!d.name) { toast("銘柄を入力してください"); $("#form").elements.name.focus(); return; }
  if (!d.date) d.date = today();
  d.updatedAt = Date.now();
  const isNew = !state.current;
  await dbPut(d);
  state.draft = null;
  toast(isNew ? "記録しました" : "更新しました");
  state.stack = [];
  go("detail", { replace: true, current: d.id });
}
function cancelForm() {
  state.draft = null;
  back();
}

// ---------- settings ----------
function renderSettings() {
  const ws = state.wines;
  const n = ws.length;
  const rated = ws.filter((w) => w.rating > 0);
  const avg = rated.length ? (rated.reduce((s, w) => s + w.rating, 0) / rated.length).toFixed(1) : "-";
  const spent = ws.reduce((s, w) => s + (Number(w.price) || 0), 0);
  const byColor = COLORS.map((c) => [c, ws.filter((w) => w.color === c).length]).filter(([, k]) => k);
  const top = (key) => {
    const m = new Map();
    ws.forEach((w) => { const v = (w[key] || "").trim(); if (v) m.set(v, (m.get(v) || 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  };
  const rank = (title, rows) => rows.length ? `<h2>${title}</h2><ul class="rank">${rows.map(([k, v]) => `<li><span>${esc(k)}</span><span>${v} 本</span></li>`).join("")}</ul>` : "";
  const g = top("grape"), c = top("country");
  const rankSection = (g.length || c.length) ? `<div class="section">${rank("よく飲む品種", g)}${rank("よく飲む生産国", c)}</div>` : "";
  return `
    <div class="section">
      <h2>集計</h2>
      <div class="stat-grid">
        <div class="stat"><div class="v">${n}</div><div class="k">記録数</div></div>
        <div class="stat"><div class="v">${avg}</div><div class="k">平均評価</div></div>
        <div class="stat"><div class="v">${spent ? "¥" + spent.toLocaleString() : "-"}</div><div class="k">合計金額</div></div>
        ${byColor.map(([col, k]) => `<div class="stat"><div class="v">${k}</div><div class="k">${col}</div></div>`).join("")}
      </div>
    </div>
    ${rankSection}
    <div class="section">
      <h2>バックアップ</h2>
      <p>記録はこの端末のブラウザ内にだけ保存されます。機種変更やSafariのデータ削除で消えるので、ときどきJSONに書き出して保管してください。</p>
      <div class="btn-row">
        <button id="s-export" class="btn-primary">JSONに書き出す</button>
        <button id="s-import" class="btn-secondary">JSONを読み込む</button>
      </div>
      <input id="s-file" type="file" accept="application/json,.json" class="hidden">
      <p class="note">読み込みは同じIDの記録を上書きし、それ以外は追加します（既存の記録は消えません）。</p>
    </div>
    <div class="section">
      <h2>危険な操作</h2>
      <div class="btn-row"><button id="s-clear" class="btn-danger">すべての記録を削除</button></div>
    </div>
    <div class="version">ワイン記録 v${APP_VERSION}</div>`;
}
function bindSettings() {
  $("#s-export").addEventListener("click", exportJSON);
  $("#s-import").addEventListener("click", () => $("#s-file").click());
  $("#s-file").addEventListener("change", importJSON);
  $("#s-clear").addEventListener("click", async () => {
    if (!confirm(`全 ${state.wines.length} 件の記録を削除します。元に戻せません。よろしいですか？`)) return;
    if (!confirm("本当に削除しますか？（先にJSONへ書き出すことをおすすめします）")) return;
    await dbClear();
    toast("すべて削除しました");
    render();
  });
}
async function exportJSON() {
  const ws = await dbAll();
  const payload = { app: "wine-log", version: APP_VERSION, exportedAt: new Date().toISOString(), wines: ws };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `wine-log-${today()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(`${ws.length} 件を書き出しました`);
}
async function importJSON(e) {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const list = Array.isArray(data) ? data : data.wines;
    if (!Array.isArray(list)) throw new Error("形式が違います");
    const recs = list
      .filter((w) => w && typeof w === "object" && w.name != null)
      .map((w) => ({ ...blank(), ...w, id: w.id || newId() }));
    if (!confirm(`${recs.length} 件を読み込みます。よろしいですか？`)) return;
    await dbPutMany(recs);
    toast(`${recs.length} 件を読み込みました`);
    render();
  } catch (err) {
    alert(`読み込めませんでした: ${err.message}`);
  }
}

// ---------- boot ----------
$("#btn-back").addEventListener("click", () => { if (state.screen === "form") cancelForm(); else back(); });
$("#btn-settings").addEventListener("click", () => go("settings"));
$("#btn-add").addEventListener("click", () => { state.draft = null; go("form", { current: null }); });
$("#btn-save").addEventListener("click", save);
$("#btn-cancel").addEventListener("click", cancelForm);

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
render();
