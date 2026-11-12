'use strict';
window.host.app.version().then((v) => {
  document.getElementById('ver').textContent = 'v' + v;
});
