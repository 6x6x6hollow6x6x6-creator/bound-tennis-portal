/**
 * =====================================================================
 *  大会情報ポータル — スプレッドシートAPI
 *  このファイルをスプレッドシートの「拡張機能 > Apps Script」に貼り付けます。
 *
 *  やること（詳しくは セットアップ手順.md）
 *    1. 下の GOOGLE_CLIENT_ID と ALLOWED_EMAILS を書き換える
 *    2. setup() を1回だけ実行する
 *    3. デプロイ > 新しいデプロイ > ウェブアプリ で公開する
 * =====================================================================
 */

/* ↓↓↓ ここだけ書き換えてください ↓↓↓ ------------------------------- */

/** Google Cloud Console で作った OAuth クライアントID（index.html と同じ値） */
var GOOGLE_CLIENT_ID = 'ここにクライアントIDを貼る.apps.googleusercontent.com';

/** 書き込みを許可するGoogleアカウント。ここに無いアカウントは保存できません */
var ALLOWED_EMAILS = [
  '6x6x6hollow6x6x6@gmail.com'
];

/* ↑↑↑ ここまで ↑↑↑ -------------------------------------------------- */


/* =====================================================================
   シートと列の定義
   ここに1行足せば、新しい種類のデータを扱えるようになります
   type: text / num / bool / date / csv（カンマ区切りを配列にする）
   ===================================================================== */
var SCHEMA = {
  tournaments: {
    sheet: '大会',
    cols: [
      { key:'id',        head:'大会ID',   type:'text' },
      { key:'name',      head:'大会名',   type:'text' },
      { key:'grade',     head:'グレード', type:'text' },
      { key:'pref',      head:'都道府県', type:'text' },
      { key:'venue',     head:'会場',     type:'text' },
      { key:'date',      head:'開催日',   type:'date' },
      { key:'deadline',  head:'申込締切', type:'date' },
      { key:'cats',      head:'カテゴリ', type:'csv'  },
      { key:'evs',       head:'種目',     type:'csv'  },
      { key:'draw',      head:'ドロー数', type:'num'  },
      { key:'fee',       head:'参加費',   type:'text' },
      { key:'host',      head:'主催',     type:'text' },
      { key:'entryUrl',  head:'申込URL',  type:'text' },
      { key:'docUrl',    head:'要項URL',  type:'text' },
      { key:'published', head:'公開',     type:'bool' }
    ]
  },
  players: {
    sheet: '選手',
    cols: [
      { key:'id',     head:'選手ID', type:'text' },
      { key:'name',   head:'氏名',   type:'text' },
      { key:'kana',   head:'かな',   type:'text' },
      { key:'pref',   head:'所属',   type:'text' },
      { key:'sex',    head:'性別',   type:'text' },
      { key:'birth',  head:'生年',   type:'num'  },
      { key:'regno',  head:'登録番号', type:'text' },
      { key:'active', head:'現役',   type:'bool' }
    ]
  },
  results: {
    sheet: '結果',
    cols: [
      { key:'id',        head:'結果ID',   type:'text' },
      { key:'tid',       head:'大会ID',   type:'text' },
      { key:'ev',        head:'種目',     type:'text' },
      { key:'cat',       head:'カテゴリ', type:'text' },
      { key:'sex',       head:'性別',     type:'text' },
      { key:'draw',      head:'ドロー数', type:'num'  },
      { key:'place',     head:'成績',     type:'text' },
      { key:'pid',       head:'選手ID',   type:'text' },
      { key:'status',    head:'状態',     type:'text' },
      { key:'submitted', head:'提出日',   type:'date' },
      { key:'note',      head:'メモ',     type:'text' }
    ]
  },
  news: {
    sheet: 'お知らせ',
    cols: [
      { key:'id',        head:'お知らせID', type:'text' },
      { key:'date',      head:'日付',      type:'date' },
      { key:'category',  head:'分類',      type:'text' },
      { key:'title',     head:'タイトル',  type:'text' },
      { key:'body',      head:'本文',      type:'text' },
      { key:'url',       head:'添付URL',   type:'text' },
      { key:'pinned',    head:'固定',      type:'bool' },
      { key:'published', head:'公開',      type:'bool' }
    ]
  }
};

var CONTENT_SHEET = '設定';
var CONTENT_HEAD  = ['キー', '内容(JSON)'];


/* =====================================================================
   初回セットアップ — Apps Script のエディタで1回だけ実行してください
   ===================================================================== */
