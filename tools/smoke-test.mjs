/**
 * 動作確認スクリプト
 *
 *   npm i -D playwright
 *   node tools/smoke-test.mjs
 *
 * index.html をブラウザで開いて、主要な画面と管理画面のひと通りを触る。
 * CDNには実際に取りに行くので、ネットにつながる環境で実行すること。
 * （CDNに出られない環境では STUB_CDN=1 を付けると、見た目は崩れるが動作だけ確認できる）
 */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + path.join(HERE, '..', 'index.html');
const STUB = process.env.STUB_CDN === '1';

const problems = [];
const check = (label, ok, detail) => {
  console.log(`${ok ? '  ok ' : '  NG '} ${label}${detail ? '  — ' + detail : ''}`);
  if (!ok) problems.push(label);
};

/* 初回は npx playwright install が必要。別のChromeを使いたいときは PW_CHROMIUM でパス指定 */
const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
page.on('pageerror', e => problems.push('JSエラー: ' + e.message));
page.on('console', m => { if (m.type() === 'error') problems.push('コンソールエラー: ' + m.text()); });
page.on('dialog', d => d.accept());

if (STUB){
  await page.route('https://cdn.tailwindcss.com*', r =>
    r.fulfill({ status:200, contentType:'application/javascript', body:'window.tailwind={config:{}};' }));
  await page.route('https://unpkg.com/**', r =>
    r.fulfill({ status:200, contentType:'application/javascript', body:'window.lucide={createIcons(){}};' }));
  await page.route('https://accounts.google.com/**', r =>
    r.fulfill({ status:200, contentType:'application/javascript', body:'' }));
}

console.log('\n■ 公開画面');
await page.goto(FILE);
await page.waitForTimeout(2500);
check('データ読み込み', await page.evaluate(() => typeof DATA === 'object' && DATA !== null),
  await page.evaluate(() => `source=${DATA_SOURCE} / 大会${DATA.tournaments.length}件`));
check('トップの数字', (await page.locator('#homeStats > div').count()) === 4);
check('お知らせ', (await page.locator('#homeNews > div').count()) > 0);
check('カレンダー', (await page.locator('#monthChart svg').count()) === 1);

for (const [v, sel] of [['events','#eventList'], ['ranking','#rankTable'], ['results','#resultList'],
                        ['news','#newsList'], ['about','#aboutBody']]){
  await page.click(`#mainNav [data-nav="${v}"]`);
  await page.waitForTimeout(400);
  check(`${v} が表示される`, (await page.locator(sel).innerHTML()).length > 200);
}

console.log('\n■ ランキングの内訳');
await page.click('#mainNav [data-nav="ranking"]'); await page.waitForTimeout(500);
if (await page.locator('#rankTable [data-exp]').count()){
  await page.click('#rankTable tbody tr:nth-child(1) [data-exp]');
  await page.waitForTimeout(400);
  check('内訳が開く', (await page.locator('[data-detail] .stack > span').count()) > 0);
  await page.click('[data-player]'); await page.waitForTimeout(400);
  check('戦績モーダル', (await page.locator('#modalBody tbody tr').count()) > 0);
  await page.keyboard.press('Escape');
} else check('ランキングに行がある', false, '順位が1件も出ていない');

console.log('\n■ 管理画面（お試しモード）');
await page.click('#adminLoginBtn'); await page.waitForTimeout(300);
const local = await page.locator('#localLogin').isVisible();
if (local){
  await page.click('#localLoginBtn'); await page.waitForTimeout(600);
  check('管理画面が開く', !(await page.locator('#adminOverlay').isHidden()));
  const before = await page.evaluate(() => DATA.tournaments.length);
  await page.click('#tNew'); await page.waitForTimeout(300);
  await page.fill('#tfName', '【smoke-test】自動テストで追加');
  await page.fill('#tfDate', '2026-10-04');
  await page.click('#tSave'); await page.waitForTimeout(500);
  check('大会を追加できる', (await page.evaluate(() => DATA.tournaments.length)) === before + 1);
  for (const tab of ['results','players','news','settings','site']){
    await page.click(`#admTabs [data-tab="${tab}"]`); await page.waitForTimeout(400);
    check(`管理タブ ${tab}`, (await page.locator('#admBody').innerHTML()).length > 200);
  }
  await page.click('#admSave'); await page.waitForTimeout(600);
  check('保存できる', (await page.locator('#admDirty').isHidden()));
} else {
  console.log('  -- APIが設定されているため、お試しモードのテストはスキップ');
}

console.log('\n■ レスポンシブ');
for (const [w, h, tag] of [[1360,1000,'PC'], [820,900,'タブレット'], [390,850,'スマホ']]){
  await page.setViewportSize({ width:w, height:h });
  await page.waitForTimeout(200);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`${tag}（${w}px）で横スクロールなし`, over <= 1, over > 1 ? `${over}px はみ出し` : '');
}

await browser.close();
console.log('\n' + (problems.length
  ? `× ${problems.length} 件の問題\n  - ` + problems.join('\n  - ')
  : '○ すべて通りました'));
process.exit(problems.length ? 1 : 0);
