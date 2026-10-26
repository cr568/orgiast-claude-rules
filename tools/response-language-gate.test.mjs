import assert from 'node:assert/strict';
import test from 'node:test';
import { judgeResponseLanguage } from './response-language-gate.mjs';

const japanese = { settings: { language: 'japanese' } };
const longEnglish = 'The implementation is complete and all related tests passed successfully. The configuration was deployed and verified on every target computer without overwriting any unrelated user preference or existing hook registration.';

test('英語報告を block する', () => {
  const result = judgeResponseLanguage(longEnglish, '', japanese);
  assert.equal(result.decision, 'block');
  assert.equal(result.code, 'RESPONSE-LANGUAGE');
  assert.equal(result.reason, '応答が日本語ではありません。user の言語設定は日本語です。説明文・報告・質問はすべて日本語で書き直してください（コード・識別子・コマンドは原文のままでよい）。Stop hook の差し戻しで書き直すときも日本語を保つこと。');
});

test('日本語報告を pass する', () => {
  assert.equal(judgeResponseLanguage('実装と関連テストが完了し、全PCへの設定配布も確認しました。', '', japanese).decision, 'pass');
});

test('大きなコードブロック・英語識別子・パス・URL を含む日本語報告を pass する', () => {
  const text = ['実装と検証が完了しました。次のコードは変更例です。', '```js', 'const extremelyLongEnglishIdentifier = createResponseLanguageConfigurationForEveryComputer();'.repeat(8), '```', '対象は `responseLanguageConfigurationIdentifier`、C:\\Users\\kimko\\project\\tools\\response-language-gate.mjs、/home/runner/work/project/tools/response-language-gate.mjs、[確認先](https://example.com/very/long/english/path?with=parameters) です。'].join('\n');
  assert.equal(judgeResponseLanguage(text, '', japanese).decision, 'pass');
});

test('短い英語は pass する', () => assert.equal(judgeResponseLanguage('OK. All tests passed.', '', japanese).decision, 'pass'));

test('human が英語で settings も日本語でなければ英語応答を pass する', () => {
  assert.equal(judgeResponseLanguage(longEnglish, 'Please give me the report in English.', { settings: {} }).decision, 'pass');
});

test('2026-10-26 の実害サンプルを block する', () => {
  const text = "The design document is ready, with D5 (Timee's terms of use) now confirmed. Only the five items D1, D2, D3, D4 and D6 above are left for you to decide. If the recommended options are fine, reply \"OK\". If you want to change any, tell me its number.";
  assert.equal(judgeResponseLanguage(text, '', japanese).decision, 'block');
});

test('human の日本語だけでも日本語を期待する', () => assert.equal(judgeResponseLanguage(longEnglish, '結果を教えてください。', { settings: {} }).decision, 'block'));

test('mode は off/warn/block を選べ、既定は block', () => {
  assert.equal(judgeResponseLanguage(longEnglish, '', { ...japanese, mode: 'off' }).decision, 'pass');
  assert.equal(judgeResponseLanguage(longEnglish, '', { ...japanese, mode: 'warn' }).decision, 'warn');
  assert.equal(judgeResponseLanguage(longEnglish, '', japanese).decision, 'block');
});
