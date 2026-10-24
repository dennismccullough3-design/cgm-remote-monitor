'use strict';

var times = require('../times');

var COLLECTION = 'pavlok_log';
var RETENTION_DAYS = 365;

// Records every Pavlok trigger sent by an alarm, so the admin page can show
// how often each alarm has fired the watch. Entries expire after a year.
function init (env, ctx) {

  function api () {
    return ctx.store.collection(env.pavlok_log_collection || COLLECTION);
  }

  var pavloklog = { };

  pavloklog.ensureIndexes = function ensureIndexes () {
    return api().createIndex({ date: 1 }, { expireAfterSeconds: times.days(RETENTION_DAYS).secs })
      .catch(function (err) {
        console.error('[pavlok] unable to create log index:', err.message);
      });
  };

  pavloklog.record = function record (result) {
    var doc = {
      date: new Date()
      , alarm: result.alarm
      , label: result.label
      , title: result.title
      , sent: !!result.sent
      , watches: (result.watches || []).map(function eachWatch (w) {
        var entry = { watch: w.watch, name: w.name, sent: !!w.sent, type: w.type, value: w.value };
        if (w.error) {
          entry.error = String(w.error).slice(0, 200);
        }
        return entry;
      })
    };

    return api().insertOne(doc).catch(function (err) {
      console.error('[pavlok] unable to write log entry:', err.message);
    });
  };

  pavloklog.summary = async function summary (labels, now) {
    now = now || Date.now();
    var since = {
      day: new Date(now - times.days(1).msecs)
      , week: new Date(now - times.days(7).msecs)
      , month: new Date(now - times.days(30).msecs)
    };

    function sentSince (date) {
      return { $sum: { $cond: [{ $and: ['$sent', { $gte: ['$date', date] }] }, 1, 0] } };
    }

    var grouped = await api().aggregate([
      {
        $group: {
          _id: '$alarm'
          , last24h: sentSince(since.day)
          , last7d: sentSince(since.week)
          , last30d: sentSince(since.month)
          , total: { $sum: { $cond: ['$sent', 1, 0] } }
          , failed: { $sum: { $cond: ['$sent', 0, 1] } }
          , lastSent: { $max: { $cond: ['$sent', '$date', null] } }
        }
      }
    ]).toArray();

    var counts = Object.keys(labels || {}).map(function eachAlarm (key) {
      var row = grouped.find(function (g) { return g._id === key; }) || {};
      return {
        alarm: key
        , label: labels[key]
        , last24h: row.last24h || 0
        , last7d: row.last7d || 0
        , last30d: row.last30d || 0
        , total: row.total || 0
        , failed: row.failed || 0
        , lastSent: row.lastSent || null
      };
    });

    var recent = await api().find({}, { projection: { _id: 0 } })
      .sort({ date: -1 })
      .limit(25)
      .toArray();

    return { counts: counts, recent: recent, retentionDays: RETENTION_DAYS };
  };

  return pavloklog;
}

module.exports = init;
