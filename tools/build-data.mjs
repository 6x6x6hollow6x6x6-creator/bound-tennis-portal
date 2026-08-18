/**
 * 全日本選手権のドロー表と成績結果から、サイトに読み込むJSONを作る
 *
 *   node tools/build-data.mjs <PDFを置いたフォルダ> [出力先.json]
 *
 * フォルダには index.json（下記の形）と、各PDFを置く。
 *   [{ tag:'44', date:'2026-07-11', ev:'シングルス', cat:'フリー', sex:'男子', out:'…/44-…pdf' }, …]
 * 加えて `<tag>-best8.pdf` を置く。
 *
 * 役割分担：
 *   ・出場者（氏名・所属）… ドロー表。文字の取りこぼしが0.1%で正確
 *   ・上位8位の順位     … 成績結果Best8。協会が確定させた値そのもの
 *   ・1回戦突破の判別   … 使わない。ドロー表の幾何からの復元は当たらなかった
 *                        （優勝者が22種目中3種目しか一致しなかった）
 *
 * 成績結果側は文字が欠けることがある（堀江和喜 → 江和喜）ので、
 * ドロー表の完全な氏名に部分一致で結びつける。
 */
import fs from 'fs';
import path from 'path';
import { parseDraw } from './draw-parse.mjs';
import { parseBest8 } from './best8.mjs';

const norm = s => String(s || '').replace(/[\s　]/g, '');

/** 成績結果側は文字が抜けることがあり、抜ける位置は先頭とは限らない
 *  （佐々木健 → 佐々健、柳沢繁夫 → 柳沢夫）。順序を保った部分列として照合する */
const isSubseq = (short, full) => {
  if (!short || !full) return false;
  let i = 0;
  for (const ch of full) if (ch === short[i]) i++;
  return i === short.length;
};
const nameHit = (a, b) => a === b || isSubseq(a, b) || isSubseq(b, a);

/** 成績結果の氏名を、ドロー表の氏名に結びつける */
function findEntry(entries, names, pref){
  const same = e => e.names.length === names.length;
  const fwd = e => names.every((n, i) => nameHit(n, e.names[i]));
  const rev = e => [...names].reverse().every((n, i) => nameHit(n, e.names[i]));
  let cands = entries.filter(e => same(e) && (fwd(e) || rev(e)));
  if (cands.length === 1) return cands[0];
  if (cands.length > 1){
    /* 所属で絞る */
    if (pref){
      const p = cands.filter(e => (e.prefs || []).some(x => x && (x.includes(pref) || pref.includes(x))));
      if (p.length) cands = p;
    }
    /* それでも複数なら、文字数がいちばん近いものを採る */
    const len = names.join('').length;
    cands.sort((a,b) => Math.abs(a.names.join('').length - len) - Math.abs(b.names.join('').length - len));
  }
  return cands[0] || null;
}

