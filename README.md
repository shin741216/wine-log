# ワイン記録（wine-log）

飲んだワインを記録する個人用PWAです。素のHTML/CSS/JS、ビルドなし。
公開URL: https://shin741216.github.io/wine-log/

iPhone / iPad のSafariで開き「共有 → ホーム画面に追加」するとアプリとして使えます。

## 機能（v0.1.0）

- 記録の追加・編集・削除（銘柄・色・日付・ヴィンテージ・生産者・生産国・地域・品種・価格・場所・5段階評価・メモ）
- 詳細画面の「同じワインを記録」でコピーして新規作成（日付は今日、評価とメモは空）
- 一覧の検索（全項目の部分一致）、色チップで絞り込み、日付／評価／価格／名前で並べ替え
- 入力欄は過去の記録から候補を出す（生産者・生産国・地域・品種・場所）
- 設定画面: 集計（記録数・平均評価・合計金額・色別・よく飲む品種／生産国）、JSON書き出し／読み込み、全削除

## データ

- 保存先は端末のブラウザ内の IndexedDB（DB名 `wine-log`、ストア `wines`、キー `id`）。サーバーには送らない
- 書き出したJSONは `{ app, version, exportedAt, wines: [...] }`。読み込みは同じ `id` を上書きし、それ以外は追加
- 1件のレコード: `id, date, name, color, country, region, producer, grape, vintage, price, rating(0-5), place, memo, createdAt, updatedAt`

## ファイル

| ファイル | 内容 |
|---|---|
| `index.html` | 画面の骨組み（ヘッダー・main・フッター・トースト） |
| `app.js` | IndexedDB・画面描画（一覧／詳細／入力／設定）・書き出し／読み込み |
| `style.css` | 見た目。768px以上で少し広がる |
| `version.js` | `APP_VERSION`。更新を配布するときはここだけ上げる |
| `sw.js` | Service Worker（ネットワーク優先、失敗時キャッシュ） |
| `manifest.json` / `icon-*.png` | PWA用 |

## ローカル確認

`C:\dev\.claude\launch.json` の `wine-log`（`python -m http.server 8738`）で http://localhost:8738 を開く。

## 今後の候補

1. ラベル写真（カメラ → 縮小 → IndexedDB）
2. テイスティング用語シート（wine-tasting-trainer の `VOCAB` を流用）
3. 月別本数などの集計グラフ
4. （済）GitHub Pages で配布: https://shin741216.github.io/wine-log/
