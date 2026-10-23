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

var stimuli = [
  { type: 'zap', name: 'Test zap', buttonLabel: 'Send zap', defaultValue: 50 }
  , { type: 'vibe', name: 'Test vibration', buttonLabel: 'Send vibration', defaultValue: 100 }
  , { type: 'beep', name: 'Test beep', buttonLabel: 'Send beep', defaultValue: 100 }
];

pavlok.actions = stimuli.map(function toAction (stimulus, index) {
  var action = {
    name: stimulus.name
    , description: 'Sends a ' + stimulus.type + ' to the Pavlok watch at the chosen strength.'
    , buttonLabel: stimulus.buttonLabel
    , preventClose: true
  };

  if (stimulus.type === 'zap') {
    action.confirmText = 'Send a zap to the Pavlok watch?';
  }

  action.init = function init (client) {
    var translate = client.translate;
    var id = 'admin_pavlok_' + stimulus.type + '_value';
    var slider =
      '<label for="' + id + '">' + translate('Strength') + ': ' +
      '<input type="range" id="' + id + '" min="1" max="100" step="1" value="' + stimulus.defaultValue + '"/> ' +
      '<span id="' + id + '_label">' + stimulus.defaultValue + '</span>%' +
      '</label><br/>';

    $('#admin_' + pavlok.name + '_' + index + '_html').html(slider);
    $('#' + id).on('input', function onInput () {
      $('#' + id + '_label').text($(this).val());
    });

    if (index === 0) {
      loadStatus(client);
    }
  };

  action.code = function sendStimulus (client) {
    var translate = client.translate;
    var $status = $('#admin_' + pavlok.name + '_' + index + '_status');
    var value = Number($('#admin_pavlok_' + stimulus.type + '_value').val());

    if (!client.hashauth.isAuthenticated()) {
      alert(translate('Your device is not authenticated yet'));
      return;
    }

    $status.hide().text(' ' + translate('Sending ...')).fadeIn('slow');
    $.ajax({
      method: 'POST'
      , url: '/api/v1/pavlok/stimulus'
      , headers: client.headers()
      , contentType: 'application/json'
      , data: JSON.stringify({ type: stimulus.type, value: value })
    }).done(function success () {
      $status.hide().text(' ' + translate('Sent %1 at %2%', { params: [stimulus.type, value] })).fadeIn('slow');
    }).fail(function fail (xhr) {
      var message = (xhr.responseJSON && xhr.responseJSON.message) || translate('Error');
      $status.hide().text(' ' + message).fadeIn('slow');
    });
  };

  return action;
});

function loadStatus (client) {
  var translate = client.translate;
  var $status = $('#admin_' + pavlok.name + '_0_status');

  $.ajax('/api/v1/pavlok/status', {
    headers: client.headers()
  }).done(function success (status) {
    var lines = Object.keys(status.alarms).map(function eachAlarm (key) {
      var alarm = status.alarms[key];
      var what = alarm.stimuli.map(function (s) { return s.type + ' ' + s.value + '%'; }).join(' + ');
      var cooldown = alarm.cooldownRemainingMins > 0
        ? ' (' + translate('cooling down, %1 min left', { params: [alarm.cooldownRemainingMins] }) + ')'
        : '';
      return '<li>' + translate(alarm.label) + ': ' + what + ', ' +
        translate('cooldown %1 min', { params: [alarm.cooldownMins] }) + cooldown + '</li>';
    });
    $('#admin_' + pavlok.name + '_0_html').prepend(
      '<div>' + translate('Automatic alarms') + ':<ul>' + lines.join('') + '</ul></div>'
    );
  }).fail(function fail (xhr) {
    var message = (xhr.responseJSON && xhr.responseJSON.message) || translate('Unable to reach Pavlok settings');
    $status.text(' ' + message);
  });
}
