export const GATE_CONTRACT = {"name":"response-language-gate","remedies":[{"kind":"repo-file","ref":"tools/gate-remedies.md","section":"response-language-gate"}]};

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu;
const LATIN = /\p{Script=Latin}/gu;
const JAPANESE_INPUT = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
const REASON = '応答が日本語ではありません。user の言語設定は日本語です。説明文・報告・質問はすべて日本語で書き直してください（コード・識別子・コマンドは原文のままでよい）。Stop hook の差し戻しで書き直すときも日本語を保つこと。';

function homeDir(opts = {}) {
  return opts.home || process.env.ORGIAST_HOME || process.env.USERPROFILE || os.homedir();
}

function readSettings(opts = {}) {
  if (opts.settings !== undefined) return opts.settings || {};
  try { return JSON.parse(fs.readFileSync(path.join(homeDir(opts), '.claude', 'settings.json'), 'utf8')); }
  catch { return {}; }
}

export function configuredMode(opts = {}) {
  const raw = String(opts.mode ?? process.env.ORGIAST_RESPONSE_LANGUAGE_GATE ?? 'block').toLowerCase();
  return ['off', 'warn', 'block'].includes(raw) ? raw : 'block';
}

export function proseOf(text) {
  return String(text || '')
    .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1\s*$/gmu, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/[^\s<>)]+/giu, ' ')
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\s<>()"']+/g, ' ')
    .replace(/(?:^|\s)(?:~?\/|\.\.?\/)[^\s<>()"']+/g, ' ');
}

export function measureResponseLanguage(text) {
  const prose = proseOf(text);
  const japanese = (prose.match(JAPANESE) || []).length;
  const latin = (prose.match(LATIN) || []).length;
  return { japanese, latin, ratio: japanese / Math.max(1, japanese + latin) };
}

export function judgeResponseLanguage(assistantText, humanText, opts = {}) {
  const mode = configuredMode(opts);
  if (mode === 'off') return { decision: 'pass' };
  const language = String(readSettings(opts).language || '').toLowerCase();
  const expectsJapanese = language === 'japanese' || language === '日本語' || JAPANESE_INPUT.test(String(humanText || ''));
  if (!expectsJapanese) return { decision: 'pass' };
  const { japanese, latin, ratio } = measureResponseLanguage(assistantText);
  if (latin < 120 || ratio >= 0.2) return { decision: 'pass' };
  return { decision: mode === 'warn' ? 'warn' : 'block', code: 'RESPONSE-LANGUAGE', reason: REASON };
}
