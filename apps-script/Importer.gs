/* Public-page importer. Extracts page metadata; never publishes a proposal. */
function checkImporterAccess() {
  // Operator-only check in the Apps Script editor; not exposed through doPost.
  const response = UrlFetchApp.fetch('https://dns.google/resolve?name=www.easycamp.com.tw&type=A', { muteHttpExceptions: true });
  console.log('Public-page reader HTTP ' + response.getResponseCode());
  console.log(response.getContentText().slice(0, 600));
}
function previewCamp_(id, rawUrl) {
  const cache = CacheService.getScriptCache();
  const url = publicUrl_(rawUrl);
  const minute = Math.floor(Date.now() / 60000);
  const device = 'preview:' + id + ':' + minute;
  const global = 'preview:all:' + minute;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('busy');
  try {
    const d = Number(cache.get(device) || 0), g = Number(cache.get(global) || 0);
    if (d >= 6 || g >= 40) fail_('rate');
    cache.put(device, String(d + 1), 120); cache.put(global, String(g + 1), 120);
  } finally { lock.releaseLock(); }
  const cacheKey = 'page:' + idOf_(url);
  const saved = cache.get(cacheKey);
  if (saved) return JSON.parse(saved);
  let current = url, response;
  for (let i = 0; i < 5; i++) {
    current = publicUrl_(current);
    publicHost_(current.match(/^https:\/\/([^/]+)/i)[1]);
    try { response = UrlFetchApp.fetch(current, { followRedirects: false, muteHttpExceptions: true, validateHttpsCertificates: true, headers: { Accept: 'text/html,application/xhtml+xml' } }); }
    catch (e) { importPermissionError_(e); fail_('import', '無法讀取這個網頁，請保留網址並手動填寫'); }
    const code = response.getResponseCode();
    if (code >= 300 && code < 400) {
      const h = response.getHeaders(); const next = String(h.Location || h.location || '');
      const origin = current.match(/^https:\/\/[^/]+/i)[0];
      current = next.indexOf('//') === 0 ? 'https:' + next : next.indexOf('/') === 0 ? origin + next : /^https:\/\//i.test(next) ? next : origin + current.replace(/^https:\/\/[^/]+/, '').replace(/[^/]*$/, '') + next;
      continue;
    }
    if (code !== 200) fail_('import', '網站未提供公開內容（HTTP ' + code + '），請手動補填');
    const headers = response.getHeaders();
    const type = String(headers['Content-Type'] || headers['content-type'] || '');
    if (type && !/html|xhtml/i.test(type)) fail_('import', '請貼上營區介紹網頁，而不是圖片或下載檔');
    const bytes = response.getContent();
    if (bytes.length > 2000000) fail_('import', '網頁太大，請改貼營區的介紹頁或手動填寫');
    const html = response.getContentText().slice(0, 1000000);
    const preview = extractCampPage_(html, current);
    cache.put(cacheKey, JSON.stringify(preview), 300);
    return preview;
  }
  fail_('import', '網址轉址過多，請貼上瀏覽器最後開啟的完整網址');
}

