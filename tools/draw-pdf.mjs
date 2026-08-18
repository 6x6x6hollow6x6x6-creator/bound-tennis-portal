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
/** リテラル文字列の終わり（閉じ括弧の次）の位置 */
function skipLiteral(s, i){
  let depth = 1;
  while (i < s.length && depth > 0){
    if (s[i] === '\\'){ i += 2; continue; }
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    i++;
  }
  return i;
}
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
  /* 2バイトのCIDが基本だが、1バイトで引くフォントもあるので取れたほうを使う */
  const two = bytes => { let s = '';
    for (let i = 0; i + 1 < bytes.length; i += 2)
      s += cmap.get((bytes.charCodeAt(i) << 8) | bytes.charCodeAt(i+1)) ?? '';
    return s; };
  const one = bytes => { let s = '';
    for (let i = 0; i < bytes.length; i++) s += cmap.get(bytes.charCodeAt(i)) ?? '';
    return s; };
  const toText = bytes => { const a = two(bytes), b = one(bytes);
    return a.length >= b.length ? a : b; };
  const toTextHex = hex => {
    const pairs = (hex.match(/.{1,4}/g) || []);
    let s = '';
    for (const h of pairs) s += cmap.get(parseInt(h.padEnd(4,'0'), 16)) ?? '';
    if (s.trim()) return s;
    let b = '';
    for (const h of (hex.match(/.{1,2}/g) || [])) b += cmap.get(parseInt(h, 16)) ?? '';
    return b;
  };

  /* 本文のストリームを選ぶ。展開できなかったバイナリにも "Tj" の並びが偶然含まれるので、
     印字可能な文字の割合と、BT/ET の対応で見分ける。
     本文が複数に分かれている場合もあるので、条件に合うものを連結する */
  const isContent = s => {
    if (s.length < 40) return false;
    const head = s.slice(0, 4000);
    const printable = (head.match(/[\x20-\x7e\n\r\t]/g) || []).length / head.length;
    if (printable < 0.85) return false;
    const bt = (s.match(/\bBT\b/g) || []).length, et = (s.match(/\bET\b/g) || []).length;
    return bt > 0 && Math.abs(bt - et) <= 1 && /\bT[jJ]\b/.test(s);
  };
  const content = streams.filter(isContent).join('\n');

  /* 内容ストリームをトークンに分けて読む。
     生成元によって「数値を1行ずつ出す」ものと「1行にまとめる」ものがあるので、
     行ではなくトークン単位で見る。年をまたぐと生成元が変わるため一般化しておく */
  const items = [];
  const st = [];                    /* オペランドのスタック */
  let tm = [1,0,0,1,0,0], tlm = tm, leading = 0;
  const put = txt => {
    const t = String(txt).trim();
    if (t) items.push({ x: Math.round(tm[4]*10)/10, y: Math.round(tm[5]*10)/10, t });
  };
  const translate = (m, tx, ty) => [m[0], m[1], m[2], m[3], m[4] + tx*m[0] + ty*m[2], m[5] + tx*m[1] + ty*m[3]];

  for (let i = 0; i < content.length; ){
    const c = content[i];
    if (c === ' ' || c === '\n' || c === '\r' || c === '\t'){ i++; continue; }
    if (c === '%'){ while (i < content.length && content[i] !== '\n') i++; continue; }
    if (c === '('){ const s = readLiteral(content, i+1); st.push({ str: s });
      i = skipLiteral(content, i+1); continue; }
    if (c === '<' && content[i+1] !== '<'){
      const e = content.indexOf('>', i);
      st.push({ hex: content.slice(i+1, e).replace(/\s/g, '') }); i = e + 1; continue;
    }
    if (c === '[' || c === ']'){ st.push({ arr: c }); i++; continue; }
    if (c === '<' || c === '/'){                    /* 辞書や名前は読み飛ばす */
      if (c === '/'){ let j = i+1; while (j < content.length && !/[\s\/\[\]<>()]/.test(content[j])) j++;
        st.push({ name: content.slice(i+1, j) }); i = j; continue; }
      i += 2; continue;
    }
    let j = i;
    while (j < content.length && !/[\s\/\[\]<>()%]/.test(content[j])) j++;
    const tok = content.slice(i, j);
    i = j > i ? j : i + 1;      /* 区切り文字そのもの（>> など）で止まらないように必ず進める */
    if (!tok) continue;
    if (/^-?[\d.]+$/.test(tok)){ st.push({ num: parseFloat(tok) }); continue; }

    const nums = st.filter(s => 'num' in s).map(s => s.num);
    switch (tok){
      case 'BT': tm = tlm = [1,0,0,1,0,0]; break;
      case 'Tm': if (nums.length >= 6) tm = tlm = nums.slice(-6); break;
      case 'Td': if (nums.length >= 2) tm = tlm = translate(tlm, nums.at(-2), nums.at(-1)); break;
      case 'TD': if (nums.length >= 2){ leading = -nums.at(-1); tm = tlm = translate(tlm, nums.at(-2), nums.at(-1)); } break;
      case 'TL': if (nums.length) leading = nums.at(-1); break;
      case 'T*': tm = tlm = translate(tlm, 0, -leading); break;
      case 'Tj': case '\'': case '"': {
        const s = st.filter(v => 'str' in v || 'hex' in v).at(-1);
        if (s) put('str' in s ? toText(s.str) : toTextHex(s.hex));
        break;
      }
      case 'TJ': {
        let s = '';
        for (const v of st){ if ('str' in v) s += toText(v.str); else if ('hex' in v) s += toTextHex(v.hex); }
        put(s);
        break;
      }
    }
    st.length = 0;
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
