'use strict';
// Генерирует src/renderer/locales/<lang>.js из <lang>.json (источник истины — json).
// Запуск: npm run build:locales. Классический скрипт нужен, чтобы окно получило словарь
// синхронно (<script src="locales/ru.js">) без fetch/CSP-обходов.
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'src', 'renderer', 'locales');

function render(lang, dict) {
  return '/* AUTO-GENERATED из ' + lang + '.json скриптом scripts/build-locales.js — не править руками */\n' +
    '(function () {\n  var V = (window.VTT = window.VTT || {});\n  V.locales = V.locales || {};\n' +
    '  V.locales.' + lang + ' = ' + JSON.stringify(dict, null, 2).replace(/\n/g, '\n  ') + ';\n})();\n';
}

function build() {
  const out = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const lang = f.replace(/\.json$/, '');
    const dict = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    fs.writeFileSync(path.join(dir, lang + '.js'), render(lang, dict));
    out.push(lang + ' (' + Object.keys(dict).length + ' ключей)');
  }
  return out;
}

if (require.main === module) console.log('locales: ' + build().join(', '));
module.exports = { render, build };
