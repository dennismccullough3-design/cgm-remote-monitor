'use strict';

var should = require('should');
var levels = require('../lib/levels');

describe('pavlok', function ( ) {

  function create (settings) {
    var pavlok = require('../lib/plugins/pavlok')({
      extendedSettings: { pavlok: Object.assign({ apiToken: 'test-token' }, settings) }
    });
    var sent = [];
    var clock = 1000000000000;

    pavlok.now = function () { return clock; };
    pavlok.request = function (watch, body) {
      sent.push({ watch: watch.id, type: body.stimulus.stimulusType, value: body.stimulus.stimulusValue });
      return Promise.resolve({ status: 200 });
    };

    return {
      pavlok: pavlok
      , sent: sent
      , advanceMins: function (mins) { clock += mins * 60 * 1000; }
    };
  }

  function createTwo (settings) {
    return create(Object.assign({ apiToken2: 'second-token', name2: 'Mom' }, settings));
  }

  function alarm (eventName, level) {
    return { eventName: eventName, level: level, title: 'test', message: 'test', plugin: { name: 'simplealarms' } };
  }

  it('is disabled without a token', function () {
    should.not.exist(require('../lib/plugins/pavlok')({ extendedSettings: {} }));
    should.not.exist(require('../lib/plugins/pavlok')({ extendedSettings: { pavlok: { apiToken: '  ' } } }));
  });

  it('sends each watch its own token as a bearer token, even if pasted with a Bearer prefix', async function () {
    var pavlok = require('../lib/plugins/pavlok')({
      extendedSettings: { pavlok: { apiToken: 'Bearer abc.def', apiToken2: 12345 } }
    });
    var originalFetch = global.fetch;
    var auth = [];
    global.fetch = function (url, options) {
      auth.push(options.headers.Authorization);
      return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve('{}'); } });
    };
    try {
      await pavlok.sendTest('all', 'beep', 10);
    } finally {
      global.fetch = originalFetch;
    }
    auth.should.eql(['Bearer abc.def', 'Bearer 12345']);
  });

  it('works with only the second token set', function () {
    var pavlok = require('../lib/plugins/pavlok')({ extendedSettings: { pavlok: { apiToken2: 'x' } } });
    pavlok.status().watches.map(function (w) { return w.id; }).should.eql(['2']);
  });

  it('zaps at 100% for low and urgent low', async function () {
    var t = create();
    await t.pavlok.handleNotification(alarm('low', levels.WARN));
    await t.pavlok.handleNotification(alarm('low', levels.URGENT));
    t.sent.should.eql([
      { watch: '1', type: 'zap', value: 100 }
      , { watch: '1', type: 'zap', value: 100 }
    ]);
  });

  it('only vibrates at 100% for high and urgent high', async function () {
    var t = create();
    await t.pavlok.handleNotification(alarm('high', levels.WARN));
    await t.pavlok.handleNotification(alarm('high', levels.URGENT));
    t.sent.should.eql([
      { watch: '1', type: 'vibe', value: 100 }
      , { watch: '1', type: 'vibe', value: 100 }
    ]);
  });

  it('vibrates at 100% for no CGM data (stale data) alarms', async function () {
    var t = create();
    (await t.pavlok.handleNotification(alarm('timeago', levels.WARN))).alarm.should.equal('noData');
    (await t.pavlok.handleNotification(alarm('timeago', levels.URGENT))).alarm.should.equal('urgentNoData');
    t.sent.should.eql([
      { watch: '1', type: 'vibe', value: 100 }
      , { watch: '1', type: 'vibe', value: 100 }
    ]);
  });

  it('ignores non-alarm notifications', async function () {
    var t = create();
    await t.pavlok.handleNotification(alarm('low', levels.INFO));
    await t.pavlok.handleNotification(alarm(undefined, levels.URGENT));
    await t.pavlok.handleNotification({ clear: true, title: 'All Clear' });
    await t.pavlok.handleNotification(Object.assign(alarm('low', levels.URGENT), { isAnnouncement: true }));
    t.sent.length.should.equal(0);
  });

  it('applies the default cooldown for each alarm type', async function () {
    var expectations = [
      { eventName: 'low', level: levels.URGENT, mins: 5 }
      , { eventName: 'low', level: levels.WARN, mins: 10 }
      , { eventName: 'high', level: levels.WARN, mins: 30 }
      , { eventName: 'high', level: levels.URGENT, mins: 30 }
      , { eventName: 'timeago', level: levels.WARN, mins: 30 }
      , { eventName: 'timeago', level: levels.URGENT, mins: 30 }
    ];

    for (var e of expectations) {
      var t = create();
      (await t.pavlok.handleNotification(alarm(e.eventName, e.level))).sent.should.equal(true);
      t.advanceMins(e.mins - 1);
      (await t.pavlok.handleNotification(alarm(e.eventName, e.level))).skipped['1'].should.equal('cooldown');
      t.advanceMins(1);
      (await t.pavlok.handleNotification(alarm(e.eventName, e.level))).sent.should.equal(true);
    }
  });

  it('fires an urgent low right away even while low is cooling down', async function () {
    var t = create();
    await t.pavlok.handleNotification(alarm('low', levels.WARN));
    t.advanceMins(2);
    (await t.pavlok.handleNotification(alarm('low', levels.URGENT))).sent.should.equal(true);
  });

  it('allows the cooldowns to be configured', async function () {
    var t = create({ lowCooldown: 1 });
    await t.pavlok.handleNotification(alarm('low', levels.WARN));
    t.advanceMins(1);
    (await t.pavlok.handleNotification(alarm('low', levels.WARN))).sent.should.equal(true);
  });

  it('retries on the next alarm when sending fails', async function () {
    var t = create();
    var request = t.pavlok.request;
    t.pavlok.request = function () { return Promise.reject(new Error('network down')); };
    var result = await t.pavlok.handleNotification(alarm('low', levels.WARN));
    result.sent.should.equal(false);
    result.watches[0].error.should.equal('network down');

    t.pavlok.request = request;
    (await t.pavlok.handleNotification(alarm('low', levels.WARN))).sent.should.equal(true);
  });

  describe('two watches', function () {

    it('sends every alarm to both watches', async function () {
      var t = createTwo();
      var result = await t.pavlok.handleNotification(alarm('low', levels.URGENT));
      t.sent.should.eql([
        { watch: '1', type: 'zap', value: 100 }
        , { watch: '2', type: 'zap', value: 100 }
      ]);
      result.watches.map(function (w) { return w.name; }).should.eql(['Watch 1', 'Mom']);
    });

    it('still alerts one watch when the other fails, and retries only the failed one', async function () {
      var t = createTwo();
      var request = t.pavlok.request;
      t.pavlok.request = function (watch, body) {
        return watch.id === '2' ? Promise.reject(new Error('401')) : request(watch, body);
      };

      var first = await t.pavlok.handleNotification(alarm('low', levels.WARN));
      first.sent.should.equal(true);
      first.watches[1].should.containEql({ watch: '2', sent: false, error: '401' });

      t.pavlok.request = request;
      t.advanceMins(1);
      var second = await t.pavlok.handleNotification(alarm('low', levels.WARN));
      second.watches.map(function (w) { return w.watch; }).should.eql(['2']);
      second.skipped['1'].should.equal('cooldown');
    });

    it('sends manual tests to one watch or all', async function () {
      var t = createTwo();
      await t.pavlok.sendTest('2', 'vibe', 40);
      await t.pavlok.sendTest('all', 'beep', 10);
      t.sent.should.eql([
        { watch: '2', type: 'vibe', value: 40 }
        , { watch: '1', type: 'beep', value: 10 }
        , { watch: '2', type: 'beep', value: 10 }
      ]);
      await t.pavlok.sendTest('3', 'beep', 10).should.be.rejected();
    });

  });

  describe('settings from the admin page', function () {

    it('turns all alarms off for one watch', async function () {
      var t = createTwo();
      t.pavlok.applySettings({ watches: { '2': { enabled: false } } });
      var result = await t.pavlok.handleNotification(alarm('low', levels.URGENT));
      t.sent.should.eql([{ watch: '1', type: 'zap', value: 100 }]);
      result.skipped['2'].should.equal('turned off');
    });

    it('pauses a watch and resumes it automatically', async function () {
      var t = create();
      t.pavlok.applySettings({ watches: { '1': { pauseMins: 60 } } });
      t.pavlok.status().watches[0].paused.should.equal(true);

      (await t.pavlok.handleNotification(alarm('low', levels.URGENT))).skipped['1'].should.equal('paused');
      t.advanceMins(60);
      (await t.pavlok.handleNotification(alarm('low', levels.URGENT))).sent.should.equal(true);
      t.pavlok.status().watches[0].paused.should.equal(false);
    });

    it('resumes a paused watch right away', async function () {
      var t = create();
      t.pavlok.applySettings({ watches: { '1': { pauseMins: 60 } } });
      t.pavlok.applySettings({ watches: { '1': { pauseMins: 0 } } });
      (await t.pavlok.handleNotification(alarm('low', levels.URGENT))).sent.should.equal(true);
    });

    it('turns off a single alarm and changes strength per watch', async function () {
      var t = createTwo();
      t.pavlok.applySettings({ watches: {
        '1': { alarms: { high: { enabled: false } } }
        , '2': { alarms: { low: { strength: 30 } } }
      } });

      await t.pavlok.handleNotification(alarm('high', levels.WARN));
      await t.pavlok.handleNotification(alarm('low', levels.WARN));
      t.sent.should.eql([
        { watch: '2', type: 'vibe', value: 100 }
        , { watch: '1', type: 'zap', value: 100 }
        , { watch: '2', type: 'zap', value: 30 }
      ]);
    });

    it('sends nothing and logs nothing when every watch is off', async function () {
      var t = createTwo();
      var logged = [];
      t.pavlok.onResult = function (r) { logged.push(r); };
      t.pavlok.applySettings({ watches: { '1': { enabled: false }, '2': { pauseMins: 30 } } });
      var result = await t.pavlok.handleNotification(alarm('low', levels.URGENT));
      result.sent.should.equal(false);
      result.reason.should.equal('skipped');
      t.sent.length.should.equal(0);
      logged.length.should.equal(0);
    });

    it('manual tests still work while a watch is off', async function () {
      var t = create();
      t.pavlok.applySettings({ watches: { '1': { enabled: false } } });
      (await t.pavlok.sendTest('1', 'vibe', 20))[0].sent.should.equal(true);
    });

    it('ignores invalid settings', function () {
      var t = create();
      t.pavlok.applySettings({ watches: {
        '1': { name: '   ', enabled: 'no', pauseMins: -5, alarms: { low: { strength: 500, enabled: 'off' }, bogus: { enabled: false } } }
        , '9': { enabled: false }
      } });
      var settings = t.pavlok.getSettings();
      settings.watches['1'].should.containEql({ name: 'Watch 1', enabled: true, pausedUntil: null });
      settings.watches['1'].alarms.low.should.containEql({ enabled: true, strength: 100 });
      should.not.exist(settings.watches['9']);
    });

    it('caps a pause at 7 days', function () {
      var t = create();
      var now = t.pavlok.now();
      t.pavlok.applySettings({ watches: { '1': { pauseMins: 999999 } } });
      t.pavlok.getSettings().watches['1'].pausedUntil.should.equal(now + 7 * 24 * 60 * 60 * 1000);
    });

    describe('schedules', function () {

      // the test clock starts on Saturday 2001-09-08 at 20:46 in Chicago
      function scheduled (schedule) {
        var t = createTwo({ timezone: 'America/Chicago' });
        t.pavlok.applySettings({ watches: { '1': { alarms: { low: { schedule: schedule } } } } });
        return t;
      }

      it('sends only inside a daytime window', async function () {
        var t = scheduled({ mode: 'window', start: '08:00', end: '22:00', days: [0, 1, 2, 3, 4, 5, 6] });
        (await t.pavlok.handleNotification(alarm('low', levels.WARN))).watches.length.should.equal(2);
        t.advanceMins(120);
        var later = await t.pavlok.handleNotification(alarm('low', levels.WARN));
        later.skipped['1'].should.equal('outside schedule');
        later.watches.map(function (w) { return w.watch; }).should.eql(['2']);
      });

      it('runs an overnight window into the next morning', async function () {
        var t = scheduled({ mode: 'window', start: '22:00', end: '07:00', days: [6] });
        (await t.pavlok.handleNotification(alarm('low', levels.WARN))).skipped['1'].should.equal('outside schedule');
        t.advanceMins(75);
        (await t.pavlok.handleNotification(alarm('low', levels.WARN))).watches[0].watch.should.equal('1');
        t.advanceMins(240);
        t.pavlok.status().watches[0].inScheduleNow.low.should.equal(true);
        t.advanceMins(300);
        t.pavlok.status().watches[0].inScheduleNow.low.should.equal(false);
      });

      it('limits an alarm to chosen days', async function () {
        var t = scheduled({ mode: 'window', start: '00:00', end: '00:00', days: [0] });
        (await t.pavlok.handleNotification(alarm('low', levels.WARN))).skipped['1'].should.equal('outside schedule');
        t.advanceMins(4 * 60);
        t.pavlok.status().watches[0].inScheduleNow.low.should.equal(true);
      });

      it('leaves other alarms on the same watch alone', async function () {
        var t = scheduled({ mode: 'window', start: '08:00', end: '09:00', days: [1] });
        (await t.pavlok.handleNotification(alarm('low', levels.URGENT))).watches.length.should.equal(2);
      });

      it('uses the time zone saved from the admin page', function () {
        var t = scheduled({ mode: 'window', start: '08:00', end: '22:00', days: [6] });
        t.pavlok.status().watches[0].inScheduleNow.low.should.equal(true);
        t.pavlok.applySettings({ timezone: 'Asia/Tokyo' });
        t.pavlok.status().timezone.should.equal('Asia/Tokyo');
        t.pavlok.status().watches[0].inScheduleNow.low.should.equal(false);
      });

      it('ignores an invalid time zone or schedule', function () {
        var t = scheduled({ mode: 'window', start: '08:00', end: '22:00', days: [6] });
        t.pavlok.applySettings({ timezone: 'Mars/Olympus', watches: { '1': { alarms: { low: {
          schedule: { mode: 'sometimes', start: '25:00', end: 'noon', days: [] }
        } } } } });
        var settings = t.pavlok.getSettings();
        settings.timezone.should.equal('America/Chicago');
        settings.watches['1'].alarms.low.schedule.should.eql({ mode: 'window', start: '08:00', end: '22:00', days: [6] });
        t.pavlok.isValidTimeZone('Mars/Olympus').should.equal(false);
      });

      it('defaults to any time', async function () {
        var t = create({ timezone: 'America/Chicago' });
        t.pavlok.getSettings().watches['1'].alarms.high.schedule.mode.should.equal('always');
        (await t.pavlok.handleNotification(alarm('high', levels.WARN))).sent.should.equal(true);
      });

    });

    describe('cooldowns', function () {

      it('starts each watch with the default cooldowns', function () {
        var t = createTwo({ lowCooldown: 12 });
        var settings = t.pavlok.getSettings();
        settings.watches['1'].alarms.low.cooldownMins.should.equal(12);
        settings.watches['2'].alarms.urgentLow.cooldownMins.should.equal(5);
        t.pavlok.status().alarms.find(function (a) { return a.key === 'low'; }).defaultCooldownMins.should.equal(12);
      });

      it('uses the cooldown set for each watch', async function () {
        var t = createTwo();
        t.pavlok.applySettings({ watches: { '1': { alarms: { low: { cooldownMins: 3 } } } } });

        await t.pavlok.handleNotification(alarm('low', levels.WARN));
        t.advanceMins(3);
        var result = await t.pavlok.handleNotification(alarm('low', levels.WARN));
        result.watches.map(function (w) { return w.watch; }).should.eql(['1']);
        result.skipped['2'].should.equal('cooldown');
        t.pavlok.status().watches[1].cooldownRemainingMins.low.should.equal(7);
      });

      it('allows no cooldown at all', async function () {
        var t = create();
        t.pavlok.applySettings({ watches: { '1': { alarms: { high: { cooldownMins: 0 } } } } });
        await t.pavlok.handleNotification(alarm('high', levels.WARN));
        (await t.pavlok.handleNotification(alarm('high', levels.WARN))).sent.should.equal(true);
      });

      it('takes effect for an alarm already cooling down', async function () {
        var t = create();
        await t.pavlok.handleNotification(alarm('high', levels.WARN));
        t.advanceMins(15);
        (await t.pavlok.handleNotification(alarm('high', levels.WARN))).skipped['1'].should.equal('cooldown');
        t.pavlok.applySettings({ watches: { '1': { alarms: { high: { cooldownMins: 15 } } } } });
        (await t.pavlok.handleNotification(alarm('high', levels.WARN))).sent.should.equal(true);
      });

      it('ignores invalid cooldowns', function () {
        var t = create();
        [-1, 1441, 2.5, 'ten', null, ''].forEach(function (value) {
          t.pavlok.applySettings({ watches: { '1': { alarms: { low: { cooldownMins: value } } } } });
        });
        t.pavlok.getSettings().watches['1'].alarms.low.cooldownMins.should.equal(10);
        t.pavlok.applySettings({ watches: { '1': { alarms: { low: { cooldownMins: 1440 } } } } });
        t.pavlok.getSettings().watches['1'].alarms.low.cooldownMins.should.equal(1440);
      });

    });

    it('restores saved settings, including names', async function () {
      var t = createTwo();
      t.pavlok.applySettings({ watches: { '2': { name: 'Caregiver', alarms: { urgentLow: { strength: 60 } } } } });
      var saved = JSON.parse(JSON.stringify(t.pavlok.getSettings()));

      var restarted = createTwo();
      restarted.pavlok.applySettings(saved);
      await restarted.pavlok.handleNotification(alarm('low', levels.URGENT));
      restarted.sent[1].should.eql({ watch: '2', type: 'zap', value: 60 });
      restarted.pavlok.status().watches[1].name.should.equal('Caregiver');
    });

  });

  it('reports each alarm trigger with per-watch results to the log', async function () {
    var t = createTwo();
    var results = [];
    t.pavlok.onResult = function (result) { results.push(result); };

    await t.pavlok.handleNotification(alarm('low', levels.URGENT));
    t.pavlok.request = function () { return Promise.reject(new Error('network down')); };
    await t.pavlok.handleNotification(alarm('high', levels.WARN));
    await t.pavlok.sendTest('all', 'beep', 10);

    results.length.should.equal(2);
    results[0].should.containEql({ alarm: 'urgentLow', label: 'Urgent Low', sent: true });
    results[0].watches.length.should.equal(2);
    results[1].should.containEql({ alarm: 'high', sent: false });
    results[1].watches[0].error.should.equal('network down');
  });

  it('keeps sending when the log throws', async function () {
    var t = create();
    t.pavlok.onResult = function () { throw new Error('log broken'); };
    (await t.pavlok.handleNotification(alarm('low', levels.WARN))).sent.should.equal(true);
  });

  it('validates manual stimuli', async function () {
    var t = create();
    should.not.exist(t.pavlok.validateStimulus('zap', 1));
    should.not.exist(t.pavlok.validateStimulus('beep', 100));
    should.exist(t.pavlok.validateStimulus('shock', 50));
    should.exist(t.pavlok.validateStimulus('vibe', 0));
    should.exist(t.pavlok.validateStimulus('vibe', 101));
    should.exist(t.pavlok.validateStimulus('vibe', 12.5));

    await t.pavlok.sendStimulus('1', 'vibe', 40);
    t.sent.should.eql([{ watch: '1', type: 'vibe', value: 40 }]);
    await t.pavlok.sendStimulus('1', 'zap', 500).should.be.rejected();
  });

  it('is triggered by pushnotify for enabled low/high and stale data alarms', function () {
    var env = require('../lib/server/env')();
    var ctx = { levels: levels };
    var handled = [];

    ctx.notifications = require('../lib/notifications')(env, ctx);
    ctx.pavlok = { handleNotification: function (notify) { handled.push(notify); } };
    ctx.pushnotify = require('../lib/server/pushnotify')(env, ctx);

    ctx.pushnotify.emitNotification(alarm('low', levels.URGENT));
    ctx.pushnotify.emitNotification(Object.assign(alarm('timeago', levels.WARN), { plugin: { name: 'timeago' }, group: 'Time Ago' }));
    ctx.pushnotify.emitNotification({ clear: true, title: 'All Clear', message: 'cleared' });

    handled.map(function (n) { return n.eventName; }).should.eql(['low', 'timeago']);
  });

});
