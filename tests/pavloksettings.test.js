'use strict';

require('should');

describe('pavloksettings', function ( ) {

  function setup (collection) {
    var applied = [];
    var ctx = {
      store: { collection: function () { return collection; } }
      , pavlok: { applySettings: function (doc) { applied.push(doc); } }
    };
    return { applied: applied, settings: require('../lib/server/pavloksettings')({}, ctx) };
  }

  it('applies saved settings on load', async function () {
    var t = setup({ findOne: function (query) {
      query.should.eql({ _id: 'settings' });
      return Promise.resolve({ _id: 'settings', watches: { '1': { enabled: false } } });
    } });
    await t.settings.load();
    t.applied.length.should.equal(1);
    t.applied[0].watches['1'].enabled.should.equal(false);
  });

  it('keeps the defaults when nothing is saved or the database fails', async function () {
    var empty = setup({ findOne: function () { return Promise.resolve(null); } });
    await empty.settings.load();
    empty.applied.length.should.equal(0);

    var broken = setup({ findOne: function () { return Promise.reject(new Error('db down')); } });
    await broken.settings.load();
    broken.applied.length.should.equal(0);
  });

  it('saves settings as a single document', async function () {
    var saved;
    var t = setup({ replaceOne: function (filter, doc, options) {
      saved = { filter: filter, doc: doc, options: options };
      return Promise.resolve({});
    } });
    await t.settings.save({ watches: { '1': { enabled: true } } });
    saved.filter.should.eql({ _id: 'settings' });
    saved.doc.watches['1'].enabled.should.equal(true);
    saved.doc.updated_at.should.be.instanceof(Date);
    saved.options.should.eql({ upsert: true });
  });

});
