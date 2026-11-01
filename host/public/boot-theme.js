// Тема и акцент из сохранённых настроек (читаются так же, как в settings-store:
// тёмная только при theme === 'dark', иначе светлая), чтобы стартовый экран
// не мигал белым на тёмной теме. Без настроек хост тоже стартует со светлой.
(function () {
  var root = document.documentElement, ui = {};
  try { ui = JSON.parse(localStorage.getItem('mpu:v2:ui')) || {}; } catch (e) {}
  root.setAttribute('data-theme', ui.theme === 'dark' ? 'dark' : 'light');
  if (typeof ui.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(ui.accent)) {
    root.style.setProperty('--accent', ui.accent.toLowerCase());
  }
})();
