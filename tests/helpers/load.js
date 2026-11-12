'use strict';
// Загружает браузерные скрипты (они пишут в window.VTT) в песочницу vm и отдаёт VTT.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_DIR = path.join(__dirname, '..', '..', 'src', 'renderer', 'js');
const DEFAULT_FILES = ['geometry.js', 'movement.js', 'dice.js'];

function load(files = DEFAULT_FILES) {
  const sandbox = { console };
  sandbox.window = sandbox; // скрипты обращаются к window.* и голым глобалям одинаково
  vm.createContext(sandbox);
  for (const f of files) {
    const code = fs.readFileSync(path.join(JS_DIR, f), 'utf8');
    vm.runInContext(code, sandbox, { filename: f });
  }
  return sandbox.VTT;
}

module.exports = { load, JS_DIR };
