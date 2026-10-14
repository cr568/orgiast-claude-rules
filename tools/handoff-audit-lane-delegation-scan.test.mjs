import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detect, firstMatch, selftest, scan, CONTROLS } from './handoff-audit-lane-delegation-scan.mjs';

// 走査結果の「0 件」は、検出器が動いていなければ意味を持たない。
// 対照（陽性5・陰性5）が全通過することを先に固定する。
test('検出器の対照が全通過する（陽性5・陰性5）', () => {
  const r = selftest();
  assert.equal(r.passed, r.total, JSON.stringify(r.failures));
  assert.equal(r.total, 10);
  assert.ok(CONTROLS.some((c) => c.want === true), '陽性対照が無いと 0 件が無意味になる');
  assert.ok(CONTROLS.some((c) => c.want === false), '陰性対照が無いと常時 true の検出器を見逃す');
});

test('委譲語と実行中語が近接したときだけ陽性', () => {
  assert.equal(detect('Codex に委譲しました（バックグラウンド実行中 ID: b3kw1ixab）。'), true);
  assert.equal(detect('実装は Codex レーンに渡して実行中です。完了通知を待ちます。'), true);
  assert.equal(detect('委譲実行中です（executor=fallback:cheap-code:deepseek）。'), true);
  assert.equal(detect('サブエージェントに実装を委譲して実行中です。次に kim がすること: なし（待機）。'), true);
});

test('委譲しても完了していれば陽性にしない（実行中語が無い）', () => {
  assert.equal(detect('Codex に委譲して実装完了、テスト全件 PASS しました。'), false);
  assert.equal(detect('委譲判定: 実装=Codex（完了）→ 監督 verify 完了。'), false);
});

test('実行中語だけ（委譲語が無い）は陽性にしない', () => {
  assert.equal(detect('実行中のプロセスは kill されるため run_in_background は禁止です。'), false);
  assert.equal(detect('実装は完了し、テストは全件 PASS しました。'), false);
});

test('近接していなければ陽性にしない（離れた語の共起は対象外）', () => {
  const far = 'Codex に委譲しました。' + 'あ'.repeat(200) + 'この処理が実行中かは不明です。';
  assert.equal(detect(far), false, '80 文字を超えて離れた語は共起としない');
});

test('監査TODO文そのもの（自セッションのプロンプト）は再発として数えない', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-delegation-scan-'));
  const dir = path.join(home, '.claude');
  fs.mkdirSync(dir, { recursive: true });
  const todo = 'サブエージェント/他AIレーンへ実装を委譲して『実行中』で終わる [handoff-audit:e9640ea79ef414e9] 再発を検証する';
  fs.writeFileSync(path.join(dir, 'handoff-audit-ledger.jsonl'),
    JSON.stringify({ ts: new Date().toISOString(), sessionId: 'aaaaaaaa', excerpt: todo }) + '\n' +
    JSON.stringify({ ts: new Date().toISOString(), sessionId: 'bbbbbbbb', excerpt: 'Codex に委譲しました（バックグラウンド実行中）。' }) + '\n');
  const r = scan({ home, since: Date.now() - 86400_000 });
  assert.equal(r.ledger.scanned, 2);
  assert.equal(r.hits, 1, 'TODO文を除外し、本物の1件だけを数える');
  assert.equal(r.rows[0].id, 'bbbbbbbb');
});

test('窓の外は数えない（窓の境界を実測値で固定する）', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-delegation-scan-'));
  const dir = path.join(home, '.claude');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'handoff-audit-ledger.jsonl'),
    JSON.stringify({ ts: '2026-01-01T00:00:00Z', sessionId: 'old00000', excerpt: 'Codex に委譲して実行中です。' }) + '\n');
  const r = scan({ home, since: Date.parse('2026-09-01T00:00:00Z') });
  assert.equal(r.ledger.total, 1);
  assert.equal(r.ledger.scanned, 0);
  assert.equal(r.hits, 0);
});

test('assistant 以外の turn は数えない（報告する側だけを見る）', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-delegation-scan-'));
  const proj = path.join(home, '.claude', 'projects', 'p');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 's.jsonl'),
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'Codex に委譲して実行中で終わらないでください。' } }) + '\n' +
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Codex レーンに渡して実行中です。完了通知を待ちます。' }] }, timestamp: new Date().toISOString() }) + '\n');
  const r = scan({ home, since: Date.now() - 86400_000 });
  assert.equal(r.hits, 1, 'user turn は数えず、assistant の1件だけを数える');
  assert.match(r.rows[0].match, /実行中/);
});

test('firstMatch は人手分類の根拠になる一致部分を返す', () => {
  assert.equal(firstMatch('委譲実行中です（executor=fallback）。'), '委譲実行中');
  assert.equal(firstMatch('実装は完了しました。'), '');
});
