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

export function parseDraw(path, opt = {}){
  const DX = opt.dx ?? 12;      /* 同じ試合とみなすスコアの横のずれ */
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
      /* 「欠場」は縦書きで1文字ずつ置かれることがあるので「欠」だけを見る。
         欠場した枠を残すと、試合をしていないのに勝ち上がってしまう */
      const withdrawn = items.some(i => /^欠$/.test(norm(i.t))
        && i.y > n.y && i.y - n.y < 16        /* 枠のすぐ下に置かれる */
        && (idx === 0 ? i.x > nameCol.x + 40 : i.x < nameCol.x - 40));
      return {
        no: Number(n.t), y: n.y, withdrawn,
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

  const matches = [], unresolved = [];

  for (const half of halves){
    if (!half.players.length) continue;
    const inward = half.side === 'L' ? 1 : -1;   /* 勝ち上がる向き */
    const lo = Math.min(...half.players.map(p => p.y)) - 30;
    const hi = Math.max(...half.players.map(p => p.y)) + 30;
    /* この半分に属するスコア。半分の縦の範囲にあり、氏名より内側にあるもの */
    const mine = scores.filter(s => s.y > lo && s.y < hi &&
      (half.side === 'L' ? s.x > half.x + 60 : s.x < half.x - 60));

    /* まず対戦を確定させる。スコアは実際に試合があった場所にしか描かれないので、
       同じ列（x が近い）で上下に並ぶ2つが1試合になる。
       枠の隣接から対戦を推測すると、不戦勝が散らばって配置されている実際の組み合わせと
       合わなくなるため、順序を逆にしている */
    const cand = [];
    for (let i = 0; i < mine.length; i++)
      for (let j = i+1; j < mine.length; j++){
        const dx = Math.abs(mine[i].x - mine[j].x), dy = Math.abs(mine[i].y - mine[j].y);
        if (dx <= DX && dy >= 4 && dy <= 500) cand.push({ a: mine[i], b: mine[j], dx, dy });
      }
    cand.sort((p, q) => p.dx - q.dx || p.dy - q.dy);
    const taken = new Set(), games = [];
    for (const c of cand){
      if (taken.has(c.a) || taken.has(c.b)) continue;
      taken.add(c.a); taken.add(c.b);
      const [up, dn] = [c.a, c.b].sort((s1,s2) => s1.y - s2.y);
      games.push({ up, dn, x: (c.a.x + c.b.x)/2, mid: (up.y + dn.y)/2 });
    }
    /* 内側に向かうほど後のラウンドになる */
    games.sort((p, q) => inward * (p.x - q.x) || p.mid - q.mid);

    /* 次に勝ち上がりを組む。各試合の相手は、スコアの上下それぞれに最も近い「まだ生きている枠」。
       不戦勝の枠は試合が無いのでそのまま生き残り、次に自分の試合が来たときに拾われる */
    let alive = half.players.filter(p => !p.withdrawn).map(p => ({ p, y: p.y, from: null }));
    for (const g of games){
      const above = alive.filter(e => e.y < g.up.y).sort((a,b) => b.y - a.y)[0];
      const below = alive.filter(e => e.y > g.dn.y).sort((a,b) => a.y - b.y)[0];
      if (!above || !below || above === below){ unresolved.push({ x:g.x, y:g.mid }); continue; }
      const win = g.up.v > g.dn.v ? above : below;
      const lose = win === above ? below : above;
      const m = { id: matches.length, winner: win.p, loser: lose.p, x: g.x,
                  feeds: [above.from, below.from],
                  score: `${Math.max(g.up.v,g.dn.v)}-${Math.min(g.up.v,g.dn.v)}` };
      matches.push(m);
      alive = alive.filter(e => e !== above && e !== below);
      alive.push({ p: win.p, y: g.mid, from: m.id });
      alive.sort((a,b) => a.y - b.y);
    }
    half.top = alive.length === 1 ? alive[0] : null;
    half.winner = half.top ? half.top.p.names : null;
    half.alive = alive.length;
    half.games = games.length;
  }

  /* 決勝は左右の勝者どうし。中央に残ったスコアで決める */
  let finalId = null;
  if (halves.length === 2 && halves[0].top && halves[1].top){
    const mid = (halves[0].x + halves[1].x) / 2;
    const rest = scores.filter(s => Math.abs(s.x - mid) < 160)
      .sort((a,b) => Math.abs(a.x - mid) - Math.abs(b.x - mid));
    let pair = null;
    for (let k = 0; k < rest.length && !pair; k++)
      for (let m = k+1; m < rest.length; m++)
        if (Math.abs(rest[k].x - rest[m].x) <= 9 && Math.abs(rest[k].y - rest[m].y) >= 4){
          pair = [rest[k], rest[m]]; break;
        }
    if (pair){
      const [up, dn] = pair.sort((a,b) => a.y - b.y);
      const win = up.v > dn.v ? halves[0].top : halves[1].top;
      const lose = win === halves[0].top ? halves[1].top : halves[0].top;
      finalId = matches.length;
      matches.push({ id: finalId, winner: win.p, loser: lose.p, x: (up.x + dn.x)/2,
                     feeds: [halves[0].top.from, halves[1].top.from],
                     score: `${Math.max(up.v,dn.v)}-${Math.min(up.v,dn.v)}` });
    } else unresolved.push({ final:true });
  }

  /* 順位を決める。木をたどると1か所でも試合が欠けたときに全部決まらなくなるので、
     試合が描かれた位置（中央にどれだけ近いか）でラウンドを判定する。
     ドロー表では後のラウンドほど中央に寄って描かれるため、欠けに強い */
  const PLACE = ['準優勝','ベスト4','ベスト8','ベスト16'];
  const place = new Map();
  const setPlace = (slot, p) => { if (!place.has(slot.no)) place.set(slot.no, p); };
  if (matches.length){
    const center = halves.length === 2 ? (halves[0].x + halves[1].x)/2 : halves[0].x;
    const ordered = matches.map(m => ({ m, d: Math.abs(m.x - center) }))
      .sort((a,b) => a.d - b.d).map(w => w.m);
    /* 単純消去法なら決勝1・準決勝2・準々決勝4・4回戦8 と決まっている。
       中央に近い順に、この数だけ取っていけばよい */
    const fin = finalId !== null ? matches[finalId] : ordered[0];
    if (fin) setPlace(fin.winner, '優勝');
    let i = 0;
    PLACE.forEach((label, k) => {
      for (let n = 0; n < (1 << k) && i < ordered.length; n++, i++)
        setPlace(ordered[i].loser, label);
    });
  }
  /* 残りは、1勝でもしていれば1回戦突破、していなければ出場 */
  const wonAny = new Set(matches.map(m => m.winner.no));
  const entries = halves.flatMap(h => h.players.map(p => ({
    no: p.no, names: p.names, prefs: p.prefs, withdrawn: p.withdrawn,
    place: p.withdrawn ? '欠場'
         : (place.get(p.no) || (wonAny.has(p.no) ? '1回戦突破' : '出場'))
  })));
  const players = entries.flatMap(e => e.names.map((n,i) =>
    ({ name:n, pref: e.prefs[i] || e.prefs[0] || '', place: e.place })));
  const out = matches.map(m => ({ winner: m.winner.names, loser: m.loser.names, score: m.score }));
  return { entries, players, matches: out, unresolved,
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
    const by = {};
    r.entries.forEach(e => (by[e.place] = by[e.place] || []).push(nm(e.names)));
    console.log('\n順位:');
    for (const p of ['優勝','準優勝','ベスト4','ベスト8','ベスト16','1回戦突破','出場'])
      if (by[p]) console.log(`  ${p.padEnd(6,'　')} ${by[p].length}枠  ${by[p].slice(0,4).join(' / ')}${by[p].length>4?' …':''}`);
  }
}
