/**
 * 億載金城露營投票 — Google Apps Script 後端
 *
 * 部署方式見 README.md。資料存在這份試算表的三個工作表：
 *   votes      每支手機一列：id、營地、可出發週末、暱稱、更新時間
 *   proposals  同伴新增的營區：任何人都能新增、編輯，網頁上不能刪除
 *   history    proposals 每次新增／修改前後的內容（被亂改時可以從這裡救回）
 * 主揪要刪掉亂投的票或營區，直接在試算表刪那一列即可。
 *
 * 身分：前端在手機上產生一組隨機金鑰（key），每次請求附上；
 * 這裡只保存 key 的雜湊前 16 碼（id），公開的資料也只有 id，
 * 所以別人拿到 id 也無法冒充改票。
 */

const MAX_VOTES = 300;        // votes 工作表最多幾列（防灌爆）
const MAX_PROPOSALS = 60;     // proposals 工作表最多幾列
const MAX_PER_DEVICE = 5;     // 每支手機最多新增幾個營區
const MAX_HISTORY = 3000;     // history 超過就刪最舊的
const RATE_PER_DEVICE = 12;   // 每支手機每分鐘最多寫入次數
const RATE_GLOBAL = 150;      // 全站每分鐘最多寫入次數

// 網頁上固定的營區代號（index.html 的 SITES）。新增或移除固定營區時，兩邊要一起改。
const SITE_IDS = ['myhome', 'hutoupi', 'zoumalai', 'meiling', 'zengwen', 'tianchang', 'diaowana', 'gurenren',
  'zhenfeng', 'yuanshan', 'meiyuan', 'xuanmu', 'heilaoda', 'swiss'];

const COLUMNS = {
  votes: ['id', 'site', 'dates', 'nick', 'updatedAt'],
  proposals: ['id', 'name', 'place', 'url', 'reason', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt'],
  history: ['time', 'proposalId', 'editor', 'before', 'after'],
};

/* ---------- entry points ---------- */

/**
 * 第一次設定：在 Apps Script 編輯器選這個函式按「執行」一次。
 * 會記下這份試算表的編號（網頁版後端靠它找到試算表），並觸發 Google 授權。
 */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('請從試算表的「擴充功能 → Apps Script」開啟這份程式再執行');
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', ss.getId());
  Object.keys(COLUMNS).forEach(sheet_);
  return '設定完成：' + ss.getName();
}

function doGet() {
  // 健康檢查：瀏覽器直接開部署網址會看到目前票況（不含任何金鑰）
  return json_({ ok: true, state: readState_('') });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'invalid', message: 'bad json' });
  }
  if (!req || typeof req !== 'object') return json_({ ok: false, error: 'invalid', message: 'bad json' });

  const key = String(req.key || '');
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(key)) return json_({ ok: false, error: 'invalid', message: 'key' });
  const id = idOf_(key);

  try {
    switch (req.action) {
      case 'state': return json_({ ok: true, state: readState_(id) });
      case 'vote': return write_(id, () => upsert_('votes', id, voteRow_(id, req), MAX_VOTES));
      case 'unvote': return write_(id, () => remove_('votes', id));
      case 'propose': return write_(id, () => createProposal_(id, req));
      case 'editProposal': return write_(id, () => editProposal_(id, req));
      // 刻意沒有刪除營區的動作：網頁上只能新增、編輯
      default: return json_({ ok: false, error: 'invalid', message: 'action' });
    }
  } catch (err) {
    if (err && err.code) return json_({ ok: false, error: err.code, message: err.message });
    console.error(err);
    return json_({ ok: false, error: 'server' });
  }
}

/* ---------- writes ---------- */

