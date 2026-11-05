// 本機測試用：用記憶體裡的假試算表執行 apps-script/Code.gs，並提供網頁。
// 用法：node dev/mock-server.js   然後開 http://localhost:8787
// 只給開發測試用，不會部署出去。
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8787);

/* ---------- fake Google services ---------- */
class Sheet {
  constructor() { this.data = []; }
  getLastRow() { return this.data.length; }
  getMaxRows() { return 1000; }
  getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
  setFrozenRows() {}
  deleteRow(r) { this.data.splice(r - 1, 1); }
}
class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = this.sh.data[this.r - 1 + i] || [];
      const o = [];
      for (let j = 0; j < this.nc; j++) o.push(row[this.c - 1 + j] ?? '');
      out.push(o);
    }
    return out;
  }
  setValues(v) {
    v.forEach((row, i) => {
      const target = (this.sh.data[this.r - 1 + i] ||= []);
      row.forEach((val, j) => {
        let x = val;
        // 模擬試算表：開頭的 ' 代表「當純文字」，存進去的值不含這個 '
        if (typeof x === 'string' && x.startsWith("'")) x = x.slice(1);
        // 模擬公式注入：如果沒被擋下，開頭 = 的字串會被當公式（這裡標記出來讓測試抓得到）
        else if (typeof x === 'string' && x.startsWith('=')) x = '#FORMULA!' + x;
        target[this.c - 1 + j] = x;
      });
    });
    return this;
  }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
}
const sheets = new Map();
const ss = {
  getSheetByName: (n) => sheets.get(n) || null,
  getId: () => 'mock-sheet',
  getName: () => '露營投票資料（測試）',
  insertSheet: (n) => { const s = new Sheet(); sheets.set(n, s); return s; },
};
const cache = new Map();
const props = new Map();
const ctx = vm.createContext({
  console,
  SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss, flush() {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) || null, setProperty: (k, v) => props.set(k, v) }) },
  CacheService: { getScriptCache: () => ({
    get: (k) => { const e = cache.get(k); return e && e.exp > Date.now() ? e.v : null; },
    put: (k, v, ttl) => cache.set(k, { v, exp: Date.now() + ttl * 1000 }),
  }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' },
    Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, s) => Array.from(crypto.createHash(alg).update(s, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
    getUuid: () => crypto.randomUUID(),
    formatDate: (d) => d.toISOString().slice(0, 10),
  },
  Session: { getScriptTimeZone: () => 'Asia/Taipei' },
  UrlFetchApp: { fetch: (url) => {
    // Deterministic fixtures: local QA never fetches arbitrary external sites.
    const u = new URL(url);
    if (u.hostname === 'dns.google') {
      const host = u.searchParams.get('name');
      const answer = u.searchParams.get('type') === 'A' ? [{ type: 1, data: host === 'private.example.com' ? '127.0.0.1' : '93.184.216.34' }] : [];
      return { getContentText: () => JSON.stringify({ Status: 0, Answer: answer }) };
    }
    const fixture = '<!doctype html><html><head><meta property="og:title" content="測試山林露營區"><meta name="description" content="草地營位、親子沙坑與山景；預約前請確認營位尺寸。"><script type="application/ld+json">{"@type":"Campground","name":"測試山林露營區","address":{"addressRegion":"南投縣","addressLocality":"國姓鄉","streetAddress":"山林路1號"}}</script></head><body><h1>測試山林露營區</h1></body></html>';
    const redirect = u.pathname === '/redirect';
    return { getResponseCode: () => redirect ? 302 : u.pathname === '/blocked' ? 403 : 200, getHeaders: () => redirect ? { Location: 'https://private.example.com/camp' } : { 'Content-Type': 'text/html; charset=utf-8' }, getContent: () => Buffer.from(fixture), getContentText: () => fixture };
  } },
  ContentService: {
    MimeType: { JSON: 'json' },
    createTextOutput: (s) => ({ body: s, setMimeType() { return this; } }),
  },
});
vm.runInContext(['Catalog.gs', 'Code.gs', 'Importer.gs'].map(name => fs.readFileSync(path.join(ROOT, 'apps-script', name), 'utf8')).join('\n'), ctx, { filename: 'backend.gs' });

/* ---------- http ---------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json' };
http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/api' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      const out = ctx.doPost({ postData: { contents: body } });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(out.body);
    });
    return;
  }
  if (url.pathname === '/api' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(ctx.doGet().body);
    return;
  }
  if (url.pathname === '/__sheets') { // 測試用：看假試算表內容
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(Object.fromEntries([...sheets].map(([k, s]) => [k, s.data])), null, 1));
    return;
  }
  if (url.pathname === '/config.js') {
    res.writeHead(200, { 'Content-Type': TYPES['.js'] });
    res.end(`window.CAMP_CONFIG = { apiUrl: 'http://localhost:${PORT}/api' };`);
    return;
  }
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`mock server: http://localhost:${PORT}`));
