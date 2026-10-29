'use strict';

require('should');

var fs = require('fs');
var path = require('path');
var postcss = require('postcss');
var themeCss = require('../bin/build-theme-css');

describe('theme stylesheets', function () {
  themeCss.FILES.forEach(function eachFile (file) {
    it(file + ' is built from static/css/src (run npm run build-theme-css)', function () {
      var served = fs.readFileSync(path.join(themeCss.CSS_DIR, file), 'utf8');
      served.should.equal(themeCss.expected(file));
    });
  });

  it('writes each theme\'s values ahead of rules that use custom properties', function () {
    var css = themeCss.build(
      'body.theme-extra { --t-fg: #fff; --t-ink: var(--t-fg); }\n' +
      'body.theme-night { --t-fg: #f00; }\n' +
      'body.theme-pipboy { --pip: #0f0; }\n' +
      'body.theme-pipboy.theme-pipboycrt .x { color: var(--pip); }\n' +
      '@media (max-width: 750px) { body.theme-extra .reading { color: var(--t-ink); border: 1px solid var(--t-missing, #123); } }\n'
    );
    var root = postcss.parse(css);
    var rules = [];
    root.walkRules(function eachRule (rule) {
      rules.push({ selector: rule.selector, css: rule.nodes.map(String).join('; '), media: rule.parent.type === 'atrule' });
    });

    // specificity kept: one theme class for each one in the original selector
    var crt = rules.find(function crtRule (rule) { return rule.selector.indexOf('body.theme-amber.theme-amber .x') !== -1; });
    crt.css.should.equal('color: #0f0');
    crt.selector.split(',\n').should.containEql('body.theme-pipboycrt.theme-pipboycrt .x');

    var night = rules.find(function nightRule (rule) { return rule.media && rule.selector.split(',\n').indexOf('body.theme-night .reading') !== -1; });
    night.css.should.equal('color: #f00; border: 1px solid #123');
    var kiosk = rules.find(function kioskRule (rule) { return rule.media && rule.selector.split(',\n').indexOf('body.theme-kiosk .reading') !== -1; });
    kiosk.css.should.equal('color: #fff; border: 1px solid #123');

    // the original rule still comes last, so modern browsers use it
    var reading = rules.filter(function inMedia (rule) { return rule.media; });
    reading[reading.length - 1].selector.should.equal('body.theme-extra .reading');
  });
});
