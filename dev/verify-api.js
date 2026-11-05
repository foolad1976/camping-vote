'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'camps.js'), 'utf8'), sandbox);
const camps = sandbox.window.CAMP_SITES;
const base = process.env.TEST_BASE || 'http://localhost:8787';
const key = crypto.randomBytes(24).toString('hex');
async function api(action, fields = {}, deviceKey = key) {
  return fetch(base + '/api' + (action === 'previewCamp' ? '?transport=rpc' : ''), { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action, key: deviceKey, ...fields }) }).then(r => r.json());
}
(async () => {
  const state = await api('state'); assert.equal(state.ok, true);
  let result = await api('previewCamp', { url: 'https://www.example.com/camp' });
  assert.equal(result.ok, true); assert.equal(result.preview.name, '測試山林露營區'); assert.equal(result.preview.place, '南投縣國姓鄉山林路1號');
  for (const url of ['http://www.example.com/camp', 'https://127.0.0.1/camp', 'https://private.example.com/camp', 'https://www.example.com/redirect', 'https://www.example.com/blocked']) {
    result = await api('previewCamp', { url }); assert.equal(result.ok, false, url + ' should fail safely');
  }
  // Use independent devices to avoid exercising the intentional per-minute limit.
  for (const site of camps) {
    const device = crypto.randomBytes(24).toString('hex');
    result = await api('vote', { site: site.id, dates: ['2026-11-14'], nick: '測試新營區' }, device); assert.equal(result.ok, true, site.id);
    assert(result.state.votes.some(v => v.site === site.id));
    assert.equal((await api('unvote', {}, device)).ok, true);
  }
  result = await api('vote', { site: 'unknown-site', dates: ['2026-11-14'], nick: '測試' }); assert.equal(result.ok, false);
  const proposal = await api('propose', { name: '測試專用私房營地', place: '嘉義縣竹崎鄉', url: 'https://www.example.com/camp', reason: '只存在本機假試算表。' });
  assert.equal(proposal.ok, true);
  const added = proposal.state.proposals.find(p => p.name === '測試專用私房營地'); assert(added);
  result = await api('editProposal', { pid: added.id, name: '測試專用私房營地', place: '嘉義縣竹崎鄉', url: 'https://www.example.com/camp', reason: '更新測試資料' }); assert.equal(result.ok, true);
  const voter = crypto.randomBytes(24).toString('hex');
  result = await api('vote', { site: 'p:' + added.id, dates: ['2026-11-14'], nick: '測試私房營地' }, voter); assert.equal(result.ok, true);
  assert.equal((await api('unvote', {}, voter)).ok, true);
  console.log('PASS: URL extraction, private/redirect/blocked-page fallback, all ' + camps.length + ' campsite votes, invalid IDs, proposal create/edit/vote.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
