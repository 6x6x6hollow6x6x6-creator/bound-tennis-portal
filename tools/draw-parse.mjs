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
import { extract, extractPaths } from './draw-pdf.mjs';

/** 赤い線をたどって、各枠がどこまで勝ち上がったかを出す。
 *  ドロー表は勝者の線を赤で描くので、氏名欄から出ている赤線の連結成分が
 *  そのままその選手の勝ち上がりになる。スコアの位置から推測する必要がない。
 *  戻り値は枠番号 → 勝った試合数。 */
function redReach(path, halves){
  /* 決勝に近い段の縦線は何行分もまたぐので長い。短いものだけに絞ると
     そこで道が切れてしまう。除きたいのはページ枠だけなので、上限は大きく取る */
  const segs = extractPaths(path)
    .filter(s => s.color === '1,0,0' && Math.hypot(s.x2-s.x1, s.y2-s.y1) < 700);
  if (!segs.length) return null;

  /* 横線と縦線に分ける。横線＝勝者の線、縦線＝次の段へのつなぎ */
  const H = segs.filter(s => Math.abs(s.y1 - s.y2) < 1)
    .map(s => ({ y: s.y1, a: Math.min(s.x1,s.x2), b: Math.max(s.x1,s.x2) }));
  const V = segs.filter(s => Math.abs(s.x1 - s.x2) < 1 && Math.abs(s.y1 - s.y2) > 1)
    .map(s => ({ x: s.x1, a: Math.min(s.y1,s.y2), b: Math.max(s.y1,s.y2) }));

  const wins = new Map();
  for (const half of halves){
    const inward = half.side === 'L' ? 1 : -1;
    /* 内側の端／外側の端 */
    const inner = h => inward > 0 ? h.b : h.a;
    const outer = h => inward > 0 ? h.a : h.b;
    const close = (p,q) => Math.abs(p - q) < 4;

    /* 氏名欄から出ている赤線を起点に、縦線をたどって内側へ進む。
       縦線1本が1試合。線が途切れたところが、その選手が負けた段になる */
    /* 赤線は枠の氏名より少し上に引かれる。そのずれは大会や種目で変わる
       （第44回は3.5、第43回のダブルスは4.9）ので、起点を探すときだけ広めに取る。
       枠の間隔の3分の1までなら隣の行を拾う心配はない */
    const gap = half.players.length > 1
      ? Math.min(...half.players.slice(1).map((p,i) => Math.abs(p.y - half.players[i].y)))
      : 30;
    const tol = Math.max(4, Math.min(12, gap / 3));

    for (const p of half.players){
      let cur = H.filter(h => Math.abs(h.y - p.y) < tol)
        .sort((a,b) => inward * (outer(a) - outer(b)))[0];
      if (!cur){ wins.set(p.no, 0); continue; }   /* 赤線が無い＝1回戦で負けた */

      let n = 1, guard = 0;                        /* 赤線があること自体が1勝ぶん */
      while (guard++ < 20){
        const v = V.find(v => close(v.x, inner(cur)) && cur.y > v.a - 4 && cur.y < v.b + 4);
        if (!v) break;
        /* 縦線の反対側の端へ移り、そこから内側へ続く横線を探す */
        const to = Math.abs(v.a - cur.y) > Math.abs(v.b - cur.y) ? v.a : v.b;
        const next = H.find(h => close(h.y, to) && close(outer(h), v.x)
          && inward * (inner(h) - inner(cur)) > 1);
        if (!next) break;
        cur = next; n++;
      }
      wins.set(p.no, n);
    }
  }
  return wins;
}

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
  /** 都道府県の書き方を1つに揃える。「(福　井)」「北信越/福井」「北海道ﾌﾞﾛｯｸ」→「福井」「北海道」
   *  揃えないと同じ選手が別人として二重に登録される */
  const cleanPref = t => {
    let s = bare(t).replace(/^.*\//, '').replace(/[ｦ-ﾟ]+$/, '').replace(/ブロック$/, '');
    return PREFS.includes(s) ? s : (s.length <= 4 && s ? s : '');
  };
  const prefItems = items.filter(i => isPrefName(i.t) && cleanPref(i.t));
  const nearPref = (y, x) => {
    let best = null, bd = 1e9;
    for (const p of prefItems){
      const d = Math.abs(p.y - y);
      if (d < 6 && Math.abs(p.x - x) < 260 && d < bd){ bd = d; best = p; }
    }
    return best ? cleanPref(best.t) : '';
  };

  /* 左右の半分の境目。「欠」を探す範囲をここで区切らないと、
     左半分の「欠」を右半分の枠が拾ってしまう */
  const centerX = nameCols.length > 1
    ? (nameCols[0].x + nameCols[nameCols.length-1].x) / 2
    : nameCols[0].x + 300;

  /* 枠ごとに、その番号の y に近い氏名を集める。シングルスは1名、ダブルスは2名になる */
  const halves = numCols.map((nc, idx) => {
    /* 枠の行間。欠場の印を探す範囲をこれで決める */
    const ys = nc.items.map(i => i.y).sort((a,b) => a - b);
    const rowGap = ys.length > 1
      ? Math.min(...ys.slice(1).map((y,i) => y - ys[i])) : 30;
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
      /* 「欠場」の書かれ方は一定しない。縦書きで「欠」「場」に分かれることも、
         1語で置かれることもある。位置も枠の下だけでなく上のこともある。
         欠場した枠を残すと、試合をしていないのに勝ち上がってしまう。
         隣の枠まで巻き込まないよう、範囲は行間の半分までに抑える */
      const room = Math.max(6, Math.min(14, rowGap / 2 - 1));
      const withdrawn = items.some(i => /^欠(場)?$/.test(norm(i.t))
        && Math.abs(i.y - n.y) <= room
        && (idx === 0 ? (i.x > nameCol.x + 40 && i.x < centerX)
                      : (i.x < nameCol.x - 40 && i.x > centerX)));
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
    /* 1回戦だけは構造を推測せずに決められる。隣り合う枠どうしの対戦と決まっているので、
       2人のあいだにある「いちばん外側の列」のスコアがその試合の結果になる。
       2回戦以降は勝ち上がりの木が要るが、それは当たらなかったので使わない */
    const slots = half.players.filter(p => !p.withdrawn);
    for (let i = 0; i + 1 < slots.length; i += 2){
      const a = slots[i], b = slots[i+1];
      const between = mine.filter(s => s.y > Math.min(a.y,b.y) + 1 && s.y < Math.max(a.y,b.y) - 1)
        .sort((s1,s2) => inward * (s1.x - s2.x));
      let pair = null;
      for (let k = 0; k < between.length && !pair; k++)
        for (let m = k+1; m < between.length; m++)
          if (Math.abs(between[k].x - between[m].x) <= DX){ pair = [between[k], between[m]]; break; }
      if (!pair) continue;                       /* 不戦勝、または読み取れず */
      const [up, dn] = pair.sort((s1,s2) => s1.y - s2.y);
      const upper = a.y < b.y ? a : b, lower = a.y < b.y ? b : a;
      (up.v > dn.v ? upper : lower).wonFirst = true;
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
  /* 赤線をたどって勝ち数を出す。ドロー表は勝者の線を赤で描くので、
     スコアの位置から推測するより確実 */
  const wins = redReach(path, halves);

  const entries = halves.flatMap(h => h.players.map(p => ({
    no: p.no, y: p.y, names: p.names, prefs: p.prefs, withdrawn: p.withdrawn,
    wins: wins ? (wins.get(p.no) || 0) : null,
    wonFirst: !!p.wonFirst,
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
