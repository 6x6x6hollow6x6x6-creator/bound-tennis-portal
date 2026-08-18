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
 *   ・8位より下の段     … ドロー表の**赤い線**をたどって出した勝ち数
 *                        （勝った人の線が赤く伸びる。詳しくは draw-parse.mjs）
 *
 * 成績結果側は文字が欠けることがある（堀江和喜 → 江和喜）ので、
 * ドロー表の完全な氏名に部分一致で結びつける。
 *
 * ドロー表が公開されていない種目（第44回のフリー女子）は、
 * 成績結果から上位8位だけを入れる。氏名は他の大会で登録済みの選手に寄せる。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseDraw } from './draw-parse.mjs';
import { parseBest8 } from './best8.mjs';

/** index.html の DEFAULT_DATA から content（配点・集計ルールとサイト文言）を取り出す。
 *  これを入れずに読み込むと、スプレッドシートに残っている古い設定が生き続けて
 *  集計期間や掲載条件が食い違う（実際に第43回が期間外に落ちて全員が消えた） */
function currentContent(){
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(here, '..', 'index.html'), 'utf8');
  const m = src.match(/const DEFAULT_DATA = (\{.*\});/);
  if (!m) return null;
  return JSON.parse(m[1]).content;
}

const norm = s => String(s || '').replace(/[\s　]/g, '');

const PREFS = ('北海道青森岩手宮城秋田山形福島茨城栃木群馬埼玉千葉東京神奈川新潟富山石川福井山梨長野'
  + '岐阜静岡愛知三重滋賀京都大阪兵庫奈良和歌山鳥取島根岡山広島山口徳島香川愛媛高知福岡佐賀長崎熊本大分宮崎鹿児島沖縄');
