/**
 * ドロー表PDFから文字を座標つきで取り出す
 *
 *   node tools/draw-pdf.mjs <PDFのパス>          … 座標つきで一覧表示
 *   node tools/draw-pdf.mjs <PDFのパス> --json   … JSONで出力
 *
 * 日本バウンドテニス協会のサイトに載っている全日本選手権のドロー表は、
 * スキャン画像ではなくテキストPDFで、ToUnicode も入っている。
 * 選手名・所属都道府県・シード番号・試合スコア・コート番号・欠場が
 * すべて機械的に取り出せる。
 *   例) https://boundtennis.or.jp/competition/championship/43/
 *
 * ここでやるのは「文字と座標の取り出し」まで。
 * 誰が誰に勝ったかを組み立てるには、座標から対戦表の構造を復元する必要がある。
 * スコアはラウンドごとに列（x座標）が揃い、対戦相手どうしは上下（y座標）に並ぶので、
 * そこから組める。左半分は右向き、右半分は左向きに勝ち上がる点に注意。
 *
 * 外部ライブラリは使わない（この案件はビルド工程なしを維持する）。
 */
import fs from 'fs';
import zlib from 'zlib';

/** PDF内のストリームをすべて展開する */
function streamsOf(raw){
  const out = [];
  const re = /stream\r?\n/g; let m;
  while ((m = re.exec(raw))){
    const s = m.index + m[0].length, e = raw.indexOf('endstream', s);
    if (e < 0) continue;
    const seg = raw.slice(s, e);
    try { out.push(zlib.inflateSync(Buffer.from(seg, 'latin1')).toString('latin1')); }
    catch { out.push(seg); }   /* 非圧縮のストリームもある */
  }
  return out;
}

/** ToUnicode CMap を読んで CID → 文字 の対応表を作る */
function buildCmap(streams){
  const cmap = new Map();
  for (const st of streams){
    if (!/beginbfchar|beginbfrange/.test(st)) continue;
    for (const blk of st.match(/beginbfchar([\s\S]*?)endbfchar/g) || [])
      for (const p of blk.match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g) || []){
        const [, a, b] = p.match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/);
        cmap.set(parseInt(a,16),
          String.fromCharCode(...(b.match(/.{4}/g) || []).map(h => parseInt(h,16))));
      }
    for (const blk of st.match(/beginbfrange([\s\S]*?)endbfrange/g) || [])
      for (const p of blk.match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g) || []){
        const [, a, b, c] = p.match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/);
        const lo = parseInt(a,16), hi = parseInt(b,16), base = parseInt(c,16);
        for (let i = lo; i <= hi; i++) cmap.set(i, String.fromCharCode(base + (i - lo)));
      }
  }
  return cmap;
}

/** PDFのリテラル文字列。エスケープと入れ子の括弧を処理する */
function readLiteral(s, i){
  let depth = 1, out = '';
  while (i < s.length && depth > 0){
    const ch = s[i];
    if (ch === '\\'){
      const oct = s.slice(i+1, i+4).match(/^[0-7]{1,3}/);
      if (oct){ out += String.fromCharCode(parseInt(oct[0], 8)); i += 1 + oct[0].length; continue; }
      const n = s[i+1];
      out += ({ n:'\n', r:'\r', t:'\t', b:'\b', f:'\f' })[n] ?? n;
      i += 2;
    }
    else if (ch === '('){ depth++; out += ch; i++; }
    else if (ch === ')'){ depth--; if (depth) out += ch; i++; }
    else { out += ch; i++; }
  }
  return out;
}

export function extract(path){
  const raw = fs.readFileSync(path).toString('latin1');
  const streams = streamsOf(raw);
  const cmap = buildCmap(streams);
  const toText = bytes => {
    let s = '';
    for (let i = 0; i + 1 < bytes.length; i += 2)
      s += cmap.get((bytes.charCodeAt(i) << 8) | bytes.charCodeAt(i+1)) ?? '';
    return s;
  };

  const content = streams.find(s => /\bT[Jj]\b/.test(s)) || '';
  const lines = content.split(/\r?\n/);
  const items = [];
  let x = 0, y = 0, pend = null;
  for (let i = 0; i < lines.length; i++){
    const ln = lines[i].trim();
    /* この生成器は行列の各数値を別行に出すので、Tm から6つさかのぼる */
    if (ln === 'Tm'){
      const nums = [];
      for (let j = i-1; j >= 0 && nums.length < 6; j--){
        const v = lines[j].trim();
        if (/^-?[\d.]+$/.test(v)) nums.unshift(parseFloat(v)); else break;
      }
      if (nums.length === 6){ x = nums[4]; y = nums[5]; }
    }
    if (ln.startsWith('(')) pend = toText(readLiteral(lines.slice(i).join('\n'), 1));
    if (ln === 'Tj' && pend !== null){
      const t = pend.trim();
      if (t) items.push({ x: Math.round(x*10)/10, y: Math.round(y*10)/10, t });
      pend = null;
    }
  }
  return items;
}

/* --- 単体で実行されたとき --- */
if (process.argv[1] && process.argv[1].endsWith('draw-pdf.mjs')){
  const path = process.argv[2];
  if (!path){ console.error('使い方: node tools/draw-pdf.mjs <PDFのパス> [--json]'); process.exit(1); }
  const items = extract(path);
  if (process.argv.includes('--json')){
    console.log(JSON.stringify(items, null, 1));
  } else {
    console.log(`${items.length} 個の文字列を取り出しました\n`);
    items.sort((a,b) => a.y - b.y || a.x - b.x);
    let last = null, buf = [];
    const flush = () => { if (buf.length)
      console.log(`y=${String(Math.round(last)).padStart(4)}  ` +
        buf.map(i => `${i.t}[x=${Math.round(i.x)}]`).join('  ')); buf = []; };
    for (const it of items){
      if (last === null || Math.abs(it.y - last) > 4){ flush(); last = it.y; }
      buf.push(it);
    }
    flush();
  }
}
