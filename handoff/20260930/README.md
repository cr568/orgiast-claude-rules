# 保全成果物の引き継ぎ (2026-09-30 / cr568 → write 権限PC)

このブランチは**マージしない**。`fork (cr568) → write 権限PC` の**輸送体**であり、
中身を正本ブランチへ適用したら役目は終わる。

## なぜ fork PR では駄目か
`.github/workflows/auto-merge.yml` の条件1が `head.repo.full_name == GITHUB_REPOSITORY` を要求するため、
fork からの PR は `automerge` ラベルを付けても設計上マージされない。正本ブランチ(=上流 repo への push)が唯一の経路。

## 手順 (write 権限PCで / 人手ゼロ)
```bash
git clone https://github.com/kimkon1011/orgiast-claude-rules.git work && cd work
git fetch https://github.com/cr568/orgiast-claude-rules.git handoff/20260930-preserved
git checkout -b auto/20260930-preserved origin/main
git checkout FETCH_HEAD -- handoff/20260930
node handoff/20260930/apply-preserved.mjs .
rm -rf handoff                       # 輸送体は持ち込まない
git add tools/handoff-audit-knowledge.json
git commit -m "docs(handoff-audit): ff41f255bd35c4dd(実装続行可否の確認)の再発を実測し経路を記録 (PR #582 保全)"
git add tools/eval-harness.mjs tools/routing-table-handoff.test.mjs
git commit -m "fix(seiji): routing-table 再生成の更新を runs/ に引き継ぎ成果物として残す"
git push origin auto/20260930-preserved
gh pr create --base main --head auto/20260930-preserved --title "docs+fix: 保全成果物2件(handoff-audit ff41f255 / routing-table 引き継ぎ)" --body-file <body>
gh pr edit <PR> --add-label automerge
```

## 腐敗耐性（2026-10-02 改訂: 両半分とも main 前進に強い方式になった）

| 半分 | 方式 | main 前進への耐性 |
|---|---|---|
| knowledge (`handoff-audit-knowledge.json`) | JSON を parse し marker `ff41f255bd35c4dd` の有無で冪等追記 | **強い**。entries が何件でも当たる。再実行しても二重追記しない |
| routing (`tools/eval-harness.mjs` + 新規テスト) | **行アンカー方式**（`routing-edit.json`） | **強い**。行番号がずれても、近傍の別の行が書き換わっても当たる（末尾追記はアンカー無し） |

`routing-edit.json` は context patch を捨て、**変更のあった行そのもの**（挿入は直前の1行）だけを
アンカーにした編集列（`replace` / `insertAfter` / `append` の4件）。同梱の
`routing-table-handoff.patch` は参考資料で、適用には使わない。

### 実測した根拠（2026-10-02）
- **生成時の等価性**: `base + edits` が「patch を当てた結果」と**バイト一致**することを assert
  （`runs/2026-10-02-3-build-routing-edit.mjs`。`baseSha256` / `resultSha256` を JSON に記録）
- **腐敗耐性の対照実験**: 旧 context patch が依存していた文脈行を1行だけ書き換えた木で
  → 旧 patch は `patch does not apply` で **FAILED**、新方式は **applied**（書き換えも保持・テスト 5/5 PASS）
- **現行 main `7f743ec` での end-to-end**: 1回目 = `[knowledge] entries 21 -> 22` ＋ `[routing] applied / anchors=4`、
  2回目 = 両方 skip で entries 22 のまま＝**冪等**。`node --test tools/routing-table-handoff.test.mjs` **5/5 PASS**。
  差分は狙いの3ファイルのみ（`tools/eval-harness.mjs` +57/-1）

適用に失敗した場合は黙って進まず **exit 2** で停止し、作り直し手順を表示する
（knowledge 側は既に適用済みのまま残るので、routing だけ作り直して再実行すればよい）。

## 改行（2026-10-01 実測 → 2026-10-02 で不要化）
旧方式は Windows の clone（`core.autocrlf=true`）で checkout されたパッチが CRLF 化し、
`git apply` が `trailing whitespace` という無関係なエラーで落ちていた。新方式は
`routing-edit.json`（改行を `\r?\n` で吸収して読む）なので、この罠は原理的に発生しない。
`routing-table-handoff.patch` を手で当てる場合だけ、旧来どおり `tr -d '\r'` で剥がすこと。