/** 「北信越/福井」「北海道ﾌﾞﾛｯｸ」→「福井」「北海道」。揃えないと同じ選手が二重に登録される */
const cleanPref = t => {
  const s = norm(t).replace(/[()（）]/g, '').replace(/^.*\//, '')
    .replace(/[ｦ-ﾟ]+$/, '').replace(/ブロック$/, '');
  return PREFS.includes(s) ? s : (s.length <= 4 ? s : '');
};

/** 成績結果側は文字が抜けることがあり、抜ける位置は先頭とは限らない
 *  （佐々木健 → 佐々健、柳沢繁夫 → 柳沢夫）。順序を保った部分列として照合する */
const isSubseq = (short, full) => {
  if (!short || !full) return false;
  let i = 0;
  for (const ch of full) if (ch === short[i]) i++;
  return i === short.length;
};
const nameHit = (a, b) => a === b || isSubseq(a, b) || isSubseq(b, a);

/** 上位8位に入らなかった選手の段を、勝ち数から決める。
 *  base はベスト8の選手の勝ち数。そこから1つ下がるごとに1段下がる。
 *  勝ち数と段の対応は大会の規模で変わる（ダブルスは枠が少なく段も浅い）ので、
 *  固定の対応表ではなく公式の値で目盛りを合わせる */
function belowBest8(wins, base){
  if (wins === null || wins === undefined) return '出場';
  if (!wins) return '出場';
  if (base === null) return '1回戦突破';
  const down = base - wins;                 /* ベスト8から何段下か */
  /* 公式の上位8位に入っていない以上、ベスト8より上にはなりえない。
     勝ち数が同じでもベスト16どまりとして扱う（読み取りが多めに出たとき安全側に倒す） */
  if (down <= 1) return 'ベスト16';
  if (down === 2) return 'ベスト32';
  return '1回戦突破';
}

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
  /* 古い大会から処理する。ドロー表が無い種目の氏名を、先に登録した選手に寄せるため */
  const tags = [...new Set(files.map(f => f.tag))].sort();
  const drawOf = new Map();          /* 種目ごとの枠数。ドロー表が無い年の推定に使う */

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
      if (!d){
        /* ドロー表が読めなくても、成績結果に載っていれば上位8位だけは入れられる。
           第44回のフリー女子は協会サイトに分割版の一部しか公開されていない。
           氏名は成績結果側で文字が抜けるので、別の大会・種目で登録済みの選手に寄せる */
        const be2 = best.find(x => x.ev === f.ev && x.cat === f.cat && x.sex === f.sex);
        if (!be2){ log.push(`${tag} ${f.ev}${f.cat}${f.sex}: ドロー表も成績結果も無く、取り込まない`); continue; }
        /* ドロー係数のために枠数が要る。同じ種目の別の年の値を使う */
        const est = drawOf.get(`${f.ev}|${f.cat}|${f.sex}`) || 0;
        if (!est) log.push(`${tag} ${f.ev}${f.cat}${f.sex}: 枠数が分からずドロー係数を最低で計算する`);
        let n8 = 0;
        for (const r of be2.results){
          for (const nm of r.names){
            const known = [...players.values()].filter(p =>
              (p.name === nm || isSubseq(nm, p.name)) &&
              (!r.pref || !p.pref || p.pref.includes(cleanPref(r.pref)) || cleanPref(r.pref).includes(p.pref)));
            const p = known.length === 1 ? known[0] : getPlayer(nm, cleanPref(r.pref), f.sex);
            if (known.length !== 1) log.push(`${tag} ${f.ev}${f.cat}${f.sex}: 「${nm}」は照合できず、そのまま登録`);
            rid++;
            results.push({ id: 'R' + String(rid).padStart(5,'0'), tid: t.id,
                           ev: f.ev, cat: f.cat, sex: f.sex, draw: est,
                           place: r.place, pid: p.id, status: '承認済', submitted: date, note: '' });
            n8++;
          }
        }
        log.push(`${tag} ${f.ev}${f.cat}${f.sex}: ドロー表が無いため上位8位のみ ${n8}件`);
        continue;
      }

      /* まず全員を「出場」で登録する */
      const placeOf = new Map();
      const winsOf = new Map();
      const be = best.find(x => x.ev === f.ev && x.cat === f.cat && x.sex === f.sex);
      if (be){
        for (const r of be.results){
          const e = findEntry(d.entries, r.names, r.pref);
          if (e){ placeOf.set(e.no, r.place); if (r.place === 'ベスト8') winsOf.set(e.no, e.wins); }
          else log.push(`${tag} ${f.ev}${f.cat}${f.sex}: 「${r.names.join('・')}」が名簿に見つからず（${r.place}）`);
        }
      } else log.push(`${tag} ${f.ev}${f.cat}${f.sex}: 成績結果が無いので順位なし`);

      /* ベスト8の選手が何勝しているかを基準にして、それより下の段を決める。
         勝ち数と段の対応は大会の規模で変わるので、公式の値で目盛りを合わせる */
      const w8 = [...winsOf.values()].filter(v => v > 0);
      const base = w8.length ? Math.min(...w8) : null;
      if (base === null) log.push(`${tag} ${f.ev}${f.cat}${f.sex}: 基準が取れず、8位より下は1回戦突破/出場のみ`);

      for (const e of d.entries){
        /* 欠場の判定はドロー表の「欠」の位置から推測しているので外すことがある。
           公式の成績結果に載っている選手は、当然ながら欠場していない */
        if (e.withdrawn && !placeOf.has(e.no)){
          log.push(`${tag} ${f.ev}${f.cat}${f.sex}: ${e.names.join('・')} は欠場として除外`);
          continue;
        }
        const place = placeOf.get(e.no) || belowBest8(e.wins, base);
        e.names.forEach((n, i) => {
          const p = getPlayer(n, e.prefs[i] || e.prefs[0] || '', f.sex);
          rid++;
          results.push({ id: 'R' + String(rid).padStart(5,'0'), tid: t.id,
                         ev: f.ev, cat: f.cat, sex: f.sex,
                         draw: d.entries.length, place, pid: p.id,
                         status: '承認済', submitted: date, note: '' });
        });
      }
      drawOf.set(`${f.ev}|${f.cat}|${f.sex}`, d.entries.length);
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

  const content = currentContent();
  if (content){
    /* 掲載中の注意バーは、取り込み後は実データになるので文言を変える */
    content.site = { ...content.site,
      noticeBar: '検討用の試作サイトです。全日本選手権の公開資料から取り込んだ暫定集計です。' };
    log.push('配点・集計ルールとサイト文言も index.html の内容で入れ替える');
  } else log.push('⚠ index.html から設定を取り出せなかった');

  return { tournaments, players: [...players.values()], results, content, log };
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
                                         results: r.results, news: [], content: r.content }));
  console.log(`\n${out} に書き出しました`);
}
