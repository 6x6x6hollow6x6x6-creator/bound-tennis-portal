/**
 * 動作確認スクリプト
 *
 *   npm i -D playwright
 *   node tools/smoke-test.mjs
 *
 * index.html をブラウザで開いて、主要な画面と管理画面のひと通りを触る。
 * CDNには実際に取りに行くので、ネットにつながる環境で実行すること。
 * （CDNに出られない環境では STUB_CDN=1 を付けると、見た目は崩れるが動作だけ確認できる）
 *
 * これは画面の回帰テストなので、既定では SHEETS_API_URL と GOOGLE_CLIENT_ID を空にした
 * 複製を読み込ませる。理由は2つ。
 *   ・本番のスプレッドシートの中身でテスト結果が変わらないようにする（DEFAULT_DATA で走らせる）
 *   ・管理画面を「お試しモード」で開いて確認できるようにする
 *     （本番設定のままだとGoogleサインインが要るので、管理画面のテストが丸ごと飛んでしまう）
 * 本番の設定そのままで見たいときは USE_API=1 を付ける。
 * ただし件数系の項目はスプレッドシートの中身しだいで落ちるし、
 * file:// は生成元として登録できないのでサインインのエラーが出る。
 */
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL = path.join(HERE, '..', 'index.html');
const STUB = process.env.STUB_CDN === '1';
const USE_API = process.env.USE_API === '1';

/* 設定を空にした複製を作る。index.html 自体は書き換えない */
let TMP = null, FILE = 'file://' + REAL;
if (!USE_API){
  const src = fs.readFileSync(REAL, 'utf8')
    .replace(/const SHEETS_API_URL = '[^']*';/,   "const SHEETS_API_URL = '';")
    .replace(/const GOOGLE_CLIENT_ID = '[^']*';/, "const GOOGLE_CLIENT_ID = '';");
  TMP = path.join(os.tmpdir(), 'bt-gas-smoke.html');
  fs.writeFileSync(TMP, src);
  FILE = 'file://' + TMP;
}

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
  /* まとめて貼り付け。ベスト16以下や全参加者を入れる唯一の実用的な入口なので、
     誤りが候補に残らないことまで見る */
  await page.click('#admTabs [data-tab="results"]'); await page.waitForTimeout(500);
  const tid = await page.evaluate(() =>
    DATA.tournaments.find(t => t.evs.includes('シングルス') && t.grade === 'G2').id);
  await page.selectOption('#eTour', tid); await page.waitForTimeout(500);
  const who = await page.evaluate(() => DATA.players.slice(0,3).map(p => p.regno || p.id));
  const nR = await page.evaluate(() => DATA.results.length);
  await page.fill('#eBulk', [`優勝,${who[0]}`, `ベスト16\t${who[1]}`, `出場,${who[2]}`,
                             `優勝,名簿にいない人`, `出場,${who[0]}`].join('\n'));
  await page.click('#eBulkCheck'); await page.waitForTimeout(500);
  const bulk = await page.evaluate(() => ({
    候補: document.querySelectorAll('#eBulkResult tbody tr').length,
    エラー表示: /登録できません/.test(document.querySelector('#eBulkResult').innerText)
  }));
  check('貼り付けの誤りを弾く', bulk.候補 === 2 && bulk.エラー表示,
    `候補${bulk.候補}名（名簿外1件と重複1名を除外して2名が正しい）`);
  await page.click('#eBulkSave'); await page.waitForTimeout(600);
  check('貼り付けで一括登録できる', (await page.evaluate(() => DATA.results.length)) === nR + 2);

  await page.click('#admSave'); await page.waitForTimeout(600);
  check('保存できる', (await page.locator('#admDirty').isHidden()));
} else {
  console.log('  -- USE_API=1 のためスキップ（本番設定ではGoogleサインインが要る）');
}

console.log('\n■ 集計ルール');
/* 団体戦・BTラリー戦と、配点0のグレードがランキングに混ざっていないこと。
   ここが崩れると「掲載のみ」の約束が破れる */