export function build(dir){
  const files = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  const tags = [...new Set(files.map(f => f.tag))];

  const players = new Map();        /* 氏名+所属 → 選手 */
  const tournaments = [], results = [];
  const log = [];
  let pid = 0, rid = 0;

  const keyOf = (name, pref) => `${name}|${pref}`;
  const getPlayer = (name, pref, sex) => {
    const k = keyOf(name, pref);
    if (!players.has(k)){
      pid++;
      players.set(k, { id: 'P' + String(pid).padStart(4,'0'), name, kana: '',
                       regno: '', pref: pref || '', sex: sex === '女子' ? '女' : '男',
                       birth: null, active: true });
    }
    return players.get(k);
  };

  for (const tag of tags){
    const mine = files.filter(f => f.tag === tag);
    const date = mine[0].date;
    const t = { id: 'T' + tag, name: `第${tag}回 全日本バウンドテニス選手権大会`,
                grade: 'G1', pref: '東京', venue: '東京体育館', date, deadline: date,
                cats: [...new Set(mine.map(f => f.cat))],
                evs: [...new Set(mine.map(f => f.ev))],
                draw: 0, fee: '', host: '公益財団法人 日本バウンドテニス協会',
                entryUrl: '', docUrl: '', published: true };
    tournaments.push(t);

    let best = [];
    const b8 = path.join(dir, `${tag}-best8.pdf`);
    if (fs.existsSync(b8)) best = parseBest8(b8);

    for (const f of mine){
      const d = parseDraw(f.out);
      if (!d){ log.push(`${tag} ${f.ev}${f.cat}${f.sex}: ドロー表を読めず、取り込まない`); continue; }

      /* まず全員を「出場」で登録する */
      const placeOf = new Map();
      const be = best.find(x => x.ev === f.ev && x.cat === f.cat && x.sex === f.sex);
      if (be){
        for (const r of be.results){
          const e = findEntry(d.entries, r.names, r.pref);
          if (e) placeOf.set(e.no, r.place);
          else log.push(`${tag} ${f.ev}${f.cat}${f.sex}: 「${r.names.join('・')}」が名簿に見つからず（${r.place}）`);
        }
      } else log.push(`${tag} ${f.ev}${f.cat}${f.sex}: 成績結果が無いので順位なし`);

      for (const e of d.entries){
        /* 欠場の判定はドロー表の「欠」の位置から推測しているので外すことがある。
           公式の成績結果に載っている選手は、当然ながら欠場していない */
        if (e.withdrawn && !placeOf.has(e.no)){
          log.push(`${tag} ${f.ev}${f.cat}${f.sex}: ${e.names.join('・')} は欠場として除外`);
          continue;
        }
        const place = placeOf.get(e.no) || '出場';
        e.names.forEach((n, i) => {
          const p = getPlayer(n, e.prefs[i] || e.prefs[0] || '', f.sex);
          rid++;
          results.push({ id: 'R' + String(rid).padStart(5,'0'), tid: t.id,
                         ev: f.ev, cat: f.cat, sex: f.sex,
                         draw: d.entries.length, place, pid: p.id,
                         status: '承認済', submitted: date, note: '' });
        });
      }
      const got = [...placeOf.values()].length;
      log.push(`${tag} ${f.ev}${f.cat}${f.sex}: 出場${d.entries.length}枠 / 順位${got}件`);
    }
  }

  /* 所属が読み取れなかった選手を、同姓同名で所属のある選手に寄せる。
     寄せ先が複数あるときは別人の可能性があるので、そのままにする */
  let merged = 0;
  const byName = new Map();
  for (const p of players.values()){
    if (!byName.has(p.name)) byName.set(p.name, []);
    byName.get(p.name).push(p);
  }
  const alias = new Map();
  for (const [, list] of byName){
    const withPref = list.filter(p => p.pref), without = list.filter(p => !p.pref);
    if (withPref.length === 1 && without.length){
      for (const p of without){ alias.set(p.id, withPref[0].id); merged++; }
    }
  }
  if (alias.size){
    for (const r of results) if (alias.has(r.pid)) r.pid = alias.get(r.pid);
    for (const [k, p] of players) if (alias.has(p.id)) players.delete(k);
  }
  log.push(`所属が空だった選手を同姓同名に統合: ${merged}件`);

  /* 同じ大会・同じ区分に同じ選手が2件入っていないか（取り違えの目印になる） */
  const seen = new Set(), dup = [];
  for (const r of results){
    const k = [r.tid, r.ev, r.cat, r.sex, r.pid].join('|');
    if (seen.has(k)) dup.push(k); else seen.add(k);
  }
  if (dup.length) log.push(`⚠ 同じ区分に二重登録: ${dup.length}件`);

  return { tournaments, players: [...players.values()], results, log };
}

if (process.argv[1] && process.argv[1].endsWith('build-data.mjs')){
  const dir = process.argv[2];
  const out = process.argv[3] || 'btp-import.json';
  const r = build(dir);
  console.log(r.log.join('\n'));
  console.log(`\n大会 ${r.tournaments.length} / 選手 ${r.players.length} / 結果 ${r.results.length}`);
  const byPlace = {};
  r.results.forEach(x => byPlace[x.place] = (byPlace[x.place]||0)+1);
  console.log('順位の内訳:', Object.entries(byPlace).map(([k,v])=>`${k} ${v}`).join(' / '));
  fs.writeFileSync(out, JSON.stringify({ tournaments: r.tournaments, players: r.players,
                                         results: r.results, news: [] }));
  console.log(`\n${out} に書き出しました`);
}
