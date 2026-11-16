(async function () {
  'use strict';
  VTT.i18n.apply();
  // при нескольких кампаниях сначала выбор (до инициализации модулей, которые читают текущую кампанию)
  try { await VTT.campaignsUi.startup(); } catch (e) { console.warn('startup chooser', e); }
  try { VTT.diceSkin.setCurrent((await window.host.settings.get()).diceSkin); } catch (e) { /* остаётся «Классика» */ }
  VTT.gm.init();
  VTT.showcase.init();
  VTT.combat.init();
  VTT.settings.init();
  VTT.updateUi.init();
  VTT.music.init().catch(function (e) { console.warn('music init', e); });
})();