function write_(id, fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) fail_('busy');
  try {
    // 頻率限制放在鎖裡面：檢查和計數不會被同時進來的請求插隊
    const cache = CacheService.getScriptCache();
    const minute = Math.floor(Date.now() / 60000); // 固定的一分鐘時間窗，不會因為持續有人送出而一直延長
    const gk = 'rate:all:' + minute, dk = 'rate:' + id + ':' + minute;
    const g = Number(cache.get(gk) || 0), d = Number(cache.get(dk) || 0);
    if (g >= RATE_GLOBAL || d >= RATE_PER_DEVICE) fail_('rate');
    cache.put(gk, String(g + 1), 120);
    cache.put(dk, String(d + 1), 120);
    fn();
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return json_({ ok: true, state: readState_(id) });
}

function voteRow_(id, req) {
  const site = String(req.site || '');
  if (site.indexOf('p:') === 0) {
    if (!/^p:[0-9a-f]{16}$/.test(site) || findRow_(sheet_('proposals'), site.slice(2)) < 0) fail_('invalid', '這個營區已被主揪移除');
  } else if (SITE_IDS.indexOf(site) < 0) {
    fail_('invalid', 'site');
  }
  const dates = Array.isArray(req.dates)
    ? req.dates.map(String).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    : [];
  const uniq = Array.from(new Set(dates)).sort();
  if (!uniq.length || uniq.length > 20) fail_('invalid', 'dates');
  const nick = text_(req.nick, 20);
  if (!nick) fail_('invalid', '請填暱稱');
  return [id, site, uniq.join(','), nick, new Date().toISOString()];
}

