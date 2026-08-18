/**
 * たたき台用のサンプル交流大会を作る
 *
 *   node tools/dummy.mjs <取り込みJSON> [出力先]
 *
 * 実データ（全日本選手権）だけだと大会が2つしかなく、
 * 地方の交流大会が並んだときの見え方が分からない。
 *
 * **作るのは交流大会（G4・G5）だけ。配点が0なのでランキングには影響しない。**
 * 公式戦のサンプルは作らない。架空の成績で順位が動くと、
 * 見せられた側が本物の順位と取り違える恐れがあるため。
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

/* サンプルの要項・申込書。GitHub Pages に置いてある同じリポジトリの静的ファイル */
const SITE = 'https://6x6x6hollow6x6x6-creator.github.io/bound-tennis-portal';
const DOC = `${SITE}/sample/%E8%A6%81%E9%A0%85.html`;
const ENTRY = `${SITE}/sample/%E7%94%B3%E8%BE%BC%E6%9B%B8.html`;

/* 交流大会だけを作る。**G4・G5は配点が0なのでランキングには一切影響しない。**
   全国の大会の9割はこの手の交流大会で、ポータルとしての本体はここ。
   団体戦やBTラリー戦を含む、実際にありそうな構成にしてある */
const PLAN = [
  { id:'TDUMMY1', name:'ふれあいバウンドテニス交流大会', grade:'G4', pref:'石川',
    venue:'野々市市民体育館', date:'2026-06-21', host:'野々市バウンドテニス協会',
    cats:['フリー','ミドル','シニア'], evs:['ダブルス','団体戦'], draw:18 },
  { id:'TDUMMY2', name:'市民スポーツフェスティバル バウンドテニスの部', grade:'G4', pref:'長野',
    venue:'長野市真島総合スポーツアリーナ', date:'2026-06-07', host:'長野市体育協会',
    cats:['フリー','シニア'], evs:['ダブルス','団体戦'], draw:24 },
  { id:'TDUMMY3', name:'月例オープン 多摩サーキット 第8戦', grade:'G5', pref:'東京',
    venue:'駒沢オリンピック公園総合運動場', date:'2026-05-24', host:'多摩バウンドテニス協会',
    cats:['フリー'], evs:['シングルス','ダブルス'], draw:16 },
  { id:'TDUMMY4', name:'かながわ親睦バウンドテニス大会', grade:'G5', pref:'神奈川',
    venue:'横浜市スポーツ医科学センター', date:'2026-05-10', host:'横浜バウンドテニスクラブ',
    cats:['フリー','ミドル'], evs:['ダブルス','団体戦','BTラリー戦'], draw:12 },
  { id:'TDUMMY5', name:'北信越シニアフレンドリー大会', grade:'G4', pref:'富山',
    venue:'富山市総合体育館', date:'2026-04-26', host:'富山県バウンドテニス協会 北部支部',
    cats:['シニア'], evs:['ダブルス','団体戦'], draw:14 },

  /* ここから先は開催前の大会。日付は「今日」からの相対で決めるので、
     いつ実行しても「受付中」「締切間近」「受付前」が1つずつ並ぶ。
     結果はまだ無いので入れない */
  { id:'TDUMMY6', name:'第9回 ふれあいバウンドテニス交流大会', grade:'G4', pref:'石川',
    venue:'野々市市民体育館', inDays:60, deadlineInDays:39, host:'野々市バウンドテニス協会',
    cats:['フリー','ミドル','シニア'], evs:['ダブルス','団体戦'], draw:18,
    fee:'2,000円', doc:true, entry:true },
  { id:'TDUMMY7', name:'秋季オープン 多摩サーキット 第11戦', grade:'G5', pref:'東京',
    venue:'駒沢オリンピック公園総合運動場 屋内球技場', inDays:24, deadlineInDays:5,
    host:'多摩バウンドテニス協会',
    cats:['フリー'], evs:['シングルス','ダブルス'], draw:16, fee:'1,500円', doc:true, entry:true },
  { id:'TDUMMY8', name:'第22回 かながわ親睦バウンドテニス大会', grade:'G5', pref:'神奈川',
    venue:'横浜市スポーツ医科学センター', inDays:110, deadlineInDays:82,
    host:'横浜バウンドテニスクラブ',
    cats:['フリー','ミドル'], evs:['ダブルス','団体戦','BTラリー戦'], draw:12,
    fee:'1,500円', doc:true },
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

  /* 生年不明の選手は「出場したカテゴリ」から年齢の下限が推定される。
     実際に出たことのないカテゴリにサンプルで出すと、その推定が変わり、
     **実データのカテゴリ跨ぎが動いてランキングが変わってしまう。**
     だから、その選手が実データで出ているカテゴリにしか割り当てない */
  const LEVEL = { 'フリー':0, 'ミドル':1, 'シニア':2 };
  const topCat = new Map();
  for (const r of data.results){
    const lv = LEVEL[r.cat] ?? 0;
    if (lv > (topCat.get(r.pid) ?? -1)) topCat.set(r.pid, lv);
  }
  const canPlay = (p, cat) => (topCat.get(p.id) ?? 0) >= (LEVEL[cat] ?? 0);

  /* 開催前の大会は「今日」からの相対で日付を決める。
     いつ実行しても受付中・締切間近・受付前が並ぶようにするため */
  const today = new Date();
  const shift = n => { const d = new Date(today); d.setDate(d.getDate() + n);
    return d.toISOString().slice(0,10); };

  for (const plan of PLAN){
    const date = plan.date || shift(plan.inDays);
    const t = { id: plan.id, name: `【サンプル】${plan.name}`,
                grade: plan.grade, pref: plan.pref, venue: plan.venue,
                date, deadline: plan.deadlineInDays != null ? shift(plan.deadlineInDays) : date,
                cats: plan.cats, evs: plan.evs, draw: plan.draw,
                fee: plan.fee || '2,500円',
                host: `${plan.host}（架空の大会です）`,
                entryUrl: plan.entry ? ENTRY : '',
                docUrl: plan.doc ? DOC : '',
                published: true };
    tournaments.push(t);
    if (plan.inDays != null) continue;      /* これから開催する大会に結果は無い */

    const all = pool(plan);
    if (!all.length) continue;
    let seed = plan.id.length;                    /* 実行ごとに変わらないよう固定 */
    const pick = (cand, n) => {
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
          const cand = all.filter(p => p.sex === (sex === '女子' ? '女' : '男') && canPlay(p, cat));
          if (cand.length < 4) continue;
          const n = Math.min(PLACES.length, Math.max(4, Math.floor(plan.draw / 2)));
          const chosen = pick(cand, n);
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
