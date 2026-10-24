'use strict';

var pavlok = {
  name: 'pavlok'
  , label: 'Pavlok watch'
  , pluginType: 'admin'
};

function init () {
  return pavlok;
}

module.exports = init;

var PAUSE_OPTIONS = [
  { mins: 30, label: '30 minutes' }
  , { mins: 60, label: '1 hour' }
  , { mins: 120, label: '2 hours' }
  , { mins: 240, label: '4 hours' }
  , { mins: 480, label: '8 hours' }
  , { mins: 720, label: '12 hours' }
  , { mins: 1440, label: '24 hours' }
];

var DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

var stimuli = [
  { type: 'zap', name: 'Test zap', buttonLabel: 'Send zap', defaultValue: 50 }
  , { type: 'vibe', name: 'Test vibration', buttonLabel: 'Send vibration', defaultValue: 100 }
  , { type: 'beep', name: 'Test beep', buttonLabel: 'Send beep', defaultValue: 100 }
];

pavlok.css =
  '.pavlok-watch { border: 1px solid #555; padding: 6px 10px; margin: 6px 0; }' +
  '.pavlok-alarms { border-collapse: collapse; margin: 6px 0; }' +
  '.pavlok-alarms th, .pavlok-alarms td { border: 1px solid #555; padding: 3px 8px; }' +
  '.pavlok-alarms input[type=number] { width: 4em; }' +
  '.pavlok-warning { color: #e66; font-weight: bold; }' +
  '.pavlok-schedule label { margin-right: 4px; white-space: nowrap; }' +
  '.pavlok-inactive { color: #e6a700; }';

var status = null;

function escapeHtml (text) {
  return $('<div>').text(text === undefined || text === null ? '' : String(text)).html();
}

function watchWarnings (translate, watch) {
  var warnings = [];
  if (!watch.enabled) {
    warnings.push(translate('All alarms are turned OFF for this watch'));
  } else if (watch.paused) {
    warnings.push(translate('Paused until %1', { params: [new Date(watch.pausedUntil).toLocaleString()] }));
  }
  var off = status.alarms.filter(function (a) { return !watch.alarms[a.key].enabled; });
  if (watch.enabled && off.length > 0) {
    warnings.push(translate('Turned off') + ': ' + off.map(function (a) { return translate(a.label); }).join(', '));
  }
  var outside = status.alarms.filter(function (a) {
    return watch.alarms[a.key].enabled && !watch.inScheduleNow[a.key];
  });
  if (watch.enabled && !watch.paused && outside.length > 0) {
    warnings.push(translate('Outside its schedule right now') + ': ' + outside.map(function (a) { return translate(a.label); }).join(', '));
  }
  return warnings;
}

