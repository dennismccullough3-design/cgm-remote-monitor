'use strict';

var times = require('../times');
var levels = require('../levels');

var DEFAULT_API_URL = 'https://api.pavlok.com/api/v5/stimulus/send';
var STIMULUS_TYPES = ['zap', 'vibe', 'beep'];
var REQUEST_TIMEOUT_MS = 10000;

// Pavlok watch integration.
//
// Enable with ENABLE=pavlok and PAVLOK_API_TOKEN=<bearer token>.
// Fires only from Nightscout's own low/high and stale data alarms, after they
// pass the normal alarm enable/snooze checks:
//   urgent low / low              -> zap 100%
//   urgent high / high            -> vibe 100%
//   urgent / warning no CGM data  -> vibe 100% (needs TIMEAGO_ENABLE_ALERTS)
// Each alarm type has its own cooldown (minutes), configurable with
// PAVLOK_URGENT_LOW_COOLDOWN, PAVLOK_LOW_COOLDOWN, PAVLOK_HIGH_COOLDOWN,
// PAVLOK_URGENT_HIGH_COOLDOWN, PAVLOK_NO_DATA_COOLDOWN and
// PAVLOK_URGENT_NO_DATA_COOLDOWN.
function init (env) {

  var settings = (env.extendedSettings && env.extendedSettings.pavlok) || {};
  // accept the token with or without a leading 'Bearer ' copied from a cURL
  var token = settings.apiToken ? String(settings.apiToken).trim().replace(/^bearer\s+/i, '') : '';

  if (!token) {
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
      , stimuli: [{ type: 'zap', value: 100 }]
    }
    , low: {
      label: 'Low'
      , cooldown: times.mins(cooldownMins(settings.lowCooldown, 10)).msecs
      , stimuli: [{ type: 'zap', value: 100 }]
    }
    , high: {
      label: 'High'
      , cooldown: times.mins(cooldownMins(settings.highCooldown, 30)).msecs
      , stimuli: [{ type: 'vibe', value: 100 }]
    }
    , urgentHigh: {
      label: 'Urgent High'
      , cooldown: times.mins(cooldownMins(settings.urgentHighCooldown, 30)).msecs
      , stimuli: [{ type: 'vibe', value: 100 }]
    }
    , noData: {
      label: 'No CGM Data'
      , cooldown: times.mins(cooldownMins(settings.noDataCooldown, 30)).msecs
      , stimuli: [{ type: 'vibe', value: 100 }]
    }
    , urgentNoData: {
      label: 'Urgent No CGM Data'
      , cooldown: times.mins(cooldownMins(settings.urgentNoDataCooldown, 30)).msecs
      , stimuli: [{ type: 'vibe', value: 100 }]
    }
  };

  var lastSent = {};
  var inFlight = {};

  var pavlok = {
    // exposed for testing
    stimulusGapMs: 1500
    , now: Date.now
    // set by the server to record each alarm trigger in the Pavlok log
    , onResult: function noop () { }
  };

  function report (key, notify, sent, error) {
    try {
      pavlok.onResult({
        alarm: key
        , label: alarms[key].label
        , title: notify.title
        , sent: sent
        , error: error
        , stimuli: alarms[key].stimuli
      });
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

  pavlok.handleNotification = function handleNotification (notify) {
    var key = pavlok.alarmKeyFor(notify);
    if (!key) {
      return Promise.resolve({ sent: false, reason: 'not a low/high/no data alarm' });
    }

    var alarm = alarms[key];
    var now = pavlok.now();
    var previous = lastSent[key] || 0;

    if (inFlight[key]) {
      return Promise.resolve({ sent: false, reason: 'already sending' });
    }

    if (previous && now - previous < alarm.cooldown) {
      var remaining = Math.ceil((alarm.cooldown - (now - previous)) / 60000);
      console.info('[pavlok] ' + alarm.label + ' alarm in cooldown for ' + remaining + ' more minute(s)');
      return Promise.resolve({ sent: false, reason: 'cooldown' });
    }

    lastSent[key] = now;
    inFlight[key] = true;

    return pavlok.sendSequence(alarm.stimuli).then(function onSent () {
      console.info('[pavlok] sent ' + alarm.label + ' alarm: ' + notify.title);
      report(key, notify, true);
      return { sent: true, alarm: key };
    }).catch(function onError (err) {
      // let the next alarm emit retry instead of waiting out the cooldown
      lastSent[key] = previous;
      console.error('[pavlok] failed to send ' + alarm.label + ' alarm:', err.message);
      report(key, notify, false, err.message);
      return { sent: false, reason: 'error', error: err.message };
    }).finally(function done () {
      delete inFlight[key];
    });
  };

  pavlok.sendSequence = function sendSequence (stimuli) {
    return stimuli.reduce(function chain (promise, stimulus, index) {
      return promise.then(function next () {
        var wait = index > 0 && pavlok.stimulusGapMs > 0
          ? new Promise(function (resolve) { setTimeout(resolve, pavlok.stimulusGapMs); })
          : Promise.resolve();
        return wait.then(function send () {
          return pavlok.sendStimulus(stimulus.type, stimulus.value);
        });
      });
    }, Promise.resolve());
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

  pavlok.sendStimulus = function sendStimulus (type, value) {
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

    return pavlok.request(body);
  };

  // exposed for testing
  pavlok.request = function request (body) {
    return fetch(apiUrl, {
      method: 'POST'
      , headers: {
        Authorization: 'Bearer ' + token
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

  pavlok.status = function status () {
    var now = pavlok.now();
    var result = { enabled: true, alarms: {} };

    Object.keys(alarms).forEach(function eachAlarm (key) {
      var alarm = alarms[key];
      var last = lastSent[key] || 0;
      result.alarms[key] = {
        label: alarm.label
        , cooldownMins: alarm.cooldown / 60000
        , stimuli: alarm.stimuli
        , lastSent: last || null
        , cooldownRemainingMins: last ? Math.max(0, Math.ceil((alarm.cooldown - (now - last)) / 60000)) : 0
      };
    });

    return result;
  };

  return pavlok;
}

module.exports = init;
