import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeIndex } from './onboarding-sync.mjs';
import { main, sendDiscordDm } from './discord-dm.mjs';

const recipient = { id: '123456789', label: '百瀬' };
const resolve = async () => recipient;
const response = ({ ok = true, status = 200, json = {} } = {}) => ({ ok, status, json: async () => json });

test('DMチャンネル作成から本文投稿まで2回だけ呼ぶ', async () => {
  const calls = [];
  const result = await sendDiscordDm('百瀬', 'hello', {
    token: 'test-token', resolve, plainJaImpl: async (text) => text,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return calls.length === 1 ? response({ json: { id: 'dm-channel' } }) : response();
    },
  });
  assert.equal(result.delivered, true);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /users\/@me\/channels$/);
  assert.deepEqual(JSON.parse(calls[0].init.body), { recipient_id: recipient.id });
  assert.match(calls[1].url, /channels\/dm-channel\/messages$/);
  assert.deepEqual(JSON.parse(calls[1].init.body), { content: 'hello' });
});

test('本文は書き換えず、そのまま送る（LLM平易化を通さない）', async () => {
  const bodies = [];
  await sendDiscordDm('百瀬', 'dry-run 検証: 上記の件、ご確認ください', {
    token: 'test-token', resolve,
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return bodies.length === 1 ? response({ json: { id: 'dm' } }) : response();
    },
  });
  assert.equal(bodies[1].content, 'dry-run 検証: 上記の件、ご確認ください');
});

test('dry-runはfetchゼロで解決結果と本文を返す', async () => {
  let fetches = 0;
  const result = await sendDiscordDm('百瀬', 'preview', {
    dryRun: true, resolve, plainJaImpl: async (text) => text,
    fetchImpl: async () => { fetches += 1; throw new Error('unexpected fetch'); },
  });
  assert.equal(fetches, 0);
  assert.deepEqual(result, { dryRun: true, recipient, content: 'preview' });
});

test('宛先不明・曖昧はexit 3で送信しない', async () => {
  let fetches = 0;
  const originalLog = console.log; const originalError = console.error;
  console.log = () => {}; console.error = () => {};
  try {
    const code = await main(['同姓', '--body', 'test'], {
      token: 'test-token', resolve: async () => null, plainJaImpl: async (text) => text,
      fetchImpl: async () => { fetches += 1; },
    });
    assert.equal(code, 3); assert.equal(fetches, 0);
  } finally { console.log = originalLog; console.error = originalError; }
});

test('トークン無しはexit 2で送信しない', async () => {
  let fetches = 0;
  const originalLog = console.log; const originalError = console.error;
  console.log = () => {}; console.error = () => {};
  try {
    const code = await main(['百瀬', '--body', 'test'], {
      token: '', resolve, plainJaImpl: async (text) => text,
      fetchImpl: async () => { fetches += 1; },
    });
    assert.equal(code, 2); assert.equal(fetches, 0);
  } finally { console.log = originalLog; console.error = originalError; }
});

test('送信本文からAPIキーとAuthorization付きURLを除去する', async () => {
  const bodies = [];
  await sendDiscordDm('百瀬', 'key sk-abcdefghijklmnopqr https://example.test/a?Authorization=secret-value', {
    token: 'test-token', resolve, plainJaImpl: async (text) => text,
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return bodies.length === 1 ? response({ json: { id: 'dm' } }) : response();
    },
  });
  assert.doesNotMatch(bodies[1].content, /sk-abcdefghijklmnopqr|secret-value/);
  assert.match(bodies[1].content, /\[REDACTED\]/);
});

test('新しい絶対ルール行はmakeIndexの出力に全文残る', () => {
  const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const body = fs.readFileSync(path.join(repo, 'ONBOARDING.md'), 'utf8');
  const rule = body.split(/\r?\n/).find((line) => line.startsWith('**🔴 社内メンバー'));
  assert.ok(rule);
  assert.ok(makeIndex(body).split('\n').includes(rule));
});
