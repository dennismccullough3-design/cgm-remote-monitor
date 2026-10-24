'use strict';

var times = require('../times');
var levels = require('../levels');

var DEFAULT_API_URL = 'https://api.pavlok.com/api/v5/stimulus/send';
var STIMULUS_TYPES = ['zap', 'vibe', 'beep'];
var REQUEST_TIMEOUT_MS = 10000;
var MAX_PAUSE_MINS = times.days(7).mins;

// Pavlok watch integration, for one or two watches.
//
// Enable with ENABLE=pavlok and PAVLOK_API_TOKEN=<bearer token>. A second
// watch is added with PAVLOK_API_TOKEN_2. PAVLOK_NAME / PAVLOK_NAME_2 set the
// default watch names.
//
// Fires only from Nightscout's own low/high and stale data alarms, after they
// pass the normal alarm enable/snooze checks:
//   urgent low / low              -> zap
//   urgent high / high            -> vibe
//   urgent / warning no CGM data  -> vibe (needs TIMEAGO_ENABLE_ALERTS)
// Each alarm type has its own cooldown (minutes), configurable with
// PAVLOK_URGENT_LOW_COOLDOWN, PAVLOK_LOW_COOLDOWN, PAVLOK_HIGH_COOLDOWN,
// PAVLOK_URGENT_HIGH_COOLDOWN, PAVLOK_NO_DATA_COOLDOWN and
// PAVLOK_URGENT_NO_DATA_COOLDOWN.
//
// From the admin page each watch can be switched off, paused for a while,
// and have each alarm switched off or its strength changed (default 100%).
function init (env) {

  var settings = (env.extendedSettings && env.extendedSettings.pavlok) || {};

  // accept a token with or without a leading 'Bearer ' copied from a cURL
  function cleanToken (value) {
    return value ? String(value).trim().replace(/^bearer\s+/i, '') : '';
  }

  var watches = [
    { id: '1', token: cleanToken(settings.apiToken), defaultName: settings.name ? String(settings.name) : 'Watch 1' }
    , { id: '2', token: cleanToken(settings.apiToken2), defaultName: settings.name2 ? String(settings.name2) : 'Watch 2' }
  ].filter(function hasToken (watch) {
    return watch.token;
  });

  if (watches.length === 0) {
    return null;
  }

  var apiUrl = settings.apiUrl ? String(settings.apiUrl) : DEFAULT_API_URL;

  function cooldownMins (value, defaultMins) {
    var mins = Number(value);
    return isNaN(mins) || mins < 0 ? defaultMins : mins;
  }

  var alarms = {
    urgentLow: {
      label: 'Urgent Low'
      , cooldown: times.mins(cooldownMins(settings.urgentLowCooldown, 5)).msecs
      , type: 'zap'
    }
    , low: {
      label: 'Low'
      , cooldown: times.mins(cooldownMins(settings.lowCooldown, 10)).msecs
      , type: 'zap'
    }
    , high: {
      label: 'High'
      , cooldown: times.mins(cooldownMins(settings.highCooldown, 30)).msecs
      , type: 'vibe'
    }
    , urgentHigh: {
      label: 'Urgent High'
      , cooldown: times.mins(cooldownMins(settings.urgentHighCooldown, 30)).msecs
      , type: 'vibe'
    }
    , noData: {
      label: 'No CGM Data'
      , cooldown: times.mins(cooldownMins(settings.noDataCooldown, 30)).msecs
      , type: 'vibe'
    }
    , urgentNoData: {
      label: 'Urgent No CGM Data'
      , cooldown: times.mins(cooldownMins(settings.urgentNoDataCooldown, 30)).msecs
      , type: 'vibe'
    }
  };

  // per watch, per alarm: when it last fired and whether a send is running
  var lastSent = {};
  var inFlight = {};

  // settings that can be changed from the admin page
  var watchSettings = {};

  function defaultWatchSettings (watch) {
    var result = { name: watch.defaultName, enabled: true, pausedUntil: null, alarms: {} };
    Object.keys(alarms).forEach(function eachAlarm (key) {
      result.alarms[key] = { enabled: true, strength: 100 };
    });
    return result;
  }

  watches.forEach(function eachWatch (watch) {
    watchSettings[watch.id] = defaultWatchSettings(watch);
    lastSent[watch.id] = {};
    inFlight[watch.id] = {};
  });

  var pavlok = {
    // exposed for testing
    now: Date.now
    // set by the server to record each alarm trigger in the Pavlok log
    , onResult: function noop () { }
  };

  function findWatch (id) {
    return watches.find(function (watch) { return watch.id === String(id); });
  }

  function isPaused (watchId, now) {
    var pausedUntil = watchSettings[watchId].pausedUntil;
    return !!pausedUntil && pausedUntil > now;
  }

  function report (result) {
    try {
      pavlok.onResult(result);
    } catch (err) {
      console.error('[pavlok] unable to record alarm trigger:', err.message);
    }
  }

  pavlok.alarmKeyFor = function alarmKeyFor (notify) {
    if (!notify || notify.clear || notify.isAnnouncement || !levels.isAlarm(notify.level)) {
      return null;
    }

    var urgent = notify.level === levels.URGENT;

    if (notify.eventName === 'low') {
      return urgent ? 'urgentLow' : 'low';
    } else if (notify.eventName === 'high') {
      return urgent ? 'urgentHigh' : 'high';
    } else if (notify.eventName === 'timeago') {
      return urgent ? 'urgentNoData' : 'noData';
    }

    return null;
  };

  // why this watch should not get this alarm right now, or null to send it
  function skipReason (watch, key, now) {
    var ws = watchSettings[watch.id];
    var alarm = alarms[key];
    var previous = lastSent[watch.id][key] || 0;

    if (!ws.enabled) {
      return 'turned off';
    } else if (isPaused(watch.id, now)) {
      return 'paused';
    } else if (!ws.alarms[key].enabled) {
      return 'alarm turned off';
    } else if (inFlight[watch.id][key]) {
      return 'already sending';
    } else if (previous && now - previous < alarm.cooldown) {
      return 'cooldown';
    }
    return null;
  }

  function sendAlarmToWatch (watch, key, now) {
    var alarm = alarms[key];
    var strength = watchSettings[watch.id].alarms[key].strength;
    var previous = lastSent[watch.id][key] || 0;

    lastSent[watch.id][key] = now;
    inFlight[watch.id][key] = true;

    return pavlok.sendStimulus(watch.id, alarm.type, strength).then(function onSent () {
      return { watch: watch.id, name: watchSettings[watch.id].name, sent: true, type: alarm.type, value: strength };
    }).catch(function onError (err) {
      // let the next alarm emit retry this watch instead of waiting out the cooldown
      lastSent[watch.id][key] = previous;
      return { watch: watch.id, name: watchSettings[watch.id].name, sent: false, type: alarm.type, value: strength, error: err.message };
    }).finally(function done () {
      delete inFlight[watch.id][key];
    });
  }

  pavlok.handleNotification = function handleNotification (notify) {
    var key = pavlok.alarmKeyFor(notify);
    if (!key) {
      return Promise.resolve({ sent: false, reason: 'not a low/high/no data alarm' });
    }

    var alarm = alarms[key];
    var now = pavlok.now();
    var skipped = {};
    var targets = watches.filter(function eachWatch (watch) {
      var reason = skipReason(watch, key, now);
      if (reason) {
        skipped[watch.id] = reason;
      }
      return !reason;
    });

    if (targets.length === 0) {
      console.info('[pavlok] ' + alarm.label + ' alarm not sent: ' + JSON.stringify(skipped));
      return Promise.resolve({ sent: false, reason: 'skipped', skipped: skipped });
    }

    return Promise.all(targets.map(function (watch) {
      return sendAlarmToWatch(watch, key, now);
    })).then(function onResults (results) {
      var sent = results.some(function (r) { return r.sent; });

      results.forEach(function logResult (r) {
        if (r.sent) {
          console.info('[pavlok] sent ' + alarm.label + ' alarm to ' + r.name + ': ' + notify.title);
        } else {
          console.error('[pavlok] failed to send ' + alarm.label + ' alarm to ' + r.name + ':', r.error);
        }
      });

      report({ alarm: key, label: alarm.label, title: notify.title, sent: sent, watches: results });
      return { sent: sent, alarm: key, watches: results, skipped: skipped };
    });
  };

  pavlok.validateStimulus = function validateStimulus (type, value) {
    if (STIMULUS_TYPES.indexOf(type) === -1) {
      return 'type must be one of: ' + STIMULUS_TYPES.join(', ');
    }
    var number = Number(value);
    if (!Number.isInteger(number) || number < 1 || number > 100) {
      return 'value must be a whole number from 1 to 100';
    }
    return null;
  };

  pavlok.sendStimulus = function sendStimulus (watchId, type, value) {
    var watch = findWatch(watchId);
    if (!watch) {
      return Promise.reject(new Error('unknown watch: ' + watchId));
    }

    var invalid = pavlok.validateStimulus(type, value);
    if (invalid) {
      return Promise.reject(new Error(invalid));
    }

    var body = {
      stimulus: {
        stimulusType: type
        , stimulusValue: Number(value)
      }
    };

    return pavlok.request(watch, body);
  };

  // manual test from the admin page, to one watch or 'all'; ignores the
  // on/off, pause and cooldown settings so a paused watch can still be tested
  pavlok.sendTest = function sendTest (target, type, value) {
    var targets = target === 'all' ? watches : watches.filter(function (w) { return w.id === String(target); });
    if (targets.length === 0) {
      return Promise.reject(new Error('unknown watch: ' + target));
    }

    return Promise.all(targets.map(function (watch) {
      return pavlok.sendStimulus(watch.id, type, value).then(function () {
        return { watch: watch.id, name: watchSettings[watch.id].name, sent: true };
      }).catch(function (err) {
        return { watch: watch.id, name: watchSettings[watch.id].name, sent: false, error: err.message };
      });
    }));
  };

  // exposed for testing
  pavlok.request = function request (watch, body) {
    return fetch(apiUrl, {
      method: 'POST'
      , headers: {
        Authorization: 'Bearer ' + watch.token
        , 'Content-Type': 'application/json'
        , Accept: 'application/json'
      }
      , body: JSON.stringify(body)
      , signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    }).then(function checkResponse (response) {
      return response.text().then(function readBody (text) {
        if (!response.ok) {
          throw new Error('Pavlok API responded ' + response.status + ': ' + text.slice(0, 200));
        }
        return { status: response.status, body: text };
      });
    });
  };

  pavlok.labels = function labels () {
    var result = {};
    Object.keys(alarms).forEach(function eachAlarm (key) {
      result[key] = alarms[key].label;
    });
    return result;
  };

  // the saved settings document, without anything secret
  pavlok.getSettings = function getSettings () {
    return { watches: JSON.parse(JSON.stringify(watchSettings)) };
  };

  // apply settings saved earlier (on boot) or sent from the admin page;
  // unknown watches/alarms and invalid values are ignored
  pavlok.applySettings = function applySettings (doc) {
    var now = pavlok.now();
    var incoming = (doc && doc.watches) || {};

    Object.keys(incoming).forEach(function eachWatch (id) {
      var current = watchSettings[id];
      var update = incoming[id];
      if (!current || !update || typeof update !== 'object') {
        return;
      }

      if (typeof update.name === 'string' && update.name.trim()) {
        current.name = update.name.trim().slice(0, 40);
      }
      if (typeof update.enabled === 'boolean') {
        current.enabled = update.enabled;
      }
      if (update.pausedUntil === null || typeof update.pausedUntil === 'number') {
        current.pausedUntil = update.pausedUntil;
      }
      if (typeof update.pauseMins === 'number' && update.pauseMins >= 0) {
        var mins = Math.min(update.pauseMins, MAX_PAUSE_MINS);
        current.pausedUntil = mins > 0 ? now + times.mins(mins).msecs : null;
      }

      Object.keys(update.alarms || {}).forEach(function eachAlarm (key) {
        var alarm = current.alarms[key];
        var alarmUpdate = update.alarms[key];
        if (!alarm || !alarmUpdate || typeof alarmUpdate !== 'object') {
          return;
        }
        if (typeof alarmUpdate.enabled === 'boolean') {
          alarm.enabled = alarmUpdate.enabled;
        }
        var strength = Number(alarmUpdate.strength);
        if (Number.isInteger(strength) && strength >= 1 && strength <= 100) {
          alarm.strength = strength;
        }
      });
    });

    return pavlok.getSettings();
  };

  pavlok.status = function status () {
    var now = pavlok.now();

    return {
      enabled: true
      , alarms: Object.keys(alarms).map(function eachAlarm (key) {
        return { key: key, label: alarms[key].label, type: alarms[key].type, cooldownMins: alarms[key].cooldown / 60000 };
      })
      , watches: watches.map(function eachWatch (watch) {
        var ws = watchSettings[watch.id];
        var cooldowns = {};
        Object.keys(alarms).forEach(function eachAlarm (key) {
          var last = lastSent[watch.id][key] || 0;
          cooldowns[key] = last ? Math.max(0, Math.ceil((alarms[key].cooldown - (now - last)) / 60000)) : 0;
        });
        return {
          id: watch.id
          , name: ws.name
          , enabled: ws.enabled
          , paused: isPaused(watch.id, now)
          , pausedUntil: isPaused(watch.id, now) ? ws.pausedUntil : null
          , alarms: ws.alarms
          , cooldownRemainingMins: cooldowns
        };
      })
    };
  };

  return pavlok;
}

module.exports = init;
