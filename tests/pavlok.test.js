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

    pavlok.stimulusGapMs = 0;
    pavlok.now = function () { return clock; };
    pavlok.request = function (body) {
      sent.push(body.stimulus);
      return Promise.resolve({ status: 200 });
    };

    return {
      pavlok: pavlok
      , sent: sent
      , advanceMins: function (mins) { clock += mins * 60 * 1000; }
    };
  }

  function alarm (eventName, level) {
    return { eventName: eventName, level: level, title: 'test', message: 'test', plugin: { name: 'simplealarms' } };
  }

  it('is disabled without a token', function () {
    should.not.exist(require('../lib/plugins/pavlok')({ extendedSettings: {} }));
    should.not.exist(require('../lib/plugins/pavlok')({ extendedSettings: { pavlok: { apiToken: '  ' } } }));
  });

  it('sends the token as a bearer token, even if pasted with a Bearer prefix', async function () {
    var pavlok = require('../lib/plugins/pavlok')({
      extendedSettings: { pavlok: { apiToken: 'Bearer abc.def' } }
    });
    var originalFetch = global.fetch;
    var headers;
    global.fetch = function (url, options) {
      headers = options.headers;
      return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve('{}'); } });
    };
    try {
      await pavlok.sendStimulus('beep', 10);
    } finally {
      global.fetch = originalFetch;
    }
    headers.Authorization.should.equal('Bearer abc.def');
  });

  it('zaps at 100% for low and urgent low', async function () {
    var t = create();
    await t.pavlok.handleNotification(alarm('low', levels.WARN));
    await t.pavlok.handleNotification(alarm('low', levels.URGENT));
    t.sent.should.eql([
      { stimulusType: 'zap', stimulusValue: 100 }
      , { stimulusType: 'zap', stimulusValue: 100 }
    ]);
  });

  it('only vibrates at 100% for high and urgent high', async function () {
    var t = create();
    await t.pavlok.handleNotification(alarm('high', levels.WARN));
    await t.pavlok.handleNotification(alarm('high', levels.URGENT));
    t.sent.should.eql([
      { stimulusType: 'vibe', stimulusValue: 100 }
      , { stimulusType: 'vibe', stimulusValue: 100 }
    ]);
  });

  it('vibrates at 100% for no CGM data (stale data) alarms', async function () {
    var t = create();
    (await t.pavlok.handleNotification(alarm('timeago', levels.WARN))).alarm.should.equal('noData');
    (await t.pavlok.handleNotification(alarm('timeago', levels.URGENT))).alarm.should.equal('urgentNoData');
    t.sent.should.eql([
      { stimulusType: 'vibe', stimulusValue: 100 }
      , { stimulusType: 'vibe', stimulusValue: 100 }
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
      (await t.pavlok.handleNotification(alarm(e.eventName, e.level))).reason.should.equal('cooldown');
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
    t.pavlok.request = function () { return Promise.reject(new Error('network down')); };
    var result = await t.pavlok.handleNotification(alarm('low', levels.WARN));
    result.sent.should.equal(false);
    result.reason.should.equal('error');

    t.pavlok.request = function () { return Promise.resolve({ status: 200 }); };
    (await t.pavlok.handleNotification(alarm('low', levels.WARN))).sent.should.equal(true);
  });

  it('reports each alarm trigger, sent or failed, to the log', async function () {
    var t = create();
    var results = [];
    t.pavlok.onResult = function (result) { results.push(result); };

    await t.pavlok.handleNotification(alarm('low', levels.URGENT));
    t.pavlok.request = function () { return Promise.reject(new Error('network down')); };
    await t.pavlok.handleNotification(alarm('high', levels.WARN));
    await t.pavlok.sendStimulus('beep', 10).catch(function () { });

    results.length.should.equal(2);
    results[0].should.containEql({ alarm: 'urgentLow', label: 'Urgent Low', sent: true });
    results[1].should.containEql({ alarm: 'high', label: 'High', sent: false, error: 'network down' });
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

    await t.pavlok.sendStimulus('vibe', 40);
    t.sent.should.eql([{ stimulusType: 'vibe', stimulusValue: 40 }]);
    await t.pavlok.sendStimulus('zap', 500).should.be.rejected();
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
