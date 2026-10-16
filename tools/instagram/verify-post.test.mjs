import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  judgePermalink,
  judgeProfile,
  judgeGraphMedia,
  isLoginWall,
  isJsShell,
  extractMetaContent,
  runCli,
} from './verify-post.mjs';

function createMockStream() {
  let output = '';
  return {
    write(chunk) {
      output += chunk;
    },
    get output() {
      return output;
    },
  };
}

test('extractMetaContent は property または name から content を抽出する', () => {
  const html = `
    <html>
      <head>
        <meta property="og:title" content="ラハイナ公式 Instagram" />
        <meta name="description" content="日本のエーゲ海・牛窓のペット宿" />
      </head>
    </html>
  `;
  assert.equal(extractMetaContent(html, 'title'), 'ラハイナ公式 Instagram');
  assert.equal(extractMetaContent(html, 'description'), '日本のエーゲ海・牛窓のペット宿');
});

test('isLoginWall は Instagram のログイン画面特有のタグや文字列を検出する', () => {
  assert.equal(isLoginWall('<html><title>Login • Instagram</title></html>'), true);
  assert.equal(isLoginWall('<div>"LoginAndSignupPage"</div>'), true);
  assert.equal(isLoginWall('<a href="/accounts/login/?next=...">Login</a>'), true);
  assert.equal(isLoginWall('<html><title>Lahaina Profile</title></html>'), false);
});

test('judgePermalink は og:description に期待文字列があれば verified を返す', () => {
  const html = `
    <html>
      <head>
        <meta property="og:description" content="ラハイナの美しい夕日をお届けします #牛窓" />
      </head>
    </html>
  `;
  const result = judgePermalink(html, { expect: '夕日' });
  assert.equal(result.verdict, 'verified');
  assert.match(result.evidence, /期待文字列 '夕日' を検出/);
});

test('judgePermalink は og:description に期待文字列が無ければ mismatch を返す', () => {
  const html = `
    <html>
      <head>
        <meta property="og:description" content="本日の朝食メニュー" />
      </head>
    </html>
  `;
  const result = judgePermalink(html, { expect: '夕日' });
  assert.equal(result.verdict, 'mismatch');
  assert.match(result.evidence, /期待文字列 '夕日' が見つかりませんでした/);
});

test('judgePermalink はログインウォールの場合に unverified を返す', () => {
  const html = '<html><title>Login • Instagram</title><body>Login required</body></html>';
  const result = judgePermalink(html, { expect: '夕日' });
  assert.equal(result.verdict, 'unverified');
  assert.match(result.evidence, /ログインウォール/);
});

test('judgePermalink は expect なしの場合にメタデータがあれば verified を返す', () => {
  const html = `
    <html>
      <head>
        <meta property="og:title" content="Instagram post by lahaina" />
        <meta property="og:description" content="素敵な写真" />
      </head>
    </html>
  `;
  const result = judgePermalink(html);
  assert.equal(result.verdict, 'verified');
});

test('judgeProfile は username またはフォロワー情報が含まれる場合に verified を返す', () => {
  const html = `
    <html>
      <head>
        <title>ペンション ラハイナ (@lahaina_ushimado) • Instagram photos and videos</title>
        <meta property="og:title" content="ペンション ラハイナ (@lahaina_ushimado) • Instagram" />
        <meta property="og:description" content="フォロワー500人、フォロー中100人、投稿50件" />
      </head>
    </html>
  `;
  const result = judgeProfile(html, 'lahaina_ushimado');
  assert.equal(result.verdict, 'verified');
  assert.match(result.evidence, /プロフィール情報を検出/);
});

test('isLoginWall は "httpErrorPage" を誤検知しない（通常JSバンドルに入っている）', () => {
  assert.equal(
    isLoginWall('<html><title>Instagram</title><script>var A="httpErrorPage";</script></html>'),
    false
  );
});

test('isJsShell は og メタ無しの JS シェルを検出する', () => {
  assert.equal(isJsShell('<html><head><title>Instagram</title></head></html>'), true);
  assert.equal(
    isJsShell('<html><head><title>Instagram</title><meta property="og:title" content="x"></head></html>'),
    false
  );
});

test('judgeProfile は JS シェルを「未検証」とし、実表示の確認手段を証拠に書く', () => {
  const result = judgeProfile('<html><head><title>Instagram</title></head></html>', 'lahaina_ushimado');
  assert.equal(result.verdict, 'unverified');
  assert.match(result.evidence, /JSシェル/);
});

