(function () {
  'use strict';
  //for the tests window isn't the global object
  var Nightscout = window.Nightscout;
  var client = Nightscout.client;
  var admin_plugins = Nightscout.admin_plugins;

  client.requiredPermission = '*';
  client.init(function loaded () {
    // init HTML code
    admin_plugins.createHTML( client );
    // jump to a section linked from the menu, e.g. admin#pavlok
    var section = window.location.hash && document.getElementById('admin_' + window.location.hash.substring(1));
    if (section) {
      section.scrollIntoView();
    }
  });

})();
