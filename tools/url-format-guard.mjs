#!/usr/bin/env node
export const GATE_CONTRACT = {"name": "url-format-guard", "remedies": [{"kind": "repo-file", "ref": "tools/gate-remedies.md", "section": "url-format-guard"}]};
import fs from 'node:fs';
import { isEntry } from './is-entry.mjs';
import { latestAssistantText } from './lib/assistant-text.mjs';
import { readStdinWithTimeout } from './lib/hook-stdin.mjs';
import { appendStopLedger, registerStopViolation, stopGateOutput } from './lib/stop-recheck.mjs';


const BAD_RAW_URL = /(?<!\]\()https?:\/\/[A-Za-z0-9._~:/?#@!$&'*+,;=%\-]+[　-〿぀-ヿ一-鿿＀-￯]/;

export function findBrokenRawUrl(text) {
  const value = String(text || '');
  if (/\[RAW-URL-OK\]/.test(value)) return { decision: 'pass' };
  const match = value.match(BAD_RAW_URL);
  if (!match) return { decision: 'pass' };
  const sample = match[0].slice(0, 60);
  const reason = `[URL-FORMAT VIOLATION] 生URLが日本語/全角文字に直接隣接しています(リンク破損): "${sample}"

URLは必ず Markdown リンク形式にすること(絶対ルール):
  NG:  （https://example.com）。   /  https://example.com を確認
  OK:  [example.com](https://example.com)  /  [サイトはこちら](https://example.com)

生URLの直後に句読点・全角カッコ・日本語を隙間なく続けるとクリック時に巻き込まれ
ERR_NAME_NOT_RESOLVED / 404 になります。該当箇所を [text](url) に直して再送してください。
(本当に生URLが必要な稀な場合のみ [RAW-URL-OK] タグを付ける)`;
  return { decision: 'block', reason };
}

export const REMEDY_EXAMPLES = [
  '[example.com](https://example.com)',
  '[サイトはこちら](https://example.com)',
];

async function main() {
  try {
    const raw = await readStdinWithTimeout();
    if (!raw.trim()) return;
    const input = JSON.parse(raw);
    if (!input?.transcript_path || !fs.existsSync(input.transcript_path)) return;
    const text = input.last_assistant_message ?? input.assistant_text ?? latestAssistantText(input.transcript_path); if (!text) return;
    const result = findBrokenRawUrl(text);
    if (result.decision === 'block') {
      const recheck = registerStopViolation({ input, assistantText: text, blockedBy: ['url-format-guard'], reasonCodes: ['URL-FORMAT'] });
      appendStopLedger({ sessionId: recheck.sessionId, verdict: recheck.verdict, blockedBy: recheck.blockedBy, reasonCodes: recheck.reasonCodes, retryCap: recheck.retryCap, excerpt: text.slice(0, 200) });
      console.log(JSON.stringify(stopGateOutput(recheck, result.reason)));
    }
  } catch {}
}

if (isEntry(import.meta.url)) await main();
