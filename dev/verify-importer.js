'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = { CAMP_CATALOG: [], fail_: (code, message) => { throw Object.assign(new Error(message), { code }); } };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Importer.gs'), 'utf8'), context);
function page(address) {
  return '<html><head><meta name="description" content="山景露營"><script type="application/ld+json">' + JSON.stringify({ '@type': 'Campground', name: '測試營區', address }) + '</script></head></html>';
}
const url = 'https://example.com/camp';
assert.equal(context.extractCampPage_(page({ addressRegion: '南投縣仁愛鄉', streetAddress: '南投縣仁愛鄉大同村榮光巷50之5號' }), url).place, '南投縣仁愛鄉大同村榮光巷50之5號');
assert.equal(context.extractCampPage_(page({ addressRegion: '南投縣', addressLocality: '仁愛鄉', streetAddress: '大同村榮光巷50之5號' }), url).place, '南投縣仁愛鄉大同村榮光巷50之5號');
assert.equal(context.extractCampPage_(page({ addressRegion: '南投縣', addressLocality: '南投縣仁愛鄉', streetAddress: '南投縣仁愛鄉大同村榮光巷50之5號' }), url).place, '南投縣仁愛鄉大同村榮光巷50之5號');
assert.throws(() => context.publicUrl_('https://127.0.0.1/'), { code: 'import' });
console.log('PASS: structured-address overlap, separate address components, nested locality prefix, private URL rejection.');