const rule = await page.evaluate(() => {
  const S = DATA.content.settings;
  const rankEvs = S.rankEvents || EVENTS_LIST;
  const zeroGrades = GRADES.filter(g => !PLACES.some(pl => Number((S.points[g]||{})[pl]) > 0));
  const counted = Object.values(BOARDS).flatMap(b => b.rows).flatMap(r => r.counted);
  return {
    対象種目: rankEvs,
    区分に対象外の種目がある: Object.keys(BOARDS).some(k => !rankEvs.includes(k.split('|')[0])),
    配点0のグレードが混ざっている: counted.some(c => zeroGrades.includes(c.grade)),
    有効大会数の上限: S.topN,
    上限を超えている選手がいる: Object.values(BOARDS).flatMap(b => b.rows).some(r => r.counted.length > S.topN)
  };
});
check('ランキング区分は対象種目だけ', !rule.区分に対象外の種目がある, rule.対象種目.join('／'));

/* 小さいドローで「出ただけの入賞」に点が付かないこと。
   ここが壊れると、3試合勝った選手より1試合も勝っていない選手のほうが上に来る */
const win = await page.evaluate(() => ({
  ベスト4_4名: winsNeeded('ベスト4', 4), 準優勝_2名: winsNeeded('準優勝', 2),
  ベスト16_32名: winsNeeded('ベスト16', 32), 優勝_32名: winsNeeded('優勝', 32),
  出ただけの入賞: awardedPoint(DATA.content.settings, 'G2', 'ベスト4', 4),
  三勝したベスト8: awardedPoint(DATA.content.settings, 'G3', 'ベスト8', 32)
}));
check('勝ち数0の入賞は出場扱い', win.ベスト4_4名 === 0 && win.準優勝_2名 === 0);
check('勝ち数の計算が正しい', win.ベスト16_32名 === 1 && win.優勝_32名 === 5,
  `32名ドロー：ベスト16=${win.ベスト16_32名}勝 / 優勝=${win.優勝_32名}勝`);
check('勝った選手のほうが点が高い', win.三勝したベスト8 > win.出ただけの入賞,
  `3勝ベスト8 ${win.三勝したベスト8}pt > 出ただけの入賞 ${win.出ただけの入賞}pt`);
check('配点0のグレードは集計に入らない', !rule.配点0のグレードが混ざっている);

/* 平均方式。合計方式だと、予選を免除されるシード選手が出場数の差で沈む */
const avg = await page.evaluate(() => {
  const S = DATA.content.settings;
  const rows = Object.values(BOARDS).flatMap(b => b.rows);
  const bad = rows.filter(r => r.pts !== Math.round(r.sum / r.div));
  const divWrong = rows.filter(r => r.div !== Math.max(r.counted.length, S.minDivisor || 2));
  /* この方式が何のためにあるかを直接確かめる。
     シード選手（全国大会にしか出ない）が、予選から積み上げた選手に抜かれないこと */
  const d = n => Math.max(n, S.minDivisor || 2);
  const score = list => Math.round(list.reduce((a,b) => a+b, 0) / d(list.length));
  const 全国優勝   = score([awardedPoint(S,'G1','優勝',32)]);
  const 全国ベスト4 = score([awardedPoint(S,'G1','ベスト4',32)]);
  const 積み上げ   = score([awardedPoint(S,'G3','優勝',24), awardedPoint(S,'G3','優勝',24),
                            awardedPoint(S,'G2','優勝',32), awardedPoint(S,'G3','優勝',32)]);
  const 県だけ     = score([awardedPoint(S,'G3','優勝',32), awardedPoint(S,'G3','準優勝',24),
                            awardedPoint(S,'G3','ベスト4',24)]);
  return { averaged: S.averaged !== false, 計算が合わない: bad.length, 除数が違う: divWrong.length,
           全国優勝, 全国ベスト4, 積み上げ, 県だけ };
});
check('平均方式が有効', avg.averaged);
check('平均の計算が合っている', avg.計算が合わない === 0 && avg.除数が違う === 0, '合計÷max(採用数, 下限)');
check('全国優勝が積み上げより上', avg.全国優勝 > avg.積み上げ,
  `全国優勝 ${avg.全国優勝}pt > 予選から積み上げ ${avg.積み上げ}pt`);