function setup(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SCHEMA).forEach(function(type){
    var def = SCHEMA[type];
    var sh = ss.getSheetByName(def.sheet) || ss.insertSheet(def.sheet);
    var heads = def.cols.map(function(c){ return c.head; });
    sh.getRange(1, 1, 1, heads.length).setValues([heads]);
    sh.getRange(1, 1, 1, heads.length)
      .setFontWeight('bold').setBackground('#001F33').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  });

  var cs = ss.getSheetByName(CONTENT_SHEET) || ss.insertSheet(CONTENT_SHEET);
  cs.getRange(1, 1, 1, 2).setValues([CONTENT_HEAD]);
  cs.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#001F33').setFontColor('#FFFFFF');
  cs.setFrozenRows(1);
  cs.setColumnWidth(1, 140);
  cs.setColumnWidth(2, 800);

  var first = ss.getSheetByName('シート1') || ss.getSheetByName('Sheet1');
  if (first && ss.getSheets().length > 1) ss.deleteSheet(first);

  /* getUi().alert() は使わないこと。ダイアログはスプレッドシート側のタブに出るため、
     エディタから ▶ 実行 したときは誰もOKを押せず、6分の上限まで待ち続けて
     「Exceeded maximum execution time」で落ちる。ログなら実行環境を選ばない */
  var names = Object.keys(SCHEMA).map(function(t){ return SCHEMA[t].sheet; }).join('・') + '・' + CONTENT_SHEET;
  Logger.log('セットアップが完了しました。シート：' + names);
  return 'セットアップが完了しました。シート：' + names;
}


/* =====================================================================
   GET — 誰でも読めます（サイトの表示に使うため）
   例）  ?type=tournaments      ?type=results&since=2025-08-01
   ===================================================================== */
function doGet(e){
  try {
    var type = (e && e.parameter && e.parameter.type) || '';
    if (type === 'content') return json_({ ok:true, items: readContent_() });
    if (!SCHEMA[type])      return json_({ ok:false, error:'unknown-type' });

    var items = readSheet_(type);

    /* 結果が増えても重くならないよう、期間で絞れるようにしておく */
    var since = e.parameter.since;
    if (since && type === 'results'){
      var ids = {};
      readSheet_('tournaments').forEach(function(t){ if (t.date >= since) ids[t.id] = true; });
      items = items.filter(function(r){ return ids[r.tid]; });
    }
    return json_({ ok:true, items: items });
  } catch (err){
    return json_({ ok:false, error: String(err) });
  }
}


/* =====================================================================
   POST — 書き込み。許可されたGoogleアカウントだけ
   受け取る形： { idToken, type, items:[...] }
                { idToken, type:'content', key:'settings', content:{...} }
   ※ index.html からは Content-Type: text/plain で送られてきます
   ===================================================================== */
function doPost(e){
  try {
    var body = JSON.parse(e.postData.contents);
    var user = verifyIdToken_(body.idToken);
    if (!user) return json_({ ok:false, error:'unauthorized' });

    if (body.type === 'content'){
      writeContent_(body.key || 'settings', body.content);
      log_(user, 'content:' + (body.key || 'settings'), 1);
      return json_({ ok:true, saved:'content', key: body.key || 'settings' });
    }
    if (!SCHEMA[body.type]) return json_({ ok:false, error:'unknown-type' });

    var items = body.items || [];
    writeSheet_(body.type, items);
    log_(user, body.type, items.length);
    return json_({ ok:true, saved: body.type, count: items.length });
  } catch (err){
    return json_({ ok:false, error: String(err) });
  }
}


/* =====================================================================
   認証 — idToken を Google に問い合わせて検証する
   ===================================================================== */
function verifyIdToken_(idToken){
  if (!idToken) return null;
  try {
    var res = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
      { muteHttpExceptions:true });
    if (res.getResponseCode() !== 200) return null;
    var p = JSON.parse(res.getContentText());

    if (p.aud !== GOOGLE_CLIENT_ID) return null;                 /* 別サイトのトークンを弾く */
    if (String(p.email_verified) !== 'true') return null;
    var email = String(p.email || '').toLowerCase();
    var allowed = ALLOWED_EMAILS.map(function(x){ return String(x).toLowerCase().trim(); });
    if (allowed.indexOf(email) === -1) return null;
    return { email: email, name: p.name || '' };
  } catch (err){
    return null;
  }
}


/* =====================================================================
   シートの読み書き
   ===================================================================== */
function sheetOf_(name){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error('シートがありません：' + name + '（setup() を実行してください）');
  return sh;
}