function proposalFields_(req) {
  const name = text_(req.name, 40);
  const place = text_(req.place, 30);
  if (!name || !place) fail_('invalid', '請填營區名稱和地點');
  const url = text_(req.url, 300);
  if (url && !/^https?:\/\/[^\s"'<>]+$/i.test(url)) fail_('invalid', '網址要以 https:// 開頭');
  const reason = text_(req.reason, 150);
  return [name, place, url, reason];
}

function createProposal_(id, req) {
  const f = proposalFields_(req);
  const all = rows_('proposals');
  if (all.length >= MAX_PROPOSALS) fail_('full');
  if (all.filter((r) => String(r[5]) === id).length >= MAX_PER_DEVICE) fail_('invalid', '每支手機最多新增 ' + MAX_PER_DEVICE + ' 個營區');
  const key = norm_(f[0]);
  if (all.some((r) => norm_(plain_(r[1])) === key)) fail_('invalid', '這個營區已經有人新增了，直接編輯它就好');
  const pid = Utilities.getUuid().replace(/-/g, '').slice(0, 16).toLowerCase();
  const now = new Date().toISOString();
  const sh = sheet_('proposals');
  sh.getRange(sh.getLastRow() + 1, 1, 1, 9).setValues([[pid].concat(f, [id, now, id, now]).map(cell_)]);
  log_(pid, id, null, f);
}

function editProposal_(id, req) {
  const pid = String(req.pid || '');
  if (!/^[0-9a-f]{16}$/.test(pid)) fail_('invalid', 'pid');
  const f = proposalFields_(req);
  const sh = sheet_('proposals');
  const r = findRow_(sh, pid);
  if (r < 0) fail_('invalid', '這個營區已被主揪移除');
  const before = sh.getRange(r, 2, 1, 4).getValues()[0].map(plain_);
  if (before.join('\u0001') === f.join('\u0001')) return; // 沒改東西
  const key = norm_(f[0]);
  if (norm_(before[0]) !== key && rows_('proposals').some((x) => String(x[0]) !== pid && norm_(plain_(x[1])) === key)) {
    fail_('invalid', '已經有同名的營區了');
  }
  sh.getRange(r, 2, 1, 4).setValues([f.map(cell_)]);
  sh.getRange(r, 8, 1, 2).setValues([[id, new Date().toISOString()]]);
  log_(pid, id, before, f);
}

function log_(pid, editor, before, after) {
  const sh = sheet_('history');
  if (sh.getLastRow() - 1 >= MAX_HISTORY) sh.deleteRow(2);
  sh.getRange(sh.getLastRow() + 1, 1, 1, 5).setValues([[
    new Date().toISOString(), pid, editor,
    before ? JSON.stringify(before) : '', JSON.stringify(after),
  ].map(cell_)]);
}

function norm_(s) {
  return String(s || '').replace(/\s+/g, '').toLowerCase();
}

function upsert_(name, id, row, max) {
  const sh = sheet_(name);
  const r = findRow_(sh, id);
  const cells = row.map(cell_);
  if (r >= 0) {
    sh.getRange(r, 1, 1, cells.length).setValues([cells]);
  } else {
    if (sh.getLastRow() - 1 >= max) fail_('full');
    sh.getRange(sh.getLastRow() + 1, 1, 1, cells.length).setValues([cells]);
  }
}

function remove_(name, id) {
  const sh = sheet_(name);
  const r = findRow_(sh, id);
  if (r >= 0) sh.deleteRow(r);
}

/* ---------- reads ---------- */

function readState_(me) {
  const votes = rows_('votes').map((r) => ({
    id: String(r[0]),
    site: String(r[1]),
    dates: dateList_(r[2]),
    nick: plain_(r[3]),
    at: time_(r[4]),
  })).filter((v) => v.id && v.site);
  const proposals = rows_('proposals').map((r) => ({
    id: String(r[0]),
    name: plain_(r[1]) || '（未命名營區）', // 名稱變空白也照樣顯示，不會變相消失
    place: plain_(r[2]),
    url: plain_(r[3]),
    reason: plain_(r[4]),
    by: String(r[5]),
    at: time_(r[6]),
    editedBy: String(r[7]),
    editedAt: time_(r[8]),
  })).filter((p) => /^[0-9a-f]{16}$/.test(p.id));
  return { me: me || null, votes: votes, proposals: proposals };
}

function rows_(name) {
  const sh = sheet_(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, COLUMNS[name].length).getValues();
}

/* ---------- helpers ---------- */

function spreadsheet_() {
  const sid = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const ss = sid ? SpreadsheetApp.openById(sid) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) fail_('setup', '主揪還沒在 Apps Script 執行 setup()');
  return ss;
}

function sheet_(name) {
  const ss = spreadsheet_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    const n = COLUMNS[name].length;
    sh.getRange(1, 1, sh.getMaxRows(), n).setNumberFormat('@'); // 全部當純文字，避免日期被自動轉換
    sh.getRange(1, 1, 1, n).setValues([COLUMNS[name]]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function findRow_(sh, id) {
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return i + 2;
  return -1;
}

function idOf_(key) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'campvote:' + key, Utilities.Charset.UTF_8);
  return bytes.slice(0, 8).map((b) => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
}

const LINE_SEPARATORS_ = new RegExp('[' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');

// 使用者輸入：去掉控制字元、頭尾空白，截斷長度
function text_(v, max) {
  return String(v == null ? '' : v).replace(/[\x00-\x1F\x7F]/g, ' ').replace(LINE_SEPARATORS_, ' ').trim().slice(0, max);
}

// 儲存格跳脫用的零寬空格（看不見）。試算表不會吃掉它，所以存進去、讀出來一定對得上。
const GUARD_ = String.fromCharCode(0x200B);

// 寫進儲存格前：開頭是 = + - @（會被當公式）、'（會被試算表當標記吃掉）或零寬空格本身的字串，
// 前面加一個零寬空格。這樣試算表一律當純文字存，讀回時固定去掉一個即可還原原文。
function cell_(v) {
  const s = String(v);
  return /^[=+\-@']/.test(s) || s.charAt(0) === GUARD_ ? GUARD_ + s : s;
}

// 讀出來時：去掉 cell_ 加的那一個零寬空格
function plain_(v) {
  const s = v instanceof Date ? v.toISOString() : String(v == null ? '' : v);
  return s.charAt(0) === GUARD_ ? s.slice(1) : s;
}

function dateList_(v) {
  if (v instanceof Date) return [Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd')];
  return String(v || '').split(',').map((d) => d.trim()).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
}

function time_(v) {
  if (v instanceof Date) return v.getTime();
  const t = Date.parse(String(v || ''));
  return isNaN(t) ? 0 : t;
}

function fail_(code, message) {
  const e = new Error(message || code);
  e.code = code;
  throw e;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
