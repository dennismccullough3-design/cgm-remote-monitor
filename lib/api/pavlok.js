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

  api.post('/pavlok/stimulus', adminOnly, requirePavlok, function (req, res) {
    var type = req.body && req.body.type;
    var value = req.body && Number(req.body.value);

    var invalid = ctx.pavlok.validateStimulus(type, value);
    if (invalid) {
      return res.status(consts.HTTP_BAD_REQUEST).json({ sent: false, message: invalid });
    }

    console.info('[pavlok] manual test: ' + type + ' ' + value + '%');
    ctx.pavlok.sendStimulus(type, value).then(function () {
      res.json({ sent: true, type: type, value: value });
    }).catch(function (err) {
      console.error('[pavlok] manual test failed:', err.message);
      res.status(consts.HTTP_INTERNAL_ERROR).json({ sent: false, message: err.message });
    });
  });

  return api;
}

module.exports = configure;