function renderSettings (client) {
  var translate = client.translate;
  var prefix = 'admin_pavlok_w';

  var html = status.watches.map(function eachWatch (watch) {
    var id = prefix + watch.id;
    var warnings = watchWarnings(translate, watch);

    var pauseSelect = '<select id="' + id + '_pause">' +
      '<option value="">' + translate(watch.paused ? 'Keep paused' : 'Not paused') + '</option>' +
      (watch.paused ? '<option value="0">' + translate('Resume now') + '</option>' : '') +
      PAUSE_OPTIONS.map(function (p) {
        return '<option value="' + p.mins + '">' + translate('Pause for %1', { params: [translate(p.label)] }) + '</option>';
      }).join('') +
      '</select>';

    var rows = status.alarms.map(function eachAlarm (alarm) {
      var a = watch.alarms[alarm.key];
      var remaining = watch.cooldownRemainingMins[alarm.key];
      var sid = id + '_' + alarm.key + '_schedule';
      var windowed = a.schedule.mode === 'window';
      var schedule = '<div class="pavlok-schedule">' +
        '<select id="' + sid + '_mode" data-schedule="' + sid + '">' +
        '<option value="always"' + (windowed ? '' : ' selected') + '>' + translate('Any time') + '</option>' +
        '<option value="window"' + (windowed ? ' selected' : '') + '>' + translate('Only during') + '</option>' +
        '</select>' +
        '<span id="' + sid + '_window"' + (windowed ? '' : ' style="display:none"') + '> ' +
        '<input type="time" id="' + sid + '_start" value="' + a.schedule.start + '"/> ' + translate('to') + ' ' +
        '<input type="time" id="' + sid + '_end" value="' + a.schedule.end + '"/><br/>' +
        DAY_LABELS.map(function (label, day) {
          return '<label><input type="checkbox" id="' + sid + '_day' + day + '"' +
            (a.schedule.days.indexOf(day) !== -1 ? ' checked' : '') + '/>' + translate(label) + '</label>';
        }).join('') +
        (windowed && !watch.inScheduleNow[alarm.key] ? '<br/><span class="pavlok-inactive">' + translate('Not active right now') + '</span>' : '') +
        '</span></div>';
      return '<tr>' +
        '<td>' + escapeHtml(translate(alarm.label)) + '</td>' +
        '<td><input type="checkbox" id="' + id + '_' + alarm.key + '_on"' + (a.enabled ? ' checked' : '') + '/></td>' +
        '<td>' + escapeHtml(alarm.type) + '</td>' +
        '<td><input type="number" class="pavlok-strength" min="1" max="100" step="1" id="' + id + '_' + alarm.key + '_strength" value="' + a.strength + '"/>%</td>' +
        '<td>' + schedule + '</td>' +
        '<td><input type="number" class="pavlok-cooldown" min="0" max="1440" step="1" id="' + id + '_' + alarm.key + '_cooldown" value="' + a.cooldownMins + '"/> min' +
        (a.cooldownMins !== alarm.defaultCooldownMins ? '<br/><small>' + translate('default %1 min', { params: [alarm.defaultCooldownMins] }) + '</small>' : '') +
        (remaining > 0 ? '<br/><small>' + translate('%1 min left', { params: [remaining] }) + '</small>' : '') + '</td>' +
        '</tr>';
    }).join('');

    return '<div class="pavlok-watch">' +
      '<label>' + translate('Name') + ': <input id="' + id + '_name" maxlength="40" value="' + escapeHtml(watch.name) + '"/></label> ' +
      '<label><input type="checkbox" id="' + id + '_enabled"' + (watch.enabled ? ' checked' : '') + '/> ' +
      translate('Alarms on for this watch') + '</label><br/>' +
      pauseSelect +
      (warnings.length ? '<div class="pavlok-warning">' + warnings.map(escapeHtml).join('<br/>') + '</div>' : '') +
      '<table class="pavlok-alarms"><tr>' +
      '<th>' + translate('Alarm') + '</th><th>' + translate('On') + '</th><th>' + translate('Sends') + '</th>' +
      '<th>' + translate('Strength') + '</th><th>' + translate('When') + '</th><th>' + translate('Cooldown') + '</th></tr>' +
      rows + '</table></div>';
  }).join('');

  var browserZone = '';
  try {
    browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch (err) {
    browserZone = '';
  }
  var zoneHtml = '<label>' + translate('Time zone for schedules') + ': ' +
    '<input id="admin_pavlok_timezone" size="24" value="' + escapeHtml(status.timezone) + '"/></label>' +
    (browserZone && browserZone !== status.timezone
      ? ' <a href="#" id="admin_pavlok_use_browser_zone">' + translate('Use %1 (this device)', { params: [escapeHtml(browserZone)] }) + '</a>'
      : '') +
    '<br/>';

  $('#admin_' + pavlok.name + '_0_html').html(zoneHtml + html);

  $('#admin_pavlok_use_browser_zone').on('click', function useBrowserZone (event) {
    event.preventDefault();
    $('#admin_pavlok_timezone').val(browserZone);
    $(this).remove();
  });
  $('#admin_' + pavlok.name + '_0_html select[data-schedule]').on('change', function onModeChange () {
    $('#' + $(this).data('schedule') + '_window').toggle($(this).val() === 'window');
  });
}

function renderWatchSelectors (client) {
  var translate = client.translate;
  var options = (status.watches.length > 1 ? '<option value="all">' + translate('All watches') + '</option>' : '') +
    status.watches.map(function (w) {
      return '<option value="' + w.id + '">' + escapeHtml(w.name) + '</option>';
    }).join('');

  stimuli.forEach(function (stimulus) {
    var $select = $('#admin_pavlok_' + stimulus.type + '_watch');
    var current = $select.val();
    $select.html(options);
    if (current && $select.find('option[value="' + current + '"]').length) {
      $select.val(current);
    }
  });
}

function showStatus (client, newStatus) {
  status = newStatus;
  renderSettings(client);
  renderWatchSelectors(client);
}

function loadStatus (client) {
  var translate = client.translate;
  var $status = $('#admin_' + pavlok.name + '_0_status');

  $.ajax('/api/v1/pavlok/status', {
    headers: client.headers()
  }).done(function success (newStatus) {
    showStatus(client, newStatus);
  }).fail(function fail (xhr) {
    var message = (xhr.responseJSON && xhr.responseJSON.message) || translate('Unable to reach Pavlok settings');
    $status.text(' ' + message);
  });
}

function collectSettings () {
  var watches = {};
  status.watches.forEach(function eachWatch (watch) {
    var id = 'admin_pavlok_w' + watch.id;
    var update = {
      name: $('#' + id + '_name').val()
      , enabled: $('#' + id + '_enabled').is(':checked')
      , alarms: {}
    };
    var pause = $('#' + id + '_pause').val();
    if (pause !== '') {
      update.pauseMins = Number(pause);
    }
    status.alarms.forEach(function eachAlarm (alarm) {
      var sid = id + '_' + alarm.key + '_schedule';
      update.alarms[alarm.key] = {
        enabled: $('#' + id + '_' + alarm.key + '_on').is(':checked')
        , strength: Number($('#' + id + '_' + alarm.key + '_strength').val())
        , cooldownMins: Number($('#' + id + '_' + alarm.key + '_cooldown').val())
        , schedule: {
          mode: $('#' + sid + '_mode').val()
          , start: $('#' + sid + '_start').val()
          , end: $('#' + sid + '_end').val()
          , days: DAY_LABELS.map(function (label, day) { return day; }).filter(function (day) {
            return $('#' + sid + '_day' + day).is(':checked');
          })
        }
      };
    });
    watches[watch.id] = update;
  });
  return { timezone: $('#admin_pavlok_timezone').val().trim(), watches: watches };
}

var settingsAction = {
  name: 'Watch settings'
  , description: 'Turn alarms on or off for each watch, pause a watch for a while, change how strong each alarm is, set how many minutes each alarm waits before it can go off again (cooldown), or limit an alarm to certain hours and days. A schedule that ends before it starts (for example 22:00 to 07:00) runs overnight. Changes take effect when you press Save.'
  , buttonLabel: 'Save settings'
  , preventClose: true
};

settingsAction.init = function init (client) {
  loadStatus(client);
};

settingsAction.code = function saveSettings (client) {
  var translate = client.translate;
  var $status = $('#admin_' + pavlok.name + '_0_status');

  if (!client.hashauth.isAuthenticated()) {
    alert(translate('Your device is not authenticated yet'));
    return;
  }
  if (!status) {
    return;
  }

  function outOfRange (selector, min, max) {
    return $('#admin_' + pavlok.name + '_0_html ' + selector).filter(function () {
      var value = $(this).val();
      var n = Number(value);
      return value === '' || !Number.isInteger(n) || n < min || n > max;
    }).length > 0;
  }
  if (outOfRange('input.pavlok-strength', 1, 100)) {
    alert(translate('Strength must be a whole number from 1 to 100'));
    return;
  }
  if (outOfRange('input.pavlok-cooldown', 0, 1440)) {
    alert(translate('Cooldown must be a whole number of minutes from 0 to 1440 (24 hours)'));
    return;
  }

  var settings = collectSettings();
  var badSchedule = Object.keys(settings.watches).some(function (id) {
    var alarms = settings.watches[id].alarms;
    return Object.keys(alarms).some(function (key) {
      var schedule = alarms[key].schedule;
      return schedule.mode === 'window' && (!/^\d\d:\d\d$/.test(schedule.start) || !/^\d\d:\d\d$/.test(schedule.end) || schedule.days.length === 0);
    });
  });
  if (badSchedule) {
    alert(translate('Each "Only during" schedule needs a start time, an end time and at least one day'));
    return;
  }

  $status.hide().text(' ' + translate('Saving ...')).fadeIn('slow');
  $.ajax({
    method: 'PUT'
    , url: '/api/v1/pavlok/settings'
    , headers: client.headers()
    , contentType: 'application/json'
    , data: JSON.stringify(settings)
  }).done(function success (newStatus) {
    showStatus(client, newStatus);
    $status.hide().text(' ' + translate('Saved %1', { params: [new Date().toLocaleTimeString()] })).fadeIn('slow');
  }).fail(function fail (xhr) {
    var message = (xhr.responseJSON && xhr.responseJSON.message) || translate('Error');
    $status.hide().text(' ' + message).fadeIn('slow');
    loadStatus(client);
  });
};

var testActions = stimuli.map(function toAction (stimulus, i) {
  var index = i + 1;
  var action = {
    name: stimulus.name
    , description: 'Sends a ' + stimulus.type + ' at the chosen strength. Works even if the watch is paused or its alarms are off.'
    , buttonLabel: stimulus.buttonLabel
    , preventClose: true
  };

  if (stimulus.type === 'zap') {
    action.confirmText = 'Send a zap to the Pavlok watch?';
  }

  action.init = function init (client) {
    var translate = client.translate;
    var id = 'admin_pavlok_' + stimulus.type + '_value';
    var controls =
      '<label>' + translate('Watch') + ': <select id="admin_pavlok_' + stimulus.type + '_watch"></select></label><br/>' +
      '<label for="' + id + '">' + translate('Strength') + ': ' +
      '<input type="range" id="' + id + '" min="1" max="100" step="1" value="' + stimulus.defaultValue + '"/> ' +
      '<span id="' + id + '_label">' + stimulus.defaultValue + '</span>%' +
      '</label><br/>';

    $('#admin_' + pavlok.name + '_' + index + '_html').html(controls);
    $('#' + id).on('input', function onInput () {
      $('#' + id + '_label').text($(this).val());
    });
    if (status) {
      renderWatchSelectors(client);
    }
  };

  action.code = function sendStimulus (client) {
    var translate = client.translate;
    var $status = $('#admin_' + pavlok.name + '_' + index + '_status');
    var value = Number($('#admin_pavlok_' + stimulus.type + '_value').val());
    var watch = $('#admin_pavlok_' + stimulus.type + '_watch').val() || 'all';

    if (!client.hashauth.isAuthenticated()) {
      alert(translate('Your device is not authenticated yet'));
      return;
    }

    function describe (result) {
      return (result.watches || []).map(function (w) {
        return w.name + ': ' + (w.sent ? translate('sent') : translate('failed') + (w.error ? ' (' + w.error + ')' : ''));
      }).join(', ');
    }

    $status.hide().text(' ' + translate('Sending ...')).fadeIn('slow');
    $.ajax({
      method: 'POST'
      , url: '/api/v1/pavlok/stimulus'
      , headers: client.headers()
      , contentType: 'application/json'
      , data: JSON.stringify({ type: stimulus.type, value: value, watch: watch })
    }).done(function success (result) {
      $status.hide().text(' ' + stimulus.type + ' ' + value + '% - ' + describe(result)).fadeIn('slow');
    }).fail(function fail (xhr) {
      var result = xhr.responseJSON || {};
      var message = result.watches ? describe(result) : (result.message || translate('Error'));
      $status.hide().text(' ' + message).fadeIn('slow');
    });
  };

  return action;
});

pavlok.actions = [settingsAction].concat(testActions);
