"use strict";

var fs   = require("fs"),
    path = require("path"),
    url  = require("url");

var async = require("async"),
    tilelive = require("tilelive"),
    tileliveMapnik = require("tilelive-mapnik"),
    xml2js = require("xml2js");

tileliveMapnik.registerProtocols(tilelive);

var getSource = function(options, callback) {
  options.path = options.path || path.join(process.cwd(), "stylesheet.xml");
  options.scale = options.scale || 1;

  return async.waterfall([
    async.apply(readStyle, options.path),
    async.apply(initializeSource, options.scale),
  ], callback);
};

var getSources = function(options, callback) {
  options.path = options.path || path.join(process.cwd(), "stylesheet.xml");

  return async.waterfall([
    async.apply(readStyle, options.path),
    async.apply(initializeSources),
  ], callback);
};

var initializeSource = function(scale, stylesheet, callback) {
  return async.parallel({
    info: async.apply(getInfo, stylesheet),
    stylesheet: async.apply(injectParams, stylesheet)
  }, function(err, results) {
    return loadSource(results.stylesheet, results.info, scale, function(err, source) {
      return callback(err, source, results.info);
    });
  });
};

var initializeSources = function(stylesheet, callback) {
  return async.parallel({
    info: async.apply(getInfo, stylesheet),
    stylesheet: async.apply(injectParams, stylesheet)
  }, function(err, results) {
    return loadSources(results.stylesheet, infoDefaults(results.info), callback);
  });
};

var loadInfo = function(options, callback) {
  options.path = options.path || path.join(process.cwd(), "stylesheet.xml");

  return readStyle(options.path, function(err, style) {
    if (err) {
      return callback(err);
    }

    return getInfo(style, callback);
  });
};

var readStyle = function(path, callback) {
  return fs.readFile(path, {
    encoding: "utf8"
  }, callback);
};

var infoDefaults = function(info) {
  info = info || {};

  // NOTE: this modifies info in-place
  info.scale      = +info.scale      || 1;
  info.metatile   = +info.metatile   || 1;
  info.bufferSize = +info.bufferSize || 0;
  info.tileSize   = +info.tileSize   || 256;
  info.minzoom    = +info.minzoom    || 0;
  info.maxzoom    = +info.maxzoom    || 22;
  info.bounds     =  info.bounds     || [-180, -90, 180, 90];
  info.scale      = +info.scale      || 1;
  info.format     =  info.format     || "png";

  return info;
};

var getInfo = function(stylesheet, callback) {
  return xml2js.parseString(stylesheet, function(err, doc) {
    if (err) {
      return callback(err);
    }

    // set some defaults
    var info = infoDefaults({
      bufferSize: doc.Map.$["buffer-size"] || 0,
    });

    doc.Map.Parameters[0].Parameter.forEach(function(param) {
      info[param.$.name] = param._;
    });

    // environmental overrides
    info.scale      = process.env.SCALE       || info.scale;
    info.metatile   = process.env.METATILE    || info.metatile;
    info.bufferSize = process.env.BUFFER_SIZE || info.bufferSize;
    info.tileSize   = process.env.TILE_SIZE   || info.tileSize;

    // arrays
    info.bounds = info.bounds.split(",", 4);
    info.center = info.center.split(",", 3);

    return callback(null, info);
  });
};

var injectParams = function(stylesheet, callback) {
  if (process.env.DATABASE_URL) {
    var creds = url.parse(process.env.DATABASE_URL),
        auth  = creds.auth.split(":", 2);

    stylesheet = stylesheet
      .replace(/{{dbname}}/g, creds.path.slice(1))
      .replace(/{{dbhost}}/g, creds.hostname)
      .replace(/{{dbuser}}/g, auth[0])
      .replace(/{{dbpassword}}/g, auth[1] || "")
      .replace(/{{dbport}}/g, creds.port || "");
  }

  return callback(null, stylesheet);
};

var loadSource = function(style, info, scale, callback) {
  return tilelive.load({
    protocol: "mapnik:",
    pathname: style,
    query: {
      metatile: info.metatile,
      bufferSize: info.bufferSize,
      tileSize: info.tileSize * scale,
      scale: info.scale * scale
    }
  }, callback);
};

var loadSources = function(stylesheet, info, callback) {
  // write this to a different filename to avoid corrupting the original
  // stylesheet
  var style = path.join(process.cwd(), "style.xml");

  return async.waterfall([
    async.apply(fs.writeFile, style, stylesheet),
    function(next) {
      return async.parallel({
        "@1x": async.apply(loadSource, style, info, 1),
        "@2x": async.apply(loadSource, style, info, 2)
      }, next);
    }
  ], function(err, sources) {
    return callback(err, sources, info);
  });
};

module.exports = {
  getSources: getSources,
  initializeSources: initializeSources,
  loadInfo: loadInfo,
  readStyle: readStyle,
  infoDefaults: infoDefaults
};
