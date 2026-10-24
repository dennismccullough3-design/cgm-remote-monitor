'use strict';

var consts = require('../constants');
var bodyParser = require('body-parser');

function configure (app, wares, ctx) {
  var express = require('express')
    , api = express.Router( )
    ;

  api.use(bodyParser.json());

  // only full admins ('*') hold this permission
  var adminOnly = ctx.authorization.isPermitted('admin:pavlok:stimulus');

  function requirePavlok (req, res, next) {
    if (!ctx.pavlok) {
      return res.status(404).json({
        enabled: false
        , message: 'Pavlok is not enabled. Add pavlok to ENABLE and set PAVLOK_API_TOKEN.'
      });
    }
    next();
  }

  api.get('/pavlok/status', adminOnly, requirePavlok, function (req, res) {
    res.json(ctx.pavlok.status());
  });

  api.get('/pavlok/log', adminOnly, requirePavlok, function (req, res) {
    if (!ctx.pavloklog) {
      return res.status(consts.HTTP_INTERNAL_ERROR).json({ message: 'Pavlok log is not available' });
    }
    ctx.pavloklog.summary(ctx.pavlok.labels()).then(function (summary) {
      res.json(summary);
    }).catch(function (err) {
      console.error('[pavlok] unable to read log:', err.message);
      res.status(consts.HTTP_INTERNAL_ERROR).json({ message: 'Unable to read Pavlok log' });
    });
  });

  api.put('/pavlok/settings', adminOnly, requirePavlok, function (req, res) {
    if (!req.body || typeof req.body !== 'object' || typeof req.body.watches !== 'object') {
      return res.status(consts.HTTP_BAD_REQUEST).json({ message: 'expected { watches: { ... } }' });
    }

    var settings = ctx.pavlok.applySettings(req.body);
    console.info('[pavlok] watch settings changed: ' + JSON.stringify(settings));

    var saved = ctx.pavloksettings ? ctx.pavloksettings.save(settings) : Promise.resolve();
    saved.then(function () {
      res.json(ctx.pavlok.status());
    }).catch(function (err) {
      console.error('[pavlok] unable to save settings:', err.message);
      res.status(consts.HTTP_INTERNAL_ERROR).json({
        message: 'Settings are active now but could not be saved, so they will reset if the server restarts: ' + err.message
      });
    });
  });

  api.post('/pavlok/stimulus', adminOnly, requirePavlok, function (req, res) {
    var type = req.body && req.body.type;
    var value = req.body && Number(req.body.value);
    var watch = (req.body && req.body.watch) || 'all';

    var invalid = ctx.pavlok.validateStimulus(type, value);
    if (invalid) {
      return res.status(consts.HTTP_BAD_REQUEST).json({ sent: false, message: invalid });
    }

    console.info('[pavlok] manual test: ' + type + ' ' + value + '% to watch ' + watch);
    ctx.pavlok.sendTest(watch, type, value).then(function (results) {
      var sent = results.some(function (r) { return r.sent; });
      results.filter(function (r) { return !r.sent; }).forEach(function (r) {
        console.error('[pavlok] manual test to ' + r.name + ' failed:', r.error);
      });
      res.status(sent ? consts.HTTP_OK : consts.HTTP_INTERNAL_ERROR).json({ sent: sent, type: type, value: value, watches: results });
    }).catch(function (err) {
      res.status(consts.HTTP_BAD_REQUEST).json({ sent: false, message: err.message });
    });
  });

  return api;
}

module.exports = configure;
