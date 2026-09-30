#!/usr/bin/env node
// 保全成果物を上流 main へ反映する(冪等)。使い方: node handoff/20260930/apply-preserved.mjs <repo-root>
//
// 腐敗耐性は2半分で異なる(2026-10-01 実測で確定):
//   (1) knowledge 側 = JSON を parse して marker の有無で判定 → main が前進しても腐敗しない・再実行安全
//   (2) routing 側   = git apply する context patch → main が tools/eval-harness.mjs のハンク近傍を
//                       触ると不適用になる(過去に 09-29→09-30 で実際に FAILED)。--3way も救済にならない
//                       (コンフリクトマーカーを残すだけ)。よって失敗時は黙って進まず、作り直し手順を出して停止する。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repo = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const MARKER = 'ff41f255bd35c4dd';
const entry = JSON.parse(fs.readFileSync(path.join(here, 'knowledge-entry.json'), 'utf8'));

// --- (1) handoff-audit-knowledge.json へ冪等追記（context patch を使わない＝main 前進に強い）---
const kPath = path.join(repo, 'tools', 'handoff-audit-knowledge.json');
const kRaw = fs.readFileSync(kPath, 'utf8');
const root = JSON.parse(kRaw);
const list = Array.isArray(root) ? root : root.entries;
if (!Array.isArray(list)) throw new Error('エントリ配列(ルート配列 or entries[])が見つからない');

const before = list.length;
const present = list.some((e) => JSON.stringify(e).includes(MARKER));
let action;
if (present) {
  action = 'skip (既に存在)';
} else {
  // 既存部分を再整形しない: 末尾の閉じ括弧の直後だけをテキスト挿入する
  // (context patch と違い行番号・前後行に依存しないので main が前進しても腐敗しない)
  const tail = kRaw.replace(/\s+$/, '');
  if (!tail.endsWith(']')) throw new Error('JSON が ] で終わっていない');
  const lastBrace = tail.lastIndexOf('}');
  if (lastBrace < 0) throw new Error('JSON に閉じ括弧が見つからない');
  const body = JSON.stringify(entry, null, 2)
    .split('\n')
    .map((l) => '  ' + l)
    .join('\n');
  fs.writeFileSync(kPath, tail.slice(0, lastBrace + 1) + ',\n' + body + '\n]\n', 'utf8');
  action = 'inserted';
}

// read-back: 書き込んだ実物を読み戻して assert（戻り値で成功判定しない）
const back = JSON.parse(fs.readFileSync(kPath, 'utf8'));
const backList = Array.isArray(back) ? back : back.entries;
const after = backList.length;
const okMarker = JSON.stringify(back).includes(MARKER);
if (!okMarker) throw new Error('read-back 失敗: ' + MARKER + ' が JSON に無い');
if (!present && after !== before + 1) throw new Error('read-back 失敗: entries ' + before + ' -> ' + after);
console.log('[knowledge] ' + action + ' / entries ' + before + ' -> ' + after + ' / marker present=' + okMarker);

// --- (2) routing-table パッチ (context patch。main 前進で腐敗しうる) ---
const rPatch = path.join(here, 'routing-table-handoff.patch');
const hPath = path.join(repo, 'tools', 'eval-harness.mjs');
const already = (() => {
  try { return fs.readFileSync(hPath, 'utf8').includes('writeRoutingHandoff'); } catch { return false; }
})();
if (already) {
  console.log('[routing] skip (既に適用済み)');
} else {
  // 改行の正規化: Windows の clone は core.autocrlf=true になりがちで、checkout された
  // パッチが CRLF 化する(実測: CR 164個)。その状態で git apply すると
  // 「trailing whitespace」という無関係なエラーで必ず落ちる。パッチ側を LF に戻してから当てる。
  const rawPatch = fs.readFileSync(rPatch, 'utf8');
  const crlf = rawPatch.includes('\r\n');
  const usePatch = crlf ? path.join(os.tmpdir(), 'routing-handoff-normalized.patch') : rPatch;
  if (crlf) fs.writeFileSync(usePatch, rawPatch.replace(/\r\n/g, '\n'), 'utf8');
  console.log('[routing] patch line endings: ' + (crlf ? 'CRLF -> LF 正規化した' : 'LF のまま'));

  try {
    // 失敗時 git apply はファイルを一切書き換えない(原子的)ので、半適用の心配は無い。
    execFileSync('git', ['apply', usePatch], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const first = String(e.stderr || e.message).trim().split('\n')[0];
    console.error('[routing] FAILED: パッチが現行 main の tools/eval-harness.mjs に当たりません(文脈ずれ=腐敗)。');
    console.error('  knowledge 側の追記は完了済みです(上のログ)。routing 側だけを次の要領で反映してください:');
    console.error('    git checkout -b tmp origin/main');
    console.error('    git apply -3 ' + rPatch + '     # 競合は手で解決(3way は競合マーカーを残すので必ず目視)');
    console.error('    git diff origin/main -- tools/eval-harness.mjs tools/routing-table-handoff.test.mjs \\');
    console.error('      > handoff/20260930/routing-table-handoff.patch   # 作り直して本スクリプトを再実行');
    console.error('  raw error: ' + first);
    process.exit(2);
  }
  const h = fs.readFileSync(hPath, 'utf8');
  for (const fn of ['writeRoutingHandoff', 'diffRoutingCategories', 'formatRoutingEntry']) {
    if (!h.includes(fn)) throw new Error('routing read-back 失敗: ' + fn + ' が無い');
  }
  if (!fs.existsSync(path.join(repo, 'tools', 'routing-table-handoff.test.mjs')))
    throw new Error('routing read-back 失敗: テスト同梱が無い');
  console.log('[routing] applied / export 3件 + テスト同梱 present');
}
