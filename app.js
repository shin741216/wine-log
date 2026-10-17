// ワイン記録 — 飲んだワインを端末内（IndexedDB）に記録する個人用PWA
// 画面: 一覧(list) / 詳細(detail) / 入力(form) / 設定(settings)
// データは端末内にだけ保存される。バックアップは設定画面のJSONエクスポートで。
//
// 保存先:
//   wines  … 1本ごとの記録。一覧で使う小さなサムネイル（thumb, JPEG data URL）も持つ
//   photos … ラベル写真の本体 { id: ワインのid, front: 表, back: 裏 }（JPEG data URL、無ければ null）
//   一覧の読み込みを軽く保つため、写真本体は別ストアに分けている。

const COLORS = ["白", "赤", "ロゼ", "泡", "その他"];
const SIDES = [["front", "表"], ["back", "裏"]];
const DB_NAME = "wine-log";
const DB_VER = 2;
const STORE = "wines";
const PHOTO_STORE = "photos";
const PHOTO_MAX_EDGE = 1280; // 写真本体の長辺(px)
const PHOTO_QUALITY = 0.8;
const THUMB_MAX_EDGE = 200;  // サムネイルの長辺(px)
const THUMB_QUALITY = 0.7;

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
      if (!db.objectStoreNames.contains(PHOTO_STORE)) {
        db.createObjectStore(PHOTO_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // 別タブで新しい版が開かれたら閉じて譲る
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
// stores: ストア名か配列。fn(t) が返したリクエストの結果を、トランザクション完了後に返す
async function dbTx(stores, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    const req = fn(t);
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const BOTH = [STORE, PHOTO_STORE];
const dbAll = () => dbTx(STORE, "readonly", (t) => t.objectStore(STORE).getAll());
const dbGet = (id) => dbTx(STORE, "readonly", (t) => t.objectStore(STORE).get(id));
const photoGet = (id) => dbTx(PHOTO_STORE, "readonly", (t) => t.objectStore(PHOTO_STORE).get(id));
const photoAll = () => dbTx(PHOTO_STORE, "readonly", (t) => t.objectStore(PHOTO_STORE).getAll());
// 記録と写真を1つのトランザクションで保存する（片方だけ残る事故を防ぐ）
const dbSaveWine = (rec, photos) => dbTx(BOTH, "readwrite", (t) => {
  t.objectStore(STORE).put(rec);
  const ps = t.objectStore(PHOTO_STORE);
  if (photos && (photos.front || photos.back)) ps.put({ id: rec.id, front: photos.front || null, back: photos.back || null });
  else ps.delete(rec.id);
  return null;
});
const dbDel = (id) => dbTx(BOTH, "readwrite", (t) => {
  t.objectStore(STORE).delete(id);
  t.objectStore(PHOTO_STORE).delete(id);
  return null;
});
const dbPutMany = (recs, photoRecs) => dbTx(BOTH, "readwrite", (t) => {
  const s = t.objectStore(STORE), ps = t.objectStore(PHOTO_STORE);
  recs.forEach((r) => s.put(r));
  photoRecs.forEach((p) => ps.put(p));
  return null;
});
const dbClear = () => dbTx(BOTH, "readwrite", (t) => {
  t.objectStore(STORE).clear();
  t.objectStore(PHOTO_STORE).clear();
  return null;
});

// ---------- state ----------
const state = {
  screen: "list",
  filter: { q: "", color: "すべて", sort: "date" },
  wines: [],
  current: null,   // 詳細・編集中のid
  draft: null,     // 入力中のレコード
  photos: { front: null, back: null }, // 入力中の写真
  photoSide: null, // 写真を選んでいる面
  stack: [],       // 戻る用
};

const $ = (sel) => document.querySelector(sel);
const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC_MAP[c]);
// 画像として受け付けるのは、このアプリが作る形式の data URL だけ（読み込んだJSONも同じ基準で検査する）
const isImgData = (s) => typeof s === "string" && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s);
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
const fmtBytes = (b) => b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
const colorBadge = (c) => `<span class="color-badge c-${esc(c)}">${esc(c)}</span>`;

let toastTimer = null;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 1800);
}