function publicUrl_(value) {
  const url = String(value || '').trim();
  const match = url.match(/^https:\/\/([a-z0-9.-]+)(?::443)?([/?#][^\s<>"'\\]*)?$/i);
  if (url.length > 2000 || !match || match[1].indexOf('.') < 0 || /^(?:[\d.]+|localhost)$/i.test(match[1]) || /\.(?:local|internal|localhost|test|invalid)$/i.test(match[1])) fail_('import', '請使用公開網站的完整 https:// 網址');
  return 'https://' + match[1].toLowerCase() + (match[2] || '/');
}
function publicHost_(host) {
  // Validate both address families before every request and redirect.
  for (const type of ['A', 'AAAA']) {
    let dns;
    try { dns = JSON.parse(UrlFetchApp.fetch('https://dns.google/resolve?name=' + encodeURIComponent(host) + '&type=' + type, { muteHttpExceptions: true }).getContentText()); }
    catch (e) { importPermissionError_(e); fail_('import', '暫時無法確認這個網站的公開位址，請稍後再試'); }
    if (dns.Status !== 0) fail_('import', '找不到這個網站，請檢查網址');
    for (const answer of dns.Answer || []) {
      if (answer.type === 1) {
        const p = answer.data.split('.').map(Number);
        if (p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && (p[1] === 168 || p[1] === 0)) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || (p[0] === 198 && (p[1] === 18 || p[1] === 19))) fail_('import', '這個網址不是可讀取的公開網站');
      }
      if (answer.type === 28 && !/^2[0-9a-f]{3}:/i.test(answer.data)) fail_('import', '這個網址不是可讀取的公開網站');
    }
  }
}
function importPermissionError_(error) {
  if (/external_request|permission|權限/i.test(String(error))) fail_('importSetup', '網址讀取功能需要主揪完成 Google 授權；目前仍可手動填寫營區資訊。');
}
function pageText_(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => { const code = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n); return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''; }).replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, m => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' }[m])).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
}
function extractCampPage_(html, url) {
  const meta = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = {};
    tag.replace(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g, (_, key, a, b, c) => { attrs[key.toLowerCase()] = a === undefined ? b === undefined ? c : b : a; return ''; });
    const key = attrs.property || attrs.name;
    if (key && attrs.content) meta[key.toLowerCase()] = pageText_(attrs.content);
  }
  const nodes = [];
  function collect(value, depth) {
    if (!value || depth > 8) return;
    if (Array.isArray(value)) { value.forEach(x => collect(x, depth + 1)); return; }
    if (typeof value !== 'object') return;
    nodes.push(value);
    if (value['@graph']) collect(value['@graph'], depth + 1);
    if (value.mainEntity) collect(value.mainEntity, depth + 1);
    if (value.about) collect(value.about, depth + 1);
  }
  const scripts = html.match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script\s*>/gi) || [];
  for (const script of scripts.slice(0, 20)) { try { collect(JSON.parse(script.replace(/^[\s\S]*?>/, '').replace(/<\/script\s*>[\s\S]*$/i, '')), 0); } catch (e) { /* Not valid JSON-LD. */ } }
  const camp = nodes.find(x => /Campground|LodgingBusiness|LocalBusiness|Hotel|Resort|Place/i.test([].concat(x['@type'] || []).join(' '))) || {};
  const rawTitle = meta['og:title'] || pageText_((html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]) || pageText_((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  const title = rawTitle.replace(/\s*[-|｜]\s*(?:營區介紹|露友評價|露營樂|愛露營).*$/, '').trim();
  const address = camp.address || nodes.map(x => x.address).find(Boolean) || '';
  let place = typeof address === 'string' ? pageText_(address) : pageText_([address.addressRegion, address.addressLocality, address.streetAddress].filter(Boolean).join(''));
  if (!place) {
    const index = html.search(/<h1\b/i);
    const body = html.slice(index < 0 ? 0 : index).replace(/<(script|style|footer|nav)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
    const text = pageText_(body).slice(0, 50000);
    const found = text.match(/((?:臺北市|台北市|新北市|桃園市|新竹縣|新竹市|苗栗縣|臺中市|台中市|彰化縣|南投縣|雲林縣|嘉義縣|嘉義市|臺南市|台南市|高雄市|屏東縣|臺東縣|台東縣|花蓮縣|宜蘭縣|基隆市|澎湖縣|金門縣|連江縣)[\u4e00-\u9fff]{1,4}[鄉鎮市區][^\s，。；;<>]{0,30})/);
    if (found) place = found[1];
  }
  const description = pageText_(camp.description || meta['og:description'] || meta.description || '');
  const known = typeof CAMP_CATALOG !== 'undefined' && CAMP_CATALOG.find(x => title.indexOf(x.name) >= 0);
  const name = pageText_(camp.name || (known && known.name) || title).slice(0, 40);
  if (!name || /^(?:Just a moment|Access Denied|登入|Login|Facebook)/i.test(name)) fail_('import', '這個網頁需要登入或未提供可讀內容，請手動填寫');
  return { name, place: (place || (known && known.place) || '').slice(0, 30), reason: (description || (known && known.intro) || '').slice(0, 150), url, sourceTitle: rawTitle.slice(0, 120), method: camp.name ? 'structured' : 'metadata', missing: [!place && !(known && known.place) ? '地點' : '', !description && !(known && known.intro) ? '簡介' : ''].filter(Boolean) };
}
