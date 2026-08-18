/**
 * たたき台用のダミー大会を作る
 *
 *   node tools/dummy.mjs <取り込みJSON> [出力先]
 *
 * 実データ（全日本選手権）だけだと大会が2つしかなく、
 * 都道府県大会やブロック大会が入ったときの見え方が分からない。
 * 協会に見せるときに動きが伝わるよう、架空の大会を足す。
 *
 * **架空と分かるようにする。** 大会名の頭に「【サンプル】」を付け、
 * 主催も「（架空の大会です）」とする。ダミーだけを消したいときは
 * 大会IDが `TDUMMY` で始まるものを外せばよい。
 *
 * 選手は実データから借りる（架空の人名を作ると本物と紛れるため）。
 * 成績はその選手のBTPと関係なく機械的に割り振る。
 */
import fs from 'fs';

const PLACES = ['優勝','準優勝','ベスト4','ベスト4','ベスト8','ベスト8','ベスト8','ベスト8',
                'ベスト16','ベスト16','ベスト16','ベスト16','1回戦突破','1回戦突破','出場','出場'];

/* 大会の型。実在の大会構成に寄せてある */
const PLAN = [
  { id:'TDUMMY1', name:'関東ブロックバウンドテニス大会', grade:'G2', pref:'埼玉',
    venue:'さいたま市記念総合体育館', date:'2026-06-14', host:'関東バウンドテニス連盟',
    cats:['フリー','ミドル','シニア'], evs:['シングルス','ダブルス'], draw:32 },
  { id:'TDUMMY2', name:'北信越ブロックバウンドテニス大会', grade:'G2', pref:'長野',
    venue:'長野市真島総合スポーツアリーナ', date:'2026-06-07', host:'北信越バウンドテニス連盟',
    cats:['フリー','ミドル','シニア'], evs:['シングルス','ダブルス'], draw:24 },
  { id:'TDUMMY3', name:'石川県バウンドテニス選手権', grade:'G3', pref:'石川',
    venue:'金沢市総合体育館', date:'2026-05-17', host:'石川県バウンドテニス協会',
    cats:['フリー','ミドル','シニア'], evs:['シングルス','ダブルス'], draw:20 },
  { id:'TDUMMY4', name:'神奈川県バウンドテニス選手権', grade:'G3', pref:'神奈川',
    venue:'横浜文化体育館', date:'2026-05-10', host:'神奈川県バウンドテニス協会',
    cats:['フリー','ミドル','シニア'], evs:['シングルス','ダブルス'], draw:36 },
  { id:'TDUMMY5', name:'月例オープン 多摩サーキット 第8戦', grade:'G5', pref:'東京',
    venue:'駒沢オリンピック公園総合運動場', date:'2026-04-19', host:'多摩バウンドテニス協会',
    cats:['フリー'], evs:['シングルス','ダブルス','団体戦'], draw:16 },
];

export function addDummies(data){
  const tournaments = [...data.tournaments];
  const results = [...data.results];
  let rid = results.reduce((m,r) => Math.max(m, Number(String(r.id).replace(/\D/g,''))||0), 0);

  /* 都道府県ごとの選手。ブロック大会はその地域の選手を出す */
  const byPref = new Map();
  for (const p of data.players){
    if (!p.pref) continue;
    if (!byPref.has(p.pref)) byPref.set(p.pref, []);
    byPref.get(p.pref).push(p);
  }
  const REGION = {
    '関東': ['東京','神奈川','埼玉','千葉','茨城','栃木','群馬','山梨'],
    '北信越': ['新潟','富山','石川','福井','長野'],
  };
  const pool = (t) => {
    for (const [k, ps] of Object.entries(REGION))
      if (t.name.includes(k)) return ps.flatMap(p => byPref.get(p) || []);
    return byPref.get(t.pref) || [];
  };

  for (const plan of PLAN){
    const t = { ...plan, name: `【サンプル】${plan.name}`,
                deadline: plan.date, fee: '2,500円',
                host: `${plan.host}（架空の大会です）`,
                entryUrl: '', docUrl: '', published: true };
    delete t.id; t.id = plan.id;
    tournaments.push(t);

    const cand = pool(plan);
    if (!cand.length) continue;
    let seed = plan.id.length;                    /* 実行ごとに変わらないよう固定 */
    const pick = n => {
      const out = [], used = new Set();
      for (let i = 0; i < n && used.size < cand.length; i++){
        seed = (seed * 1103515245 + 12345) % 2147483648;
        let k = seed % cand.length;
        while (used.has(k)) k = (k + 1) % cand.length;
        used.add(k); out.push(cand[k]);
      }
      return out;
    };
    for (const ev of plan.evs){
      for (const cat of plan.cats){
        for (const sex of (ev === '団体戦' ? ['男子'] : ['男子','女子'])){
          const men = cand.filter(p => p.sex === (sex === '女子' ? '女' : '男'));
          if (men.length < 4) continue;
          const n = Math.min(PLACES.length, Math.max(4, Math.floor(plan.draw / 2)));
          const chosen = pick(n).filter(p => p.sex === (sex === '女子' ? '女' : '男'));
          chosen.forEach((p, i) => {
            rid++;
            results.push({ id: 'R' + String(rid).padStart(5,'0'), tid: plan.id,
                           ev, cat, sex, draw: plan.draw, place: PLACES[i] || '出場',
                           pid: p.id, status: '承認済', submitted: plan.date, note: '' });
          });
        }
      }
    }
  }
  return { ...data, tournaments, results };
}

if (process.argv[1] && process.argv[1].endsWith('dummy.mjs')){
  const src = process.argv[2] || 'btp-import.json';
  const out = process.argv[3] || src;
  const data = JSON.parse(fs.readFileSync(src, 'utf8'));
  const r = addDummies(data);
  fs.writeFileSync(out, JSON.stringify(r));
  const dummies = r.tournaments.filter(t => String(t.id).startsWith('TDUMMY'));
  console.log(`ダミー大会 ${dummies.length} 件を追加しました`);
  dummies.forEach(t => {
    const n = r.results.filter(x => x.tid === t.id).length;
    console.log(`  ${t.date} ${t.grade} ${t.name}　結果${n}件`);
  });
  console.log(`\n大会 ${r.tournaments.length} / 結果 ${r.results.length}`);
}