test('verify-post.mjs CLI は HTTP 500 時に unverified で exit 1 を返す', async () => {
  const stdout = createMockStream();
  const stderr = createMockStream();

  const mockFetch = async () => ({
    ok: false,
    status: 500,
    statusText: 'Internal Server Error',
    async text() {
      return 'Server Error';
    },
  });

  const code = await runCli(['--permalink', 'https://www.instagram.com/p/DBERR500/'], {
    stdout,
    stderr,
    fetchImpl: mockFetch,
  });

  assert.equal(code, 1);
  assert.match(stdout.output, /unverified:/);
  assert.match(stdout.output, /HTTPステータス: 500/);
});

// --- Graph API 読み戻し（2026-10-15: 素の HTTP は JS シェルしか返さないため正本を API に移す） ---

test('judgeGraphMedia は permalink 一致で verified（末尾スラッシュ・クエリを無視）', () => {
  const media = [
    { id: '1789', permalink: 'https://www.instagram.com/p/ABC123/?igsh=xyz', timestamp: '2026-10-15T01:00:00+0000' },
  ];
  const result = judgeGraphMedia(media, { permalink: 'https://www.instagram.com/p/ABC123/' });
  assert.equal(result.verdict, 'verified');
  assert.match(result.evidence, /id=1789/);
});

test('judgeGraphMedia は permalink 不一致で mismatch', () => {
  const media = [{ id: '1', permalink: 'https://www.instagram.com/p/OTHER/', timestamp: '2026-10-15T01:00:00+0000' }];
  const result = judgeGraphMedia(media, { permalink: 'https://www.instagram.com/p/ABC123/' });
  assert.equal(result.verdict, 'mismatch');
  assert.match(result.evidence, /直近1件/);
});

test('judgeGraphMedia は /me/media が0件なら unverified（投稿なしと言い切らない）', () => {
  const result = judgeGraphMedia([], { permalink: 'https://www.instagram.com/p/ABC123/' });
  assert.equal(result.verdict, 'unverified');
  assert.match(result.evidence, /0件/);
});

test('judgeGraphMedia は expect を caption から探す', () => {
  const media = [{ id: '7', permalink: 'https://www.instagram.com/p/XYZ/', caption: '牛窓のペット宿 ラハイナ', timestamp: '2026-10-15T02:00:00+0000' }];
  assert.equal(judgeGraphMedia(media, { expect: 'ラハイナ' }).verdict, 'verified');
  assert.equal(judgeGraphMedia(media, { expect: '存在しない語' }).verdict, 'mismatch');
});

test('verify-post.mjs --via graph はトークンが要る（未設定なら exit 1）', async () => {
  const stdout = createMockStream();
  const stderr = createMockStream();
  const envFile = path.join(os.tmpdir(), `ig-empty-${Date.now()}.env`);
  fs.writeFileSync(envFile, 'INSTAGRAM_USERNAME=lahaina_ushimado\n');

  const code = await runCli(['--profile', '--via', 'graph', '--env', envFile], {
    stdout,
    stderr,
    fetchImpl: async () => {
      throw new Error('fetch してはいけない');
    },
  });

  assert.equal(code, 1);
  assert.match(stderr.output, /INSTAGRAM_ACCESS_TOKEN/);
  fs.unlinkSync(envFile);
});

test('verify-post.mjs --via graph は /me/media を正本として permalink を判定する', async () => {
  const stdout = createMockStream();
  const stderr = createMockStream();
  const envFile = path.join(os.tmpdir(), `ig-token-${Date.now()}.env`);
  fs.writeFileSync(envFile, 'INSTAGRAM_ACCESS_TOKEN=TESTTOKEN\n');

  const seen = [];
  const mockFetch = async (url) => {
    seen.push(String(url));
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      async json() {
        return { data: [{ id: '1789', permalink: 'https://www.instagram.com/p/ABC123/', timestamp: '2026-10-15T01:00:00+0000' }] };
      },
    };
  };

  const code = await runCli(
    ['--permalink', 'https://www.instagram.com/p/ABC123/', '--via', 'graph', '--env', envFile],
    { stdout, stderr, fetchImpl: mockFetch }
  );

  assert.equal(code, 0);
  assert.match(stdout.output, /verified:/);
  assert.equal(seen.length, 1);
  assert.match(seen[0], /graph\.instagram\.com\/v21\.0\/me\/media/);
  assert.match(seen[0], /access_token=TESTTOKEN/);
  fs.unlinkSync(envFile);
});