check('全国ベスト4が県だけ回る選手より上', avg.全国ベスト4 > avg.県だけ,
  `全国ベスト4 ${avg.全国ベスト4}pt > 県のみ ${avg.県だけ}pt`);
check('有効大会数の上限が効いている', !rule.上限を超えている選手がいる, `上位${rule.有効大会数の上限}大会`);

/* 古い成績の減衰。サンプルデータは1年分しかないので、基準日をずらして確かめる */
const decay = await page.evaluate(() => {
  const S = DATA.content.settings, as = S.asOf || todayStr();
  const at = w => { const d = new Date(parseDate(as)); d.setDate(d.getDate() - w*7); return fmtDate(d); };
  const before = decayFactor(S, at(10), as), after = decayFactor(S, at(60), as);
  /* 基準日を1年進めると、いまの成績がすべて減衰対象になるはず */
  const org = S.asOf;
  const d = new Date(parseDate(as)); d.setFullYear(d.getFullYear() + 1);
  S.asOf = fmtDate(d); applyData(DATA);
  const faded = Object.values(BOARDS).flatMap(b => b.rows).flatMap(r => r.counted);
  const ok = faded.length > 0 && faded.every(c => c.fade < 1);
  S.asOf = org; applyData(DATA);   /* 後続の検査に影響しないよう戻す */
  return { 期間: S.periodWeeks, 直近: before, 古い: after, 減衰が適用された: ok };
});
check('集計期間が2年', decay.期間 >= 104, `${decay.期間}週`);
check('古い成績が減衰する', decay.直近 === 1 && decay.古い < 1,
  `10週前 ×${decay.直近} / 60週前 ×${decay.古い}`);
check('減衰が集計に反映される', decay.減衰が適用された);

/* カテゴリ跨ぎ。バウンドテニスでは加齢でクラスが上がるほか、人数の都合で
   シニアの選手がミドルに出ることもある。どちらでも成績が失われないこと */
const cross = await page.evaluate(() => {
  const S = DATA.content.settings, as = S.asOf || todayStr(), y = Number(as.slice(0,4));
  DATA.players.push({ id:'PX1', name:'検証 太郎', regno:'', pref:'石川', sex:'男', birth:y-62, active:true });
  DATA.players.push({ id:'PX2', name:'検証 次郎', regno:'', pref:'福井', sex:'男', birth:y-61, active:true });
  const t = { id:'TX1', name:'検証大会', grade:'G2', pref:'石川', venue:'', date:`${y}-06-01`,
              deadline:'', cats:CATS, evs:['シングルス'], draw:32, fee:'', host:'',
              entryUrl:'', docUrl:'', published:true };
  DATA.tournaments.push(t, { ...t, id:'TX2', date:`${y-2}-12-01` });
  DATA.results.push(
    { id:'RX1', tid:'TX1', ev:'シングルス', cat:'ミドル', sex:'男子', draw:32, place:'優勝', pid:'PX1', status:'承認済' },
    { id:'RX2', tid:'TX2', ev:'シングルス', cat:'フリー', sex:'男子', draw:32, place:'優勝', pid:'PX2', status:'承認済' });
  applyData(DATA);
  const has = (cat, pid) => !!(BOARDS[`シングルス|男子|${cat}`]?.rows || []).find(r => r.pid === pid);
  return {
    ミドルからシニアへ: has('シニア', 'PX1'),
    フリーには入らない: !has('フリー', 'PX1'),
    昇格しても引き継ぐ: has('シニア', 'PX2') && has('ミドル', 'PX2') && has('フリー', 'PX2')
  };
});
check('上位カテゴリへ算入される', cross.ミドルからシニアへ, 'ミドルの成績がシニアにも入る');
check('下位カテゴリへは算入しない', cross.フリーには入らない, 'ミドルの成績はフリーに入らない');
check('カテゴリが上がっても成績が残る', cross.昇格しても引き継ぐ, '年齢は集計基準日で判定');

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
