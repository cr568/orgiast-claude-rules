#!/usr/bin/env node
// 保全成果物を上流 main へ反映する(冪等・main が前進しても腐敗しない)
// 使い方: node handoff/20260930/apply-preserved.mjs <repo-root>
import fs from 'node:fs';
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

// --- (2) routing-table パッチ ---
const rPatch = path.join(here, 'routing-table-handoff.patch');
const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
const already = (() => {
  try {
    return fs
      .readFileSync(path.join(repo, 'tools', 'eval-harness.mjs'), 'utf8')
      .includes('writeRoutingHandoff');
  } catch {
    return false;
  }
})();
if (already) {
  console.log('[routing] skip (既に適用済み)');
} else {
  execFileSync('git', ['apply', rPatch], { cwd: repo, stdio: 'inherit' });
  const h = fs.readFileSync(path.join(repo, 'tools', 'eval-harness.mjs'), 'utf8');
  for (const fn of ['writeRoutingHandoff', 'diffRoutingCategories', 'formatRoutingEntry']) {
    if (!h.includes(fn)) throw new Error('routing read-back 失敗: ' + fn + ' が無い');
  }
  if (!fs.existsSync(path.join(repo, 'tools', 'routing-table-handoff.test.mjs')))
    throw new Error('routing read-back 失敗: テスト同梱が無い');
  console.log('[routing] applied / export 3件 + テスト同梱 present');
}
void git;
