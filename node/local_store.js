var fs             = require('fs'),
    Cipher         = require('vault-cipher'),
    Vault          = require('../lib/vault'),
    CompositeStore = require('./composite_store');

var LocalStore = function(options) {
  this._path   = options.path;
  this._cipher = new Cipher(options.key, {format: 'base64', work: 100, salt: Vault.UUID});
  this._cache  = options.cache !== false;
};

LocalStore.LOCAL = 'local';

LocalStore.prototype.getName = function() {
  return LocalStore.LOCAL;
};

LocalStore.prototype.setSource = function(source) {
  this._source = source;
};

LocalStore.prototype.clear = function(callback, context) {
  this.load(function(error, config) {
    if (error) return callback.call(context, error);

    config.global = {};
    config.services = {};

    this.dump(config, callback, context);
  }, this);
};

LocalStore.prototype.composite = function() {
  return new CompositeStore(this);
};

LocalStore.prototype.listSources = function(callback, context) {
  this.load(function(error, config) {
    if (error) return callback.call(context, error);

    var sources     = config.sources || {},
        sourceNames = Object.keys(sources)
                        .filter(function(s) { return !/^__.+__$/.test(s) });

    var current = this._source || sources.__current__;
    if (!current || !sources[current]) current = LocalStore.LOCAL;

    callback.call(context, null, sourceNames.concat(LocalStore.LOCAL), current);
  }, this);
};

LocalStore.prototype.getStore = function(source, callback, context) {
  this.load(function(error, config) {
    if (error) return callback.call(context, error);

    var store = (!source || source === LocalStore.LOCAL)
              ? this
              : new RemoteStore(source, config.sources[source]);

    callback.call(context, null, store);
  }, this);
};

LocalStore.prototype.currentStore = function(callback, context) {
  this.load(function(error, config) {
    if (error) return callback.call(context, error);

    var current = this._source || (config.sources || {}).__current__;
    this.getStore(current, callback, context);
  }, this);
};

LocalStore.prototype.listServices = function(callback, context) {
  this.load(function(error, config) {
    if (error) return callback.call(context, error);
    callback.call(context, null, Object.keys(config.services || {}).sort());
  });
};

LocalStore.prototype.saveGlobals = function(settings, callback, context) {
  this.load(function(error, config) {
    if (error) return callback.call(context, error);

    var saved   = config.global || {},
        updated = {};

    Vault.extend(updated, settings);
    Vault.extend(updated, saved);
    config.global = updated;

    this.dump(config, callback, context);
  }, this);
};

LocalStore.prototype.saveService = function(service, settings, callback, context) {
  this.load(function(error, config) {
    if (error) return callback.call(context, error);

    config.services = config.services || {};

    var saved   = config.services[service] || {},
        updated = {};

    Vault.extend(updated, settings);
    Vault.extend(updated, saved);
    config.services[service] = updated;

    this.dump(config, callback, context);
  }, this);
};

LocalStore.prototype.deleteGlobals = function(callback, context) {
  this.load(function(error, config) {
    if (error) return callback.call(context, error);
    config.global = {};
    this.dump(config, callback, context);
  }, this);
};

LocalStore.prototype.deleteService = function(service, callback, context) {
  this.load(function(error, config) {
    if (error) return callback.call(context, error);

    if (!config.services || !config.services[service])
      return callback.call(context, new Error('Service "' + service + '" is not configured'));

    delete config.services[service];
    this.dump(config, callback, context);
  }, this);
};

LocalStore.prototype.serviceSettings = function(service, includeGlobal, callback, context) {
  this.load(function(error, config) {
    if (error) return callback.call(context, error);

    if (!includeGlobal && (!config.services || !config.services[service]))
      return callback.call(context, null, null);

    var settings = {};
    Vault.extend(settings, (config.services || {})[service] || {});
    Vault.extend(settings, config.global || {});

    callback.call(context, null, settings);
  });
};

LocalStore.prototype.load = function(callback, context) {
  if (this._cache && this._configCache)
    return callback.call(context, null, this._configCache);

  var self = this;
  fs.readFile(this._path, function(error, content) {
    if (error)
      return callback.call(context, null, {global: {}, services: {}, sources: {}});

    self._cipher.decrypt(content.toString(), function(error, plaintext) {
      var err = new Error('Your .vault file is unreadable; check your VAULT_KEY and VAULT_PATH settings');
      if (error) return callback.call(context, err);

      var config;
      try {
        config = JSON.parse(plaintext);
      } catch (e) {
        return callback.call(context, err);
      }
      self._configCache = config;
      callback.call(context, null, config);
    });
  });
};

LocalStore.prototype.dump = function(config, callback, context) {
  config = sort(config);
  var json = JSON.stringify(config, true, 2);

  this._cipher.encrypt(json, function(error, ciphertext) {
    fs.writeFile(this._path, ciphertext, function() {
      if (callback) callback.apply(context, arguments);
    });
  }, this);
};

LocalStore.prototype.import = function(settings, callback, context) {
  this.load(function(error, config) {
    if (error) return callback.call(context, error);
    Vault.extend(config.global, settings.global);
    Vault.extend(config.services, settings.services);
    this.dump(config, callback, context);
  }, this);
};

LocalStore.prototype.export = function(callback, context) {
  this.load(function(error, config) {
    if (error) return callback.call(context, error);
    var exported = {global: config.global, services: config.services};
    callback.call(context, null, exported);
  });
};

var sort = function(object) {
  if (typeof object !== 'object') return object;
  if (object === null) return null;

  if (object instanceof Array)
    return object.map(function(o) { return sort(o) })

  var copy = {}, keys = Object.keys(object).sort();
  for (var i = 0, n = keys.length; i < n; i++)
    copy[keys[i]] = sort(object[keys[i]]);

  return copy;
};

module.exports = LocalStore;

