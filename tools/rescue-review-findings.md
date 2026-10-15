# rescue ブランチ レビュー棚卸し（2026-10-15 実測）

`node tools/rescue-review-scan.mjs --repo . --main origin/main` の実出力に基づく記録。
rescue 退避は「dirty な作業ツリーを保全する」仕組みなので、内容が後から PR / main に取り込まれても
`next-session.md` の「レビューが必要」TODO は自動では消えない。本スキャナは
**three-dot diff（枝自身の変更のみ）の指紋**で `unique` / `duplicate` / `covered` に分類し、
人間が実際に見るべき枝だけを残す。

## 2026-10-15 時点の結果

- 対象: `refs/heads/rescue/*` 21 本
- `unique: 19 / duplicate: 2 / covered: 0 / error: 0`

duplicate と判定された枝（＝レビュー不要。内容は canonical 側と同一）:

| branch | duplicateOf | 内容 |
|---|---|---|
| `rescue/auto-session-20261013-103002` | `rescue/auto-session-20261013-100002` | 倉庫アプリの feedback 台帳登録（68+/6-） |
| `rescue/auto-session-20261013-163002` | `rescue/auto-session-20261013-100002` | 同上（同一内容） |

上記 3 枝の変更は **PR #763（`feat(feedback): 倉庫アプリを不具合・要望フォームの台帳と zero 監視に登録`）と
byte 一致**であることを実測で確認済み（`git diff <rescue-tip> <pr763-head> -- tools/feedback-apps.json tools/feedback-zero-registry.json` が空）。
したがって 2026-10-13 の rescue レビュー TODO 2 件は「PR #763 が担当済み＝独立レビュー対象なし」で消化できる。

## 残った unique 19 本について

`unique` は「他枝と同一ではない」ことしか意味しない。うち古いもの（2026-09 台）は当時の内容が
既に main に取り込まれている可能性がある。判断材料を増やすなら次段として
「open PR の head と指紋照合して `covered-by-pr` を追加する」拡張が有効（未実装）。

## 再実行方法

```
node tools/rescue-review-scan.mjs --repo <repo> --main origin/main          # 人間向け
node tools/rescue-review-scan.mjs --repo <repo> --main origin/main --json   # 機械向け
```
