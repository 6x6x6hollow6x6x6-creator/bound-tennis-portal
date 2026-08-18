/**
 * ドロー表PDFから、出場者と対戦結果を復元する
 *
 *   node tools/draw-parse.mjs <PDFのパス>          … 人が読める形で表示
 *   node tools/draw-parse.mjs <PDFのパス> --json   … JSONで出力
 *
 * 考え方：
 *   スコアの x 座標は線の長さで揺れるので、列で切ろうとすると合わない。
 *   代わりにラウンドごとに解く。1回戦は隣り合う2人の対戦なので、
 *   その2人の y のあいだにある数字がその試合のスコアになる。
 *   勝者は次のラウンドで「2人の中間の y」に進むので、同じ理屈を繰り返せる。
 *
 * 左半分は左から右へ、右半分は右から左へ勝ち上がるので、
 * ラウンドが進むほどスコアの x は中央に寄る。この向きも使って絞り込む。
 */
import { extract } from './draw-pdf.mjs';

const PREFS = ('北海道青森岩手宮城秋田山形福島茨城栃木群馬埼玉千葉東京神奈川新潟富山石川福井山梨長野'
  + '岐阜静岡愛知三重滋賀京都大阪兵庫奈良和歌山鳥取島根岡山広島山口徳島香川愛媛高知福岡佐賀長崎熊本大分宮崎鹿児島沖縄');
const norm = s => String(s || '').replace(/[\s　]/g, '');
/* 都道府県は「石　川」「(福　井)」「北信越/福井」など書き方がまちまち */
const bare = s => norm(s).replace(/[()（）]/g, '');
const isPrefName = t => {
  const s = bare(t);
  if (!s) return false;
  if (s.includes('/')) return true;                 /* ブロック/県 の書き方 */
  return s.length <= 4 && PREFS.includes(s);
};
const hasKana = t => /[一-鿿ぁ-んァ-ヶ]/.test(t);

/** 列ごとにまとめる */
function columns(items, tol = 12){
  const sorted = [...items].sort((a,b) => a.x - b.x);
  const out = [];
  for (const it of sorted){
    const last = out[out.length-1];
    if (last && it.x - last.x <= tol){ last.items.push(it); last.x = it.x; }
    else out.push({ x: it.x, items: [it] });
  }
  return out.map(c => ({ x: c.items.reduce((s,i)=>s+i.x,0)/c.items.length, items: c.items }));
}

