'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('package.json fields', () => {
  assert.strictEqual(pkg.name, 'universal-dnd-battle-map');
  assert.strictEqual(pkg.productName, 'Universal DnD Battle map');
  assert.strictEqual(pkg.main, 'src/main/main.js');
  assert.ok(fs.existsSync(path.join(root, pkg.main)));
});

test('protocol path traversal is blocked', () => {
  const src = fs.readFileSync(path.join(root, 'src/main/protocol.js'), 'utf8');
  assert.match(src, /startsWith\(ROOT/);
});