// ---------- 画像処理 ----------
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("画像を読み込めませんでした"));
    img.src = src;
  });
}
// 長辺を maxEdge 以下に縮めて JPEG の data URL にする。
// 向き（EXIF）はブラウザが img の描画時に反映するので、そのまま描けば正しい向きになる。
function toJpeg(img, maxEdge, quality) {
  const w0 = img.naturalWidth, h0 = img.naturalHeight;
  const s = Math.min(1, maxEdge / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * s)), h = Math.max(1, Math.round(h0 * s));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; // 透過PNGの背景を白に
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return c.toDataURL("image/jpeg", quality);
}
async function fileToPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    return toJpeg(await loadImage(url), PHOTO_MAX_EDGE, PHOTO_QUALITY);
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function makeThumb(dataUrl) {
  return toJpeg(await loadImage(dataUrl), THUMB_MAX_EDGE, THUMB_QUALITY);
}
// 写真を保存したら、ブラウザに「消さないで」と頼んでおく（対応ブラウザのみ。断られても動作は同じ）
function requestPersist() {
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist().catch(() => {}); } catch (_) { /* noop */ }
}

// ---------- 写真ビューア ----------
function openViewer(src, caption) {
  if (!isImgData(src)) return;
  $("#viewer-img").src = src;
  $("#viewer-cap").textContent = caption || "";
  $("#viewer").classList.remove("hidden");
}
function closeViewer() {
  $("#viewer").classList.add("hidden");
  $("#viewer-img").removeAttribute("src");
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
  const footer = $("#footer-bar");
  const bAdd = $("#btn-add"), bSave = $("#btn-save"), bCancel = $("#btn-cancel");
  [bAdd, bSave, bCancel].forEach((b) => b.classList.add("hidden"));
  footer.classList.remove("hidden");
  const isList = state.screen === "list";
  $("#btn-back").classList.toggle("hidden", isList);
  $("#header-spacer-l").classList.toggle("hidden", !isList);
  $("#btn-settings").classList.toggle("hidden", !isList);
  $("#header-spacer-r").classList.toggle("hidden", isList);

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
    const photos = (await photoGet(w.id)) || {};
    main.innerHTML = renderDetail(w, photos);
    bindDetail(w, photos);
    footer.classList.add("hidden");
  } else if (state.screen === "form") {
    title.textContent = state.current ? "記録を編集" : "新しい記録";
    if (!state.draft) {
      if (state.current) {
        state.draft = { ...(await dbGet(state.current)) };
        const p = (await photoGet(state.current)) || {};
        state.photos = { front: p.front || null, back: p.back || null };
      } else {
        state.draft = blank();
        state.photos = { front: null, back: null };
      }
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
    grape: "", vintage: "", price: "", rating: 0, place: "", memo: "", thumb: "",
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
  const hasThumb = isImgData(w.thumb);
  return `
    <div class="card ${hasThumb ? "has-thumb" : ""}" data-id="${esc(w.id)}">
      <div class="bar c-${esc(w.color)}"></div>
      ${hasThumb ? `<img class="thumb" src="${w.thumb}" alt="" loading="lazy">` : ""}
      <div class="body">
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
function renderDetail(w, photos) {
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
  const shots = SIDES.filter(([k]) => isImgData(photos[k]));
  const photoHtml = shots.length ? `
      <div class="detail-photos">
        ${shots.map(([k, label]) => `
          <figure class="detail-photo" data-side="${k}">
            <img src="${photos[k]}" alt="ラベル${label}">
            <figcaption>${label}</figcaption>
          </figure>`).join("")}
      </div>` : "";
  return `
    <div class="detail">
      <h2>${colorBadge(w.color)}${esc(w.name) || "(銘柄なし)"}</h2>
      <div>${stars(w.rating)}</div>
      ${photoHtml}
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
function bindDetail(w, photos) {
  document.querySelectorAll(".detail-photo").forEach((f) => f.addEventListener("click", () => {
    const side = f.dataset.side;
    openViewer(photos[side], `${w.name || ""}　ラベル${side === "front" ? "表" : "裏"}`);
  }));
  $("#d-edit").addEventListener("click", () => { state.draft = null; go("form", { current: w.id }); });
  $("#d-copy").addEventListener("click", () => {
    // 同じワインならラベルも同じなので、写真も引き継ぐ（不要なら入力画面で消せる）
    state.draft = { ...w, id: newId(), date: today(), rating: 0, memo: "", createdAt: Date.now(), updatedAt: Date.now() };
    state.photos = { front: photos.front || null, back: photos.back || null };
    go("form", { current: null });
  });
  $("#d-del").addEventListener("click", async () => {
    if (!confirm(`「${w.name || "(銘柄なし)"}」の記録を削除します。写真も消えます。よろしいですか？`)) return;
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
function renderPhotoSlots() {
  return SIDES.map(([k, label]) => {
    const src = state.photos[k];
    if (isImgData(src)) {
      return `
        <div class="photo-slot has">
          <button type="button" class="photo-pick" data-side="${k}" aria-label="${label}の写真を撮り直す"><img src="${src}" alt="ラベル${label}"></button>
          <span class="photo-tag">${label}</span>
          <button type="button" class="photo-del" data-side="${k}" aria-label="${label}の写真を削除">×</button>
        </div>`;
    }
    return `
      <div class="photo-slot">
        <button type="button" class="photo-pick empty" data-side="${k}" aria-label="${label}の写真を追加">
          <span class="plus">📷</span><span>${label}</span>
        </button>
      </div>`;
  }).join("");
}
function renderForm(d) {
  const dl = (id, key) => `<datalist id="${id}">${uniq(key).map((v) => `<option value="${esc(v)}">`).join("")}</datalist>`;
  const seg = COLORS.map((c) => `<button type="button" class="${d.color === c ? "on" : ""}" data-color="${c}">${c}</button>`).join("");
  const rate = [1, 2, 3, 4, 5].map((n) => `<button type="button" class="${d.rating >= n ? "on" : ""}" data-rate="${n}" aria-label="${n}点">★</button>`).join("");
  return `
    <form class="form" id="form" autocomplete="off">
      <div class="field"><label>銘柄 *</label><input name="name" value="${esc(d.name)}" placeholder="例: シャブリ 1er Cru モンマン" required></div>
      <div class="field"><label>ラベル写真</label>
        <div class="photo-slots" id="photo-slots">${renderPhotoSlots()}</div>
        <input id="photo-input" type="file" accept="image/*" class="hidden">
        <p class="note">タップで撮影または写真から選択。保存時に縮小します（1枚 約100〜300KB）。</p>
      </div>
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
function bindPhotoSlots() {
  document.querySelectorAll("#photo-slots .photo-pick").forEach((b) => b.addEventListener("click", () => {
    state.photoSide = b.dataset.side;
    $("#photo-input").click();
  }));
  document.querySelectorAll("#photo-slots .photo-del").forEach((b) => b.addEventListener("click", () => {
    state.photos[b.dataset.side] = null;
    refreshPhotoSlots();
  }));
}
function refreshPhotoSlots() {
  $("#photo-slots").innerHTML = renderPhotoSlots();
  bindPhotoSlots();
}
async function onPhotoChosen(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = ""; // 同じ写真を選び直しても change が来るように
  const side = state.photoSide;
  if (!file || !side) return;
  const slots = $("#photo-slots");
  slots.classList.add("busy");
  try {
    state.photos[side] = await fileToPhoto(file);
    refreshPhotoSlots();
  } catch (err) {
    alert(`写真を読み込めませんでした。別の写真で試してください。\n(${err.message})`);
  } finally {
    slots.classList.remove("busy");
  }
}
function bindForm() {
  const d = state.draft;
  $("#form").addEventListener("input", () => readForm());
  $("#form").addEventListener("submit", (e) => { e.preventDefault(); save(); });
  $("#photo-input").addEventListener("change", onPhotoChosen);
  bindPhotoSlots();
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
let saving = false;
async function save() {
  if (saving) return;
  const d = readForm();
  if (!d.name) { toast("銘柄を入力してください"); $("#form").elements.name.focus(); return; }
  if ($("#photo-slots").classList.contains("busy")) { toast("写真を処理中です"); return; }
  saving = true;
  try {
    if (!d.date) d.date = today();
    d.updatedAt = Date.now();
    const photos = { front: isImgData(state.photos.front) ? state.photos.front : null, back: isImgData(state.photos.back) ? state.photos.back : null };
    const cover = photos.front || photos.back;
    d.thumb = cover ? await makeThumb(cover) : "";
    const isNew = !state.current;
    await dbSaveWine(d, photos);
    if (cover) requestPersist();
    state.draft = null;
    state.photos = { front: null, back: null };
    toast(isNew ? "記録しました" : "更新しました");
    state.stack = [];
    go("detail", { replace: true, current: d.id });
  } catch (err) {
    alert(`保存できませんでした: ${err.message || err}\n端末の空き容量が足りない可能性があります。`);
  } finally {
    saving = false;
  }
}
function cancelForm() {
  state.draft = null;
  state.photos = { front: null, back: null };
  back();
}

// ---------- settings ----------
function renderSettings() {
  const ws = state.wines;
  const n = ws.length;
  const rated = ws.filter((w) => w.rating > 0);
  const avg = rated.length ? (rated.reduce((s, w) => s + w.rating, 0) / rated.length).toFixed(1) : "-";
  const spent = ws.reduce((s, w) => s + (Number(w.price) || 0), 0);
  const withPhoto = ws.filter((w) => isImgData(w.thumb)).length;
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
        <div class="stat"><div class="v">${withPhoto}</div><div class="k">写真あり</div></div>
      </div>
      <p class="note" id="s-usage"></p>
    </div>
    ${rankSection}
    <div class="section">
      <h2>バックアップ</h2>
      <p>記録と写真はこの端末のブラウザ内にだけ保存されます。機種変更やSafariのデータ削除で消えるので、ときどきJSONに書き出して保管してください。</p>
      <label class="check"><input type="checkbox" id="s-with-photos" checked> ラベル写真も含める</label>
      <div class="btn-row">
        <button id="s-export" class="btn-primary">JSONに書き出す</button>
        <button id="s-import" class="btn-secondary">JSONを読み込む</button>
      </div>
      <input id="s-file" type="file" accept="application/json,.json" class="hidden">
      <p class="note">写真を含めると1本あたり数百KB増えます。読み込みは同じIDの記録を上書きし、それ以外は追加します（既存の記録は消えません）。</p>
    </div>
    <div class="section">
      <h2>危険な操作</h2>
      <div class="btn-row"><button id="s-clear" class="btn-danger">すべての記録を削除</button></div>
    </div>
    <div class="version">ワイン記録 v${APP_VERSION}</div>`;
}
async function showUsage() {
  try {
    if (!navigator.storage || !navigator.storage.estimate) return;
    const { usage } = await navigator.storage.estimate();
    const el = $("#s-usage");
    if (el && usage != null) el.textContent = `このアプリの使用容量: 約 ${fmtBytes(usage)}`;
  } catch (_) { /* 表示できなくても困らない */ }
}
function bindSettings() {
  showUsage();
  $("#s-export").addEventListener("click", () => exportJSON($("#s-with-photos").checked));
  $("#s-import").addEventListener("click", () => $("#s-file").click());
  $("#s-file").addEventListener("change", importJSON);
  $("#s-clear").addEventListener("click", async () => {
    if (!confirm(`全 ${state.wines.length} 件の記録と写真を削除します。元に戻せません。よろしいですか？`)) return;
    if (!confirm("本当に削除しますか？（先にJSONへ書き出すことをおすすめします）")) return;
    await dbClear();
    toast("すべて削除しました");
    render();
  });
}
async function exportJSON(withPhotos) {
  let ws = await dbAll();
  const payload = { app: "wine-log", version: APP_VERSION, exportedAt: new Date().toISOString(), wines: ws };
  if (withPhotos) payload.photos = await photoAll();
  else payload.wines = ws = ws.map(({ thumb, ...rest }) => rest);
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `wine-log-${today()}${withPhotos ? "" : "-nophoto"}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast(`${ws.length} 件を書き出しました（${fmtBytes(blob.size)}）`);
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
      .map((w) => {
        const r = { ...blank(), ...w, id: typeof w.id === "string" && w.id ? w.id : newId() };
        if (!isImgData(r.thumb)) r.thumb = "";
        return r;
      });
    const photoRecs = (Array.isArray(data.photos) ? data.photos : [])
      .filter((p) => p && typeof p.id === "string" && p.id)
      .map((p) => ({ id: p.id, front: isImgData(p.front) ? p.front : null, back: isImgData(p.back) ? p.back : null }))
      .filter((p) => p.front || p.back);
    const photoNote = photoRecs.length ? `（写真つき ${photoRecs.length} 件）` : "";
    if (!confirm(`${recs.length} 件${photoNote}を読み込みます。よろしいですか？`)) return;
    await dbPutMany(recs, photoRecs);
    if (photoRecs.length) requestPersist();
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
$("#viewer").addEventListener("click", closeViewer);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeViewer(); });

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
render();
