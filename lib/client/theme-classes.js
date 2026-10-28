'use strict';

// Body classes for each theme in Settings > Theme. A theme always gets
// theme-<name>; some also get another theme's classes so they can reuse its
// styles. Shared by the page and bin/build-theme-css.js.

var EXTRA_THEMES = [
  'night', 'highcontrast', 'light', 'kiosk', 'vaulttec', 'synthwave', 'lcars', 'cockpit', 'matrix', 'gameboy', 'paper'
  , 'blueprint', 'upsidedown', 'spartan', 'tron', 'neon', 'gauges', 'halloween', 'cyberpunk', 'cyberpunk2077'
];

var EXTRA_CLASSES = {
  pipboycrt: ['theme-pipboy']
  , amber: ['theme-pipboy', 'theme-pipboycrt']
};
EXTRA_THEMES.forEach(function eachExtraTheme (name) {
  EXTRA_CLASSES[name] = ['theme-extra'];
});

// every class the body gets for a theme, own class first
function classesFor (theme) {
  theme = theme || 'default';
  var extra = Object.prototype.hasOwnProperty.call(EXTRA_CLASSES, theme) ? EXTRA_CLASSES[theme] : [];
  return ['theme-' + theme].concat(extra);
}

function themesWithClasses () {
  return ['pipboy'].concat(Object.keys(EXTRA_CLASSES));
}

module.exports = {
  classesFor: classesFor
  , themesWithClasses: themesWithClasses
};
