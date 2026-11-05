'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const files = ['Catalog.gs', 'Code.gs', 'Importer.gs'];
const source = files.map(name => fs.readFileSync(path.join(__dirname, '..', 'apps-script', name), 'utf8')).join('\n\n');
new vm.Script(source, { filename: 'backend-release.gs' });
fs.writeFileSync(path.join(__dirname, 'backend-release.gs'), source);
console.log('Backend release prepared (' + source.length + ' characters)');
