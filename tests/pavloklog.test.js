'use strict';

require('should');

describe('pavloklog', function ( ) {

  function fakeStore () {
    var docs = [];
    var pipelines = [];
    var collection = {
      insertOne: function (doc) { docs.push(doc); return Promise.resolve({ acknowledged: true }); }
      , createIndex: function (keys, options) { collection.index = { keys: keys, options: options }; return Promise.resolve('date_1'); }
      , aggregate: function (pipeline) {
        pipelines.push(pipeline);
        return { toArray: function () {
          return Promise.resolve([{ _id: 'low', last24h: 2, last7d: 3, last30d: 4, total: 5, failed: 1, lastSent: new Date(0) }]);
        } };
      }
      , find: function () {
        var cursor = {
          sort: function () { return cursor; }
          , limit: function (n) { cursor.n = n; return cursor; }
          , toArray: function () { return Promise.resolve(docs.slice().reverse().slice(0, cursor.n)); }
        };
        return cursor;
      }
    };
    return { docs: docs, pipelines: pipelines, collection: collection, store: { collection: function () { return collection; } } };
  }

  it('records alarm triggers per watch with capped error messages', async function () {
    var fake = fakeStore();
    var log = require('../lib/server/pavloklog')({}, { store: fake.store });

    await log.record({ alarm: 'low', label: 'Low', title: 'Warning LOW', sent: true, watches: [
      { watch: '1', name: 'Me', sent: true, type: 'zap', value: 100 }
      , { watch: '2', name: 'Mom', sent: false, type: 'zap', value: 60, error: 'x'.repeat(500) }
    ] });

    fake.docs.length.should.equal(1);
    fake.docs[0].alarm.should.equal('low');
    fake.docs[0].sent.should.equal(true);
    fake.docs[0].date.should.be.instanceof(Date);
    fake.docs[0].watches[0].should.eql({ watch: '1', name: 'Me', sent: true, type: 'zap', value: 100 });
    fake.docs[0].watches[1].sent.should.equal(false);
    fake.docs[0].watches[1].error.length.should.equal(200);
  });

  it('expires entries after a year', async function () {
    var fake = fakeStore();
    var log = require('../lib/server/pavloklog')({}, { store: fake.store });
    await log.ensureIndexes();
    fake.collection.index.keys.should.eql({ date: 1 });
    fake.collection.index.options.expireAfterSeconds.should.equal(365 * 24 * 60 * 60);
  });

  it('summarizes counts for every alarm, filling in alarms with no triggers', async function () {
    var fake = fakeStore();
    var log = require('../lib/server/pavloklog')({}, { store: fake.store });
    await log.record({ alarm: 'low', label: 'Low', title: 'Warning LOW', sent: true });

    var summary = await log.summary({ urgentLow: 'Urgent Low', low: 'Low', high: 'High', urgentHigh: 'Urgent High' });

    summary.counts.map(function (c) { return c.alarm; }).should.eql(['urgentLow', 'low', 'high', 'urgentHigh']);
    summary.counts[1].should.containEql({ label: 'Low', last24h: 2, last7d: 3, last30d: 4, total: 5, failed: 1 });
    summary.counts[0].should.containEql({ label: 'Urgent Low', last24h: 0, total: 0, failed: 0, lastSent: null });
    summary.recent.length.should.equal(1);
    summary.retentionDays.should.equal(365);
    fake.pipelines[0][0].should.have.property('$group');
  });

  it('never lets a database error escape from record', async function () {
    var log = require('../lib/server/pavloklog')({}, { store: { collection: function () {
      return { insertOne: function () { return Promise.reject(new Error('db down')); } };
    } } });
    await log.record({ alarm: 'low', label: 'Low', sent: true });
  });

});
