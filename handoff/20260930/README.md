# 保全成果物の引き継ぎ (2026-09-30 / cr568 → write 権限PC)

このブランチは**マージしない**。``fork (cr568) → write 権限PC`` の**輸送体**であり、
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

## なぜ腐敗しないか
従来は `git apply` の context patch で追記していたため、上流 main が前進するたびに不適用になった
(2026-09-29 版 → 09-30 に entries 20→21 で FAILED、再生成を要した)。
`apply-preserved.mjs` は **JSON を parse して marker `ff41f255bd35c4dd` の有無で冪等に追記**するため、
entries が何件に増えていても適用でき、再実行しても二重追記しない。
routing-table 側は適用済み判定(`writeRoutingHandoff` の有無)を先に行う。
