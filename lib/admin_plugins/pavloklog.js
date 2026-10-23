'use strict';

var pavloklog = {
  name: 'pavloklog'
  , label: 'Pavlok alarm log'
  , pluginType: 'admin'
};

function init () {
  return pavloklog;
}

module.exports = init;

pavloklog.actions = [
  {
    name: 'Alarm triggers'
    , description: 'How many times each alarm has triggered the Pavlok watch. Manual tests are not counted.'
    , buttonLabel: 'Refresh'
    , preventClose: true
  }
];

pavloklog.css =
  '.pavlok-log { border-collapse: collapse; margin: 6px 0; }' +
  '.pavlok-log th, .pavlok-log td { border: 1px solid #555; padding: 3px 8px; text-align: right; }' +
  '.pavlok-log th:first-child, .pavlok-log td:first-child { text-align: left; }' +
  '.pavlok-log .failed { color: #e66; }';

function escapeHtml (text) {
  return $('<div>').text(text === undefined || text === null ? '' : String(text)).html();
}

function formatDate (value) {
  return value ? new Date(value).toLocaleString() : '-';
}

function render (client, log) {
  var translate = client.translate;

  var countRows = log.counts.map(function eachCount (c) {
    return '<tr><td>' + escapeHtml(translate(c.label)) + '</td>' +
      '<td>' + c.last24h + '</td>' +
      '<td>' + c.last7d + '</td>' +
      '<td>' + c.last30d + '</td>' +
      '<td>' + c.total + '</td>' +
      '<td' + (c.failed ? ' class="failed"' : '') + '>' + c.failed + '</td>' +
      '<td>' + escapeHtml(formatDate(c.lastSent)) + '</td></tr>';
  }).join('');

  var countsTable = '<table class="pavlok-log"><tr>' +
    '<th>' + translate('Alarm') + '</th>' +
    '<th>' + translate('24 hours') + '</th>' +
    '<th>' + translate('7 days') + '</th>' +
    '<th>' + translate('30 days') + '</th>' +
    '<th>' + translate('Total') + '</th>' +
    '<th>' + translate('Failed') + '</th>' +
    '<th>' + translate('Last sent') + '</th>' +
    '</tr>' + countRows + '</table>';

  var recentRows = log.recent.map(function eachEntry (e) {
    var what = (e.stimuli || []).map(function (s) { return s.type + ' ' + s.value + '%'; }).join(' + ');
    var result = e.sent ? translate('Sent') : translate('Failed') + (e.error ? ': ' + e.error : '');
    return '<tr><td>' + escapeHtml(formatDate(e.date)) + '</td>' +
      '<td>' + escapeHtml(translate(e.label)) + '</td>' +
      '<td>' + escapeHtml(what) + '</td>' +
      '<td' + (e.sent ? '' : ' class="failed"') + '>' + escapeHtml(result) + '</td></tr>';
  }).join('');

  var recentTable = log.recent.length === 0
    ? '<p><i>' + translate('No alarms have triggered the watch yet.') + '</i></p>'
    : '<table class="pavlok-log"><tr>' +
      '<th>' + translate('Time') + '</th>' +
      '<th>' + translate('Alarm') + '</th>' +
      '<th>' + translate('Sent') + '</th>' +
      '<th>' + translate('Result') + '</th>' +
      '</tr>' + recentRows + '</table>';

  $('#admin_' + pavloklog.name + '_0_html').html(
    countsTable +
    '<b>' + translate('Most recent triggers') + '</b>' + recentTable +
    '<i>' + translate('Entries are kept for %1 days.', { params: [log.retentionDays] }) + '</i><br/>'
  );
}

function load (client) {
  var translate = client.translate;
  var $status = $('#admin_' + pavloklog.name + '_0_status');

  $status.hide().text(' ' + translate('Loading ...')).fadeIn('slow');
  $.ajax('/api/v1/pavlok/log', {
    headers: client.headers()
  }).done(function success (log) {
    render(client, log);
    $status.hide().text(' ' + translate('Updated %1', { params: [new Date().toLocaleTimeString()] })).fadeIn('slow');
  }).fail(function fail (xhr) {
    var message = (xhr.responseJSON && xhr.responseJSON.message) || translate('Error loading Pavlok log');
    $status.hide().text(' ' + message).fadeIn('slow');
  });
}

pavloklog.actions[0].init = function init (client) {
  load(client);
};

pavloklog.actions[0].code = function refresh (client) {
  load(client);
};