export function parseDraw(path){
  const items = extract(path);
  if (!items.length) return null;

  /* エントリー番号の列を基準にする。1,2,3… と連番になっている列は他に無いので確実に見分けられる。
     ダブルスでは1チーム2名が2行に並ぶが、番号はチームの中央に1つだけ打たれるので、
     この y をそのまま「枠」の位置として使える。シングルスでもダブルスでも同じ扱いになる */
  const numCols = columns(items.filter(i => /^\d{1,3}$/.test(i.t)))
    .map(c => ({ ...c, items: [...c.items].sort((a,b) => a.y - b.y) }))
    .filter(c => {
      if (c.items.length < 8) return false;
      const v = c.items.map(i => Number(i.t));
      let step = 0;
      for (let i = 1; i < v.length; i++) if (v[i] === v[i-1] + 1) step++;
      return step >= v.length - 2;               /* ほぼ連番 */
    })
    .sort((a,b) => a.x - b.x);
  if (!numCols.length) return null;

  /* 各枠の列に対して、いちばん近い氏名の列を選ぶ */
  const kanjiCols = columns(items.filter(i => hasKana(i.t) && !isPrefName(i.t) && bare(i.t).length >= 2))
    .filter(c => c.items.length >= 6);
  const nameCols = numCols.map(nc => {
    let best = null, bd = 1e9;
    for (const kc of kanjiCols){
      const d = Math.abs(kc.x - nc.x);
      if (d < bd && d < 200){ bd = d; best = kc; }
    }
    return best;
  }).filter(Boolean);
  if (!nameCols.length) return null;

  /* 各氏名の右か左にある都道府県を拾う（同じ y の近くにあるもの） */
  const prefItems = items.filter(i => isPrefName(i.t) || /\//.test(i.t));
  const nearPref = (y, x) => {
    let best = null, bd = 1e9;
    for (const p of prefItems){
      const d = Math.abs(p.y - y);
      if (d < 6 && Math.abs(p.x - x) < 260 && d < bd){ bd = d; best = p; }
    }
    return best ? norm(best.t) : '';
  };

  /* 枠ごとに、その番号の y に近い氏名を集める。シングルスは1名、ダブルスは2名になる */
  const halves = numCols.map((nc, idx) => {
    const nameCol = nameCols[idx] || nameCols[0];
    /* 氏名は「いちばん近い枠」に割り当てる。行間は大会や種目で変わるので、
       固定の許容幅で拾うとシングルスでも隣の行まで巻き込む */
    const bucket = new Map(nc.items.map(n => [n, []]));
    for (const r of nameCol.items){
      let best = null, bd = 1e9;
      for (const n of nc.items){ const d = Math.abs(r.y - n.y); if (d < bd){ bd = d; best = n; } }
      if (best && bd <= 40) bucket.get(best).push(r);
    }
    const slots = nc.items.map(n => {
      const near = bucket.get(n).sort((a,b) => a.y - b.y);
      return {
        no: Number(n.t), y: n.y,
        names: near.map(r => norm(r.t)),
        prefs: near.map(r => nearPref(r.y, r.x)).filter(Boolean)
      };
    }).filter(s => s.names.length);
    return { side: idx === 0 ? 'L' : 'R', x: nameCol.x, players: slots };
  }).filter(h => h.players.length);

  /* スコア候補＝1桁の数字で、氏名の列より内側にあるもの */
  const lx = halves[0].x, rx = halves.length > 1 ? halves[halves.length-1].x : lx + 600;
  const scores = items.filter(i => /^\d$/.test(i.t))
    .map(i => ({ x:i.x, y:i.y, v:Number(i.t) }))
    .filter(s => s.x > lx + 60 && s.x < rx - 60);

  const used = new Set();
  const key = s => `${Math.round(s.x)},${Math.round(s.y)}`;
  const matches = [], unresolved = [];

  for (const half of halves){
    if (!half.players.length) continue;
    const inward = half.side === 'L' ? 1 : -1;   /* 勝ち上がる向き */
    let alive = half.players.map(p => ({ p, y: p.y, depth: 0, edge: half.x }));
    let round = 1;
    while (alive.length > 1 && round < 12){
      const next = [];
      for (let i = 0; i < alive.length; i += 2){
        const a = alive[i], b = alive[i+1];
        if (!b){ next.push({ ...a, y: a.y }); continue; }   /* 不戦勝 */
        const lo = Math.min(a.y, b.y), hi = Math.max(a.y, b.y);
        /* 2人のあいだにあり、まだ使っていない数字を、内側に近い順に見る */
        const cands = scores.filter(s => s.y > lo + 1 && s.y < hi - 1 && !used.has(key(s)))
          .sort((s1, s2) => inward * (s1.x - s2.x));
        /* 同じ列（x が近い）2つを1試合とみなす */
        let pair = null;
        for (let k = 0; k < cands.length && !pair; k++)
          for (let m = k+1; m < cands.length; m++)
            if (Math.abs(cands[k].x - cands[m].x) <= 10){ pair = [cands[k], cands[m]]; break; }
        /* スコアが見つからない＝不戦勝か、読み取れなかったか。
           どちらか分からないまま勝者を決めると誤った順位になるので、未確定として印を付ける */
        if (!pair){
          unresolved.push({ round, a: a.p.names, b: b.p.names });
          next.push({ ...a, y: (a.y + b.y)/2, unsure: true });
          continue;
        }
        pair.forEach(s => used.add(key(s)));
        const [up, dn] = pair.sort((s1,s2) => s1.y - s2.y);
        const upper = a.y < b.y ? a : b, lower = a.y < b.y ? b : a;
        const win = up.v > dn.v ? upper : lower;
        const lose = win === upper ? lower : upper;
        matches.push({ round, winner: win.p.names, loser: lose.p.names,
                       score: `${Math.max(up.v,dn.v)}-${Math.min(up.v,dn.v)}` });
        next.push({ ...win, y: (a.y + b.y)/2 });
      }
      alive = next;
      round++;
    }
    half.winner = alive[0] ? alive[0].p.names : null;
    half.rounds = round - 1;
  }

  /* 決勝は左右の勝者どうし。中央に残ったスコアで決める */
  if (halves.length === 2 && halves[0].winner && halves[1].winner){
    const rest = scores.filter(s => !used.has(key(s))).sort((a,b) => a.y - b.y);
    let pair = null;
    for (let k = 0; k < rest.length && !pair; k++)
      for (let m = k+1; m < rest.length; m++)
        if (Math.abs(rest[k].x - rest[m].x) <= 10 && Math.abs(rest[k].y - rest[m].y) < 120){
          pair = [rest[k], rest[m]]; break;
        }
    if (pair){
      const [up, dn] = pair.sort((a,b) => a.y - b.y);
      /* 上に描かれているのが左半分の勝者 */
      const win = up.v > dn.v ? halves[0].winner : halves[1].winner;
      const lose = win === halves[0].winner ? halves[1].winner : halves[0].winner;
      matches.push({ round: 'final', winner: win, loser: lose,
                     score: `${Math.max(up.v,dn.v)}-${Math.min(up.v,dn.v)}` });
    } else unresolved.push({ round:'final', a: halves[0].winner, b: halves[1].winner });
  }

  /* 出場者は「枠」単位ではなく人単位で返す。ダブルスは1枠に2名 */
  const entries = halves.flatMap(h => h.players.map(p => ({ no:p.no, names:p.names, prefs:p.prefs })));
  const players = entries.flatMap(e => e.names.map((n,i) => ({ name:n, pref: e.prefs[i] || e.prefs[0] || '' })));
  return { entries, players, matches, unresolved,
           halves: halves.map(h => ({ side:h.side, n:h.players.length, winner:h.winner })) };
}

if (process.argv[1] && process.argv[1].endsWith('draw-parse.mjs')){
  const r = parseDraw(process.argv[2]);
  if (!r){ console.error('読み取れませんでした'); process.exit(1); }
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 1));
  else {
    const need = r.entries.length - 1;
    console.log(`出場 ${r.entries.length} 枠 / ${r.players.length} 名`);
    console.log(`復元できた試合 ${r.matches.length}（必要 ${need}）／ 未確定 ${r.unresolved.length}`);
    console.log('半分ごと:', r.halves.map(h => `${h.side} ${h.n}枠 勝者=${(h.winner||[]).join('・')}`).join(' / '));
    const nm = a => (a || []).join('・');
    const byRound = {};
    r.matches.forEach(m => (byRound[m.round] = byRound[m.round] || []).push(m));
    for (const k of Object.keys(byRound)){
      console.log(`\n[${k === 'final' ? '決勝' : k + '回戦'}] ${byRound[k].length}試合`);
      byRound[k].slice(0, 5).forEach(m => console.log(`  ${nm(m.winner)} ${m.score} ${nm(m.loser)}`));
      if (byRound[k].length > 5) console.log(`  …ほか${byRound[k].length-5}試合`);
    }
  }
}
