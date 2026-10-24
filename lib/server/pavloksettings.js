'use strict';

var COLLECTION = 'pavlok_settings';
var DOC_ID = 'settings';

// Saves the Pavlok watch settings changed from the admin page (on/off, pause,
// per alarm on/off and strength) so they survive server restarts.
function init (env, ctx) {

  function api () {
    return ctx.store.collection(env.pavlok_settings_collection || COLLECTION);
  }

  var pavloksettings = { };

  // apply the saved settings to ctx.pavlok; on any error the defaults stay
  // in place (every alarm on), so alarms are never silently lost
  pavloksettings.load = function load () {
    return api().findOne({ _id: DOC_ID }).then(function (doc) {
      if (doc) {
        ctx.pavlok.applySettings(doc);
        console.info('[pavlok] loaded saved watch settings');
      }
    }).catch(function (err) {
      console.error('[pavlok] unable to load saved settings, using defaults:', err.message);
    });
  };

  pavloksettings.save = function save (settings) {
    var doc = Object.assign({}, settings, { _id: DOC_ID, updated_at: new Date() });
    return api().replaceOne({ _id: DOC_ID }, doc, { upsert: true });
  };

  return pavloksettings;
}

module.exports = init;
