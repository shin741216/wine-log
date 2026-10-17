# ワイン記録（wine-log）

飲んだワインを記録する個人用PWAです。素のHTML/CSS/JS、ビルドなし。
公開URL: https://shin741216.github.io/wine-log/

iPhone / iPad のSafariで開き「共有 → ホーム画面に追加」するとアプリとして使えます。

## 機能（v0.3.0）

- 記録の追加・編集・削除（銘柄・色・日付・ヴィンテージ・生産者・生産国・地域・品種・価格・場所・5段階評価・メモ）
- ラベル写真を表・裏の2枚まで。撮影でもフォトライブラリからでも選べ、長辺1280pxのJPEGに縮小して保存。一覧にサムネイル、詳細に2枚を表示し、タップで拡大
- テイスティングコメントを用語シートで記録。シートは「ワイン受験.com 2026年版」と「Wine-Flight 2025年版（番号付き）」から選び、白・赤を切り替えられる。各項目に「選んだ数 / 目安」を表示し、目安を超えると赤字（記録はできる）。最後に使ったシートを次回の初期値にする。詳細画面に項目ごとに表示し、一覧の検索は用語にも効く
- 詳細画面の「同じワインを記録」でコピーして新規作成（日付は今日、評価・メモ・テイスティングコメントは空、写真は引き継ぐ）
- 一覧の検索（全項目の部分一致）、色チップで絞り込み、日付／評価／価格／名前で並べ替え
- 入力欄は過去の記録から候補を出す（生産者・生産国・地域・品種・場所）
- 設定画面: 集計（記録数・平均評価・合計金額・色別・よく飲む品種／生産国）、JSON書き出し（写真を含めるか選べる）／読み込み、全削除、使用容量の表示

## データ

- 保存先は端末のブラウザ内の IndexedDB（DB名 `wine-log`、版2）。サーバーには送らない
  - `wines`: 記録（キー `id`）。一覧用のサムネイル `thumb`（長辺200pxのJPEG data URL）も持つ
  - `photos`: 写真本体 `{ id, front, back }`（キーはワインの `id`、各面はJPEG data URLか null）。一覧を軽く保つため分けている
- 書き出したJSONは `{ app, version, exportedAt, wines: [...], photos: [...] }`（写真なしで書き出すと `photos` と `thumb` を省く）。読み込みは同じ `id` を上書きし、それ以外は追加。画像は `data:image/(jpeg|png|webp);base64,` 形式のものだけ受け付ける
- 1件のレコード: `id, date, name, color, country, region, producer, grape, vintage, price, rating(0-5), place, memo, thumb, tasting, createdAt, updatedAt`
- `tasting` は `{ sheet: "jyuken2026"|"wf2025", type: "white"|"red", picks: { 項目id: [用語...] } }` か null。用語そのものを保存するので、シートの並びが変わっても読める

## ファイル

| ファイル | 内容 |
|---|---|
| `index.html` | 画面の骨組み（ヘッダー・main・フッター・トースト） |
| `sheets.js` | テイスティング用語シート `SHEETS`。wine-tasting-trainer の `VOCAB`（data.js）と `VOCAB_WF2025`（sheets.js）の複製。用語を直すときは両方そろえる |
| `app.js` | IndexedDB・画面描画（一覧／詳細／入力／設定）・書き出し／読み込み |
| `style.css` | 見た目。768px以上で少し広がる |
| `version.js` | `APP_VERSION`。更新を配布するときはここだけ上げる |
| `sw.js` | Service Worker（ネットワーク優先、失敗時キャッシュ） |
| `manifest.json` / `icon-*.png` | PWA用 |

## ローカル確認

`C:\dev\.claude\launch.json` の `wine-log`（`python -m http.server 8738`）で http://localhost:8738 を開く。

## 今後の候補

1. （済）ラベル写真 表・裏（v0.2.0）
2. （済）テイスティング用語シート（v0.3.0）
3. 月別本数などの集計グラフ
4. （済）GitHub Pages で配布: https://shin741216.github.io/wine-log/

## 用語シートの出所

用語と並び順は、ワイン受験.com「テイスティング解答用紙 2026年版」と、Wine-Flight「2025年版 テイスティング用語選択シート」に準拠しています（wine-tasting-trainer から複製）。各サイトの公開資料をもとにした個人の学習用です。
