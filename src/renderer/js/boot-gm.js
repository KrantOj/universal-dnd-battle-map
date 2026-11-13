(async function () {
  'use strict';
  VTT.i18n.apply();
  // при нескольких кампаниях сначала выбор (до инициализации модулей, которые читают текущую кампанию)
  try { await VTT.campaignsUi.startup(); } catch (e) { console.warn('startup chooser', e); }
  VTT.gm.init();
  VTT.showcase.init();
  VTT.combat.init();
  VTT.settings.init();
  VTT.music.init().catch(function (e) { console.warn('music init', e); });
})();
