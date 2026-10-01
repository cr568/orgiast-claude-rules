#!/usr/bin/env node
// 保全成果物を上流 main へ反映する(冪等)。使い方: node handoff/20260930/apply-preserved.mjs <repo-root>
//
// 2026-10-02 改訂: routing 側も context patch をやめ、行アンカー方式(routing-edit.json)にした。
//   旧方式は `git apply` のハンク文脈に依存し、上流 main が tools/eval-harness.mjs の近傍を
//   1行書き換えるだけで不適用になった(09-29→09-30 で実際に FAILED、以後も前進のたびに再検証が必要だった)。
//   新方式は「変更のあった行そのもの」(挿入は直前の1行)だけをアンカーにするので、
//   行番号がずれても、近傍の別の行が書き換わっても適用できる。末尾追記はアンカー無し。
//   同梱の routing-edit.json は「base + edits === patch適用後」をバイト一致で検証済み。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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

// --- (2) routing-table の変更（行アンカー方式。腐敗しない）---
const hPath = path.join(repo, 'tools', 'eval-harness.mjs');
const edit = JSON.parse(fs.readFileSync(path.join(here, 'routing-edit.json'), 'utf8'));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const applyEdits = (text, list) => {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let lines = text.split(/\r?\n/);
  const where = (from) => {
    let at = -1, hits = 0;
    for (let p = 0; p + from.length <= lines.length; p++) {
      if (from.every((l, k) => lines[p + k] === l)) { hits++; if (at < 0) at = p; }
    }
    return { at, hits };
  };
  for (const ed of list) {
    if (!ed.from.length) {                                   // 末尾追記(アンカー不要)
      if (lines[lines.length - 1] === '') lines = [...lines.slice(0, -1), ...ed.to, ''];
      else lines = [...lines, ...ed.to];
      continue;
    }
    const { at, hits } = where(ed.from);
    if (hits === 0) throw new Error(`アンカーが見つからない(${ed.mode}): ${JSON.stringify(ed.from[0].slice(0, 70))}`);
    if (hits > 1) throw new Error(`アンカーが ${hits} 箇所で曖昧(${ed.mode})`);
    lines = [...lines.slice(0, at), ...ed.to, ...lines.slice(at + ed.from.length)];
  }
  return lines.join(eol);
};

const hRaw = fs.readFileSync(hPath, 'utf8');
if (hRaw.includes(edit.marker)) {
  console.log('[routing] skip (既に適用済み)');
} else {
  let next;
  try {
    next = applyEdits(hRaw, edit.edits);
  } catch (e) {
    console.error('[routing] FAILED: ' + e.message);
    console.error('  knowledge 側の追記は完了済みです(上のログ)。routing 側だけを次の要領で反映してください:');
    console.error('    git checkout -b tmp origin/main');
    console.error('    git apply handoff/20260930/routing-table-handoff.patch   # 参考の context patch(古い可能性あり)');
    console.error('    git diff origin/main -- tools/eval-harness.mjs tools/routing-table-handoff.test.mjs \\');
    console.error('      > handoff/20260930/routing-table-handoff.patch   # 作り直して routing-edit.json を再生成');
    process.exit(2);
  }
  // 元の base に対して当てた場合は patch 適用結果とバイト一致するはず(輸送体の正当性の自己検証)
  if (sha(hRaw) === edit.baseSha256 && sha(next) !== edit.resultSha256) {
    console.error('[routing] FAILED: base が既知のものと一致するのに結果が既知の値と違う(輸送体が壊れている)');
    process.exit(2);
  }
  fs.writeFileSync(hPath, next, 'utf8');

  // read-back: 書き込んだ実物を読み戻して assert（戻り値で成功判定しない）
  const back2 = fs.readFileSync(hPath, 'utf8');
  for (const fn of ['writeRoutingHandoff', 'diffRoutingCategories', 'formatRoutingEntry', 'routingTableFile']) {
    if (!back2.includes(fn)) throw new Error('routing read-back 失敗: ' + fn + ' が無い');
  }
  const baseNote = sha(hRaw) === edit.baseSha256 ? '既知の base と一致' : 'base は前進済み(アンカーのみで適用)';
  console.log('[routing] applied / anchors=' + edit.edits.length + ' / ' + baseNote);
}

// --- (2b) 新規テストファイル（内容比較で冪等）---
for (const f of edit.newFiles) {
  const p = path.join(repo, f.path);
  if (fs.existsSync(p)) {
    const cur = fs.readFileSync(p, 'utf8');
    if (cur.replace(/\r\n/g, '\n') !== f.content) {
      console.error('[routing] FAILED: ' + f.path + ' が既に存在し内容が違う(手で解決してください)');
      process.exit(2);
    }
    console.log('[routing] skip (新規ファイルは既に同一) ' + f.path);
  } else {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, f.content, 'utf8');
    const rb = fs.readFileSync(p, 'utf8');
    if (rb !== f.content) throw new Error('read-back 失敗: ' + f.path);
    console.log('[routing] wrote ' + f.path);
  }
}
