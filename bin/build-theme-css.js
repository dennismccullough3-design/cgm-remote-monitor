'use strict';

// Builds the served theme stylesheets from static/css/src.
//
// The themes are written with CSS custom properties (var(--t-fg) etc.), which
// older browsers, including many TV browsers, do not understand: they drop
// every such declaration and the theme falls apart. For each rule that uses
// var(), this writes a copy just before it with the values worked out for
// each theme, so those browsers still get the right colours. Modern browsers
// get the same values either way, because the original rule comes later and
// has the same specificity.
//
// usage: node bin/build-theme-css.js            writes static/css/<name>.css
//        node bin/build-theme-css.js --check    exits 1 if they are out of date

var fs = require('fs');
var path = require('path');
var postcss = require('postcss');
var themeClasses = require('../lib/client/theme-classes');

var CSS_DIR = path.join(__dirname, '..', 'static', 'css');
var FILES = ['theme-pipboy.css', 'themes-extra.css'];
var THEME_SELECTOR = /^body((?:\.theme-[a-z0-9]+)+)([\s\S]*)$/;

function themeClassesIn (selector) {
  var match = THEME_SELECTOR.exec(selector);
  if (!match) return null;
  return {
    classes: match[1].slice(1).split('.')
    , rest: match[2]
  };
}

function appliesTo (classes, theme) {
  var have = themeClasses.classesFor(theme);
  return classes.every(function has (name) { return have.indexOf(name) !== -1; });
}

// custom properties each theme ends up with, applying the body.theme-* rules
// that set them in specificity order, then source order
function variablesFor (root, theme) {
  var definitions = [];
  root.walkRules(function eachRule (rule) {
    var defines = rule.nodes.some(function isVariable (node) {
      return node.type === 'decl' && node.prop.indexOf('--') === 0;
    });
    if (!defines) return;
    if (rule.parent.type !== 'root') {
      throw new Error('custom properties must be set at the top level: ' + rule.selector);
    }
    rule.selectors.forEach(function eachSelector (selector) {
      var parsed = themeClassesIn(selector);
      if (!parsed || parsed.rest.trim()) {
        throw new Error('custom properties must be set on body.theme-*: ' + selector);
      }
      if (appliesTo(parsed.classes, theme)) {
        definitions.push({ rule: rule, specificity: parsed.classes.length, order: definitions.length });
      }
    });
  });
  definitions.sort(function bySpecificity (a, b) {
    return a.specificity - b.specificity || a.order - b.order;
  });

  var variables = {};
  definitions.forEach(function eachDefinition (definition) {
    definition.rule.each(function eachNode (node) {
      if (node.type === 'decl' && node.prop.indexOf('--') === 0) {
        variables[node.prop] = node.value.trim();
      }
    });
  });
  return variables;
}

// replaces every var() in a value; null when one has no value
function resolve (value, variables, seen) {
  var start = value.indexOf('var(');
  if (start === -1) return value;

  var depth = 0;
  var end = start + 3;
  for (; end < value.length; end++) {
    if (value[end] === '(') depth++;
    if (value[end] === ')' && --depth === 0) break;
  }
  if (depth !== 0) return null;

  var inner = value.slice(start + 4, end);
  var comma = inner.indexOf(',');
  var name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
  var replacement = null;
  if (Object.prototype.hasOwnProperty.call(variables, name) && seen.indexOf(name) === -1) {
    replacement = resolve(variables[name], variables, seen.concat(name));
  }
  if (replacement === null && comma !== -1) {
    replacement = resolve(inner.slice(comma + 1).trim(), variables, seen);
  }
  if (replacement === null) return null;

  var rest = resolve(value.slice(end + 1), variables, seen);
  return rest === null ? null : value.slice(0, start) + replacement + rest;
}

function build (source) {
  var root = postcss.parse(source);
  var themes = themeClasses.themesWithClasses();
  var variables = {};
  themes.forEach(function eachTheme (theme) {
    variables[theme] = variablesFor(root, theme);
  });

  var rules = [];
  root.walkRules(function eachRule (rule) {
    var usesVariables = rule.nodes.some(function usesVar (node) {
      return node.type === 'decl' && node.value.indexOf('var(') !== -1;
    });
    if (usesVariables) rules.push(rule);
  });

  rules.forEach(function eachRule (rule) {
    var decls = rule.nodes.filter(function usesVar (node) {
      return node.type === 'decl' && node.value.indexOf('var(') !== -1;
    });

    // same declarations for several themes share one rule
    var groups = [];
    rule.selectors.forEach(function eachSelector (selector) {
      var parsed = themeClassesIn(selector);
      if (!parsed) return;
      themes.forEach(function eachTheme (theme) {
        if (!appliesTo(parsed.classes, theme)) return;
        var resolved = [];
        decls.forEach(function eachDecl (decl) {
          var value = resolve(decl.value, variables[theme], []);
          if (value !== null) resolved.push({ prop: decl.prop, value: value, important: decl.important });
        });
        if (!resolved.length) return;

        // keep the specificity: one theme class for each one replaced
        var themed = 'body' + parsed.classes.map(function () { return '.theme-' + theme; }).join('') + parsed.rest;
        var key = JSON.stringify(resolved);
        var group = groups.find(function sameDecls (g) { return g.key === key; });
        if (!group) {
          group = { key: key, decls: resolved, selectors: [] };
          groups.push(group);
        }
        if (group.selectors.indexOf(themed) === -1) group.selectors.push(themed);
      });
    });

    groups.forEach(function eachGroup (group) {
      var fallback = postcss.rule({ selector: group.selectors.join(',\n') });
      fallback.raws.between = ' ';
      fallback.raws.after = '\n';
      fallback.raws.semicolon = true;
      group.decls.forEach(function eachDecl (decl) {
        fallback.append(postcss.decl({ prop: decl.prop, value: decl.value, important: decl.important, raws: { before: '\n  ', between: ': ' } }));
      });
      rule.before(fallback);
      fallback.raws.before = rule.raws.before || '\n\n';
    });
  });

  return root.toString();
}

function header (file) {
  return '/* Generated by bin/build-theme-css.js from static/css/src/' + file +
    ' - edit that file, then run: npm run build-theme-css */\n';
}

function expected (file) {
  return header(file) + build(fs.readFileSync(path.join(CSS_DIR, 'src', file), 'utf8'));
}

if (require.main === module) {
  var check = process.argv.indexOf('--check') !== -1;
  var stale = FILES.filter(function eachFile (file) {
    var target = path.join(CSS_DIR, file);
    var css = expected(file);
    var current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
    if (current === css) return false;
    if (!check) fs.writeFileSync(target, css);
    console.log((check ? 'out of date: ' : 'wrote ') + path.relative(process.cwd(), target));
    return true;
  });
  if (check && stale.length) process.exit(1);
}

module.exports = {
  FILES: FILES
  , CSS_DIR: CSS_DIR
  , build: build
  , expected: expected
};
