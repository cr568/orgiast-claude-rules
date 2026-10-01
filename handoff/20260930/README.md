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

## 腐敗耐性は2つの半分で異なる（2026-10-01 実測・重要）
READ して「main が進んでも一発で通る」と期待しないこと。実測で確定した違いは次のとおり。

| 半分 | 方式 | main 前進への耐性 |
|---|---|---|
| knowledge (`handoff-audit-knowledge.json`) | JSON を parse し marker `ff41f255bd35c4dd` の有無で冪等追記 | **強い**。entries が何件でも当たる。再実行しても二重追記しない |
| routing (`tools/eval-harness.mjs` + 新規テスト) | **`git apply` の context patch** | **弱い**。main が `tools/eval-harness.mjs` のハンク近傍に触れると不適用になる |

routing 側の脆さは実測済み:
- 過去に 09-29 版 → 09-30 で entries 前進のため `apply --check` が FAILED（再生成を要した）
- `--3way` は**救済にならない**（`Applied patch ... with conflicts` / `U tools/eval-harness.mjs`＝競合マーカーを残すだけ）
- 隔離クローンで main 前進を人工的に再現した実測でも `rot=yes threeWayRescue=no`
  （`runs/2026-10-01-3-routing-rot-sim.mjs`）

そのため `apply-preserved.mjs` は routing が当たらなかったとき **黙って進まず exit 2** で停止し、
パッチの作り直し手順を表示する。**knowledge 側は既に適用済みのまま残る**ので、
routing だけ作り直して再実行すればよい（knowledge は skip され二重追記しない）。

`origin/main` = `ed6d45a` に対し **routing パッチは apply-check OK**（2026-10-01 実測）。
つまり今すぐ実行する分には一発で通る。腐敗が問題になるのは**上流 main がさらに前進した後**。

**2026-10-02 追記（上流 main 前進後の再実測）**: `origin/main` が `ed6d45a` → **`7f743ec`**
（`Driveハブ退行防止: hub-pushと夜間登録を復旧 (#606)`）へ前進した後も、routing パッチは
**apply-check OK のまま**（`apply-preserved.mjs` 1回目 = `entries 21 -> 22` ＋ routing applied／
2回目 = 両方 skip で entries 22 のまま＝冪等／固有マーカー 5/5 present／
`node --test tools/routing-table-handoff.test.mjs` 5/5 PASS／変更は狙いの3ファイルのみ）。
⇒ **2コミット前進では腐敗しなかった**。ただし上の表のとおり routing 側は context patch なので、
前進の内容によっては落ちうる。落ちた場合は exit 2 の指示に従って作り直す（knowledge は skip され二重追記しない）。

## Windows での改行化け（2026-10-01 実測・`apply-preserved.mjs` 側で対処済み）
Windows の clone は `core.autocrlf=true` になりがちで、**checkout された `routing-table-handoff.patch` が
CRLF 化する**（実測: CR 164 個。同じツリーの `tools/eval-harness.mjs` は CR 0）。
そのまま `git apply` すると `trailing whitespace` という**原因と無関係に見えるエラー**で必ず落ちる。

`apply-preserved.mjs` はパッチを読んで CRLF→LF に正規化してから当てるので、この罠は塞いである
（実行ログに `[routing] patch line endings: CRLF -> LF 正規化した` と出る）。
もし手で `git apply handoff/20260930/routing-table-handoff.patch` を叩いて `trailing whitespace` が出たら、
パッチが CRLF 化しているだけなので `tr -d '\r' < ... > /tmp/p.patch` のように剥がしてから当てること。
