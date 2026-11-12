'use strict';
const path = require('path');
const { app } = require('electron');
const store = require('./store');

const DEFAULTS = { lang: 'ru', currentCampaign: null };
const file = () => path.join(app.getPath('userData'), 'settings.json');

function get() { return Object.assign({}, DEFAULTS, store.readJson(file(), {})); }
function set(patch) {
  const s = Object.assign(get(), patch && typeof patch === 'object' ? patch : {});
  store.writeJson(file(), s);
  return s;
}

module.exports = { get, set };
