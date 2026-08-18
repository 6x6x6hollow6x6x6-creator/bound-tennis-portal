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
const isPrefName = t => { const s = norm(t); return s.length <= 4 && PREFS.includes(s); };
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

  /* 氏名の列を見つける。漢字を含み、都道府県ではないものが多数を占める列 */
  const cand = columns(items.filter(i => hasKana(i.t) && i.t.length >= 2));
  const nameCols = cand.filter(c => {
    const names = c.items.filter(i => !isPrefName(i.t));
    return names.length >= 8 && names.length > c.items.length * 0.7;
  }).sort((a,b) => b.items.length - a.items.length).slice(0, 2).sort((a,b) => a.x - b.x);
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

  /* 半分ごとに選手を並べる。左半分＝x が小さい列、右半分＝大きい列 */
  const halves = nameCols.map((c, idx) => {
    const players = c.items.filter(i => !isPrefName(i.t))
      .sort((a,b) => a.y - b.y)
      .map(i => ({ name: norm(i.t), y: i.y, x: i.x, pref: nearPref(i.y, i.x) }));
    return { side: idx === 0 ? 'L' : 'R', x: c.x, players };
  });

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
          unresolved.push({ round, a: a.p.name, b: b.p.name });
          next.push({ ...a, y: (a.y + b.y)/2, unsure: true });
          continue;
        }
        pair.forEach(s => used.add(key(s)));
        const [up, dn] = pair.sort((s1,s2) => s1.y - s2.y);
        const upper = a.y < b.y ? a : b, lower = a.y < b.y ? b : a;
        const win = up.v > dn.v ? upper : lower;
        const lose = win === upper ? lower : upper;
        matches.push({ round, winner: win.p.name, loser: lose.p.name,
                       score: `${Math.max(up.v,dn.v)}-${Math.min(up.v,dn.v)}` });
        next.push({ ...win, y: (a.y + b.y)/2 });
      }
      alive = next;
      round++;
    }
    half.winner = alive[0] ? alive[0].p.name : null;
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

  const players = halves.flatMap(h => h.players.map(p => ({ name:p.name, pref:p.pref })));
  return { players, matches, unresolved,
           halves: halves.map(h => ({ side:h.side, n:h.players.length, winner:h.winner })) };
}

if (process.argv[1] && process.argv[1].endsWith('draw-parse.mjs')){
  const r = parseDraw(process.argv[2]);
  if (!r){ console.error('読み取れませんでした'); process.exit(1); }
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 1));
  else {
    console.log(`出場 ${r.players.length} 名／復元できた試合 ${r.matches.length}（理論値 ${r.players.length - r.halves.length}）`);
    console.log('半分ごと:', r.halves.map(h => `${h.side} ${h.n}名 勝者=${h.winner}`).join(' / '));
    const byRound = {};
    r.matches.forEach(m => (byRound[m.round] = byRound[m.round] || []).push(m));
    for (const k of Object.keys(byRound).sort((a,b)=>a-b)){
      console.log(`\n[${k}回戦] ${byRound[k].length}試合`);
      byRound[k].slice(0, 6).forEach(m => console.log(`  ${m.winner} ${m.score} ${m.loser}`));
      if (byRound[k].length > 6) console.log(`  …ほか${byRound[k].length-6}試合`);
    }
  }
}
