/**
 * 全日本選手権の「成績結果Best8」PDFから、種目ごとの上位8位を読む
 *
 *   node tools/best8.mjs <PDFのパス>          … 表示
 *   node tools/best8.mjs <PDFのパス> --json   … JSON
 *
 * こちらは協会が確定させた順位そのものなので、ドロー表の幾何から推測するより確実。
 * ドロー表（tools/draw-parse.mjs）は出場者名簿と1回戦突破の判別に使い、
 * 上位8位はこちらを正とする。
 *
 * 表の作り（1種目ぶん）：
 *   見出し「フリー男子シングルス」
 *     優　勝   氏名   所属        ← いちばん上が優勝
 *     優勝     氏名   所属        ← ラベルの「準」が欠けて出るが、位置で準優勝と分かる
 *     第３位   氏名   所属
 *     第４位   氏名   所属
 *     （ベスト８のラベルはグループの途中に置かれる）
 *     …ベスト8が4人
 *   ダブルスは1組2名なので行数が倍になる。
 *
 * ラベルの文字が欠けることがあるため、ラベルは読まず「上から何番目か」で順位を決める。
 */
import { extract } from './draw-pdf.mjs';

const PREFS = ('北海道青森岩手宮城秋田山形福島茨城栃木群馬埼玉千葉東京神奈川新潟富山石川福井山梨長野'
  + '岐阜静岡愛知三重滋賀京都大阪兵庫奈良和歌山鳥取島根岡山広島山口徳島香川愛媛高知福岡佐賀長崎熊本大分宮崎鹿児島沖縄');
const norm = s => String(s || '').replace(/[\s　]/g, '');
const isPref = t => {
  const s = norm(t).replace(/[()（）]/g, '');
  if (!s) return false;
  if (s.includes('/') || /[ｦ-ﾟ]/.test(s)) return true;      /* ブロック/県、北海道ﾌﾞﾛｯｸ */
  return s.length <= 4 && PREFS.includes(s);
};
const isLabel = t => /^(優|準優勝|第[０-９0-9一二三四五六七八九]+位|ベスト|成結果|第\d日目)/.test(norm(t));

/* 上から順に、この順位を割り当てる */
const ORDER = ['優勝','準優勝','ベスト4','ベスト4','ベスト8','ベスト8','ベスト8','ベスト8'];

export function parseBest8(path){
  const items = extract(path);
  const heads = items.filter(i =>
    /^(フリー|ミドル|シニア)(男子|女子)(シングルス|ダブルス)$/.test(norm(i.t)));
  const out = [];

  for (const h of heads){
    const m = norm(h.t).match(/^(フリー|ミドル|シニア)(男子|女子)(シングルス|ダブルス)$/);
    const [, cat, sex, ev] = m;
    const per = ev === 'ダブルス' ? 2 : 1;      /* 1組の人数 */

    /* 同じページ・同じ縦列で、見出しより下（y が小さい）にある氏名だけを拾う。
       ラベルは左、所属は右にあるので、見出しと同じ x のものに絞れば氏名だけが残る */
    const block = items.filter(i => i.page === h.page
      && Math.abs(i.x - h.x) < 26
      && i.y < h.y - 4
      && !isPref(i.t) && !isLabel(i.t) && /[一-鿿ぁ-んァ-ヶ]/.test(i.t))
      .sort((a,b) => b.y - a.y);

    /* 次の見出しより下は別の種目 */
    const nextHead = heads.filter(x => x.page === h.page && Math.abs(x.x - h.x) < 26 && x.y < h.y - 4)
      .sort((a,b) => b.y - a.y)[0];
    const names = (nextHead ? block.filter(i => i.y > nextHead.y) : block).slice(0, 8 * per);

    const rows = [];
    for (let k = 0; k * per < names.length && k < 8; k++){
      const grp = names.slice(k*per, k*per + per);
      if (grp.length < per) break;
      /* 所属は、その組の氏名と同じ高さの右側にある */
      const pref = items.filter(i => i.page === h.page && isPref(i.t)
        && i.x > h.x + 40 && i.x < h.x + 200
        && i.y <= grp[0].y + 4 && i.y >= grp[grp.length-1].y - 4)
        .sort((a,b) => Math.abs(a.y - grp[0].y) - Math.abs(b.y - grp[0].y))[0];
      rows.push({ place: ORDER[k], names: grp.map(g => norm(g.t)),
                  pref: pref ? norm(pref.t).replace(/[()（）]/g,'') : '' });
    }
    if (rows.length) out.push({ ev, cat, sex, page: h.page, results: rows });
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('best8.mjs')){
  const r = parseBest8(process.argv[2]);
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 1));
  else {
    console.log(`${r.length} 種目を読み取りました\n`);
    for (const e of r){
      console.log(`■ ${e.cat}${e.sex}${e.ev}（${e.results.length}組）`);
      e.results.forEach(x => console.log(`   ${x.place.padEnd(5,'　')} ${x.names.join('・').padEnd(16,'　')} ${x.pref}`));
      console.log('');
    }
  }
}