/** Apps Script(V8) では instanceof Date が効かないことがあるのでこの判定を使う */
function isDate_(v){
  return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime());
}
function toYMD_(v){
  if (isDate_(v)) return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd');
  var s = String(v == null ? '' : v).trim();
  if (!s) return '';
  var m = s.match(/(\d{4})[-\/.年]\s*(\d{1,2})[-\/.月]\s*(\d{1,2})/);
  if (m) return m[1] + '-' + ('0'+m[2]).slice(-2) + '-' + ('0'+m[3]).slice(-2);
  return s;
}
function toBool_(v){
  if (typeof v === 'boolean') return v;
  var s = String(v == null ? '' : v).trim().toLowerCase();
  if (s === '') return true;                       /* 空欄は「公開」扱い */
  return ['true','1','はい','公開','yes','y','○','o'].indexOf(s) !== -1;
}

function cellToValue_(raw, type){
  if (type === 'date') return toYMD_(raw);
  if (type === 'bool') return toBool_(raw);
  if (type === 'num')  { var n = Number(raw); return isNaN(n) ? 0 : n; }
  if (type === 'csv')  return String(raw == null ? '' : raw)
      .split(/[,、]/).map(function(s){ return s.trim(); }).filter(function(s){ return s; });
  return String(raw == null ? '' : raw);
}
function valueToCell_(v, type){
  if (type === 'csv')  return (Array.isArray(v) ? v : String(v == null ? '' : v).split(/[,、]/)).join(',');
  if (type === 'bool') return v === false ? 'FALSE' : 'TRUE';
  if (type === 'date') return toYMD_(v);
  if (type === 'num')  return Number(v) || 0;
  return v == null ? '' : String(v);
}

function readSheet_(type){
  var def = SCHEMA[type];
  var sh = sheetOf_(def.sheet);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, def.cols.length).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++){
    var row = values[i];
    var blank = row.every(function(c){ return String(c == null ? '' : c).trim() === ''; });
    if (blank) continue;
    var o = {};
    for (var j = 0; j < def.cols.length; j++) o[def.cols[j].key] = cellToValue_(row[j], def.cols[j].type);
    if (!o.id) continue;
    out.push(o);
  }
  return out;
}

/** 差分更新はせず、いったん消して全部書き直す（単純で事故が少ない） */
function writeSheet_(type, items){
  var def = SCHEMA[type];
  var sh = sheetOf_(def.sheet);
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, sh.getLastColumn()).clearContent();
  if (!items.length) return;

  var rows = items.map(function(it){
    return def.cols.map(function(c){ return valueToCell_(it[c.key], c.type); });
  });
  sh.getRange(2, 1, rows.length, def.cols.length).setValues(rows);
  /* 日付列を文字列として扱わせる（勝手に日付書式に化けるのを防ぐ） */
  def.cols.forEach(function(c, idx){
    if (c.type === 'date') sh.getRange(2, idx + 1, rows.length, 1).setNumberFormat('@');
  });
}

/* ---------- 設定（JSONを1セルに入れる） ---------- */
function readContent_(){
  var sh = sheetOf_(CONTENT_SHEET);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, 2).getValues();
  var out = [];
  values.forEach(function(r){
    var key = String(r[0] || '').trim();
    if (!key) return;
    out.push({ key: key, json: String(r[1] || '') });
  });
  return out;
}
function writeContent_(key, obj){
  var sh = sheetOf_(CONTENT_SHEET);
  var last = sh.getLastRow();
  var text = JSON.stringify(obj);
  for (var r = 2; r <= last; r++){
    if (String(sh.getRange(r, 1).getValue()).trim() === key){
      sh.getRange(r, 2).setValue(text);
      return;
    }
  }
  sh.appendRow([key, text]);
}

/* ---------- 保存の記録（誰がいつ何を保存したか） ---------- */
function log_(user, what, count){
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName('保存履歴') || ss.insertSheet('保存履歴');
    if (sh.getLastRow() === 0) sh.appendRow(['日時', 'メール', '対象', '件数']);
    sh.appendRow([Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss'), user.email, what, count]);
    /* 500行を超えたら古いものから消す */
    if (sh.getLastRow() > 501) sh.deleteRows(2, sh.getLastRow() - 501);
  } catch (err){ /* 記録に失敗しても保存自体は続ける */ }
}

function json_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


/* =====================================================================
   動作確認用 — エディタから実行するとログに結果が出ます
   ===================================================================== */
function test_read(){
  Object.keys(SCHEMA).forEach(function(t){
    Logger.log(t + ': ' + readSheet_(t).length + ' 件');
  });
  Logger.log('設定: ' + readContent_().length + ' 件');
}
