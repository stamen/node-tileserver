#!/usr/bin/env node
"use strict";

var fs   = require("fs"),
    path = require("path"),
    url  = require("url");

var async = require("async"),
    tilelive = require("tilelive"),
    tileliveMapnik = require("tilelive-mapnik"),
    xml2js = require("xml2js");

tileliveMapnik.registerProtocols(tilelive);

var load = function(options, stylesheet, callback) {
  return async.parallel({
    info: async.apply(getInfo, stylesheet),
    stylesheet: async.apply(injectParams, stylesheet)
  }, function(err, results) {
    return loadSources(results.stylesheet, results.info, options, callback);
  });
};

var readStyle = function(path, callback) {
  return fs.readFile(path, {
    encoding: "utf8"
  }, callback);
};

var getInfo = function(stylesheet, callback) {
  return xml2js.parseString(stylesheet, function(err, doc) {
    if (err) {
      return callback(err);
    }

    // set some defaults
    var info = {
      scale: 1,
      metatile: 1,
      bufferSize: doc.Map.$["buffer-size"] || 0,
      tileSize: 256
    };

    doc.Map.Parameters[0].Parameter.forEach(function(param) {
      info[param.$.name] = param._;
    });

    // environmental overrides
    info.scale = process.env.SCALE || info.scale;
    info.metatile = process.env.METATILE || info.metatile;
    info.bufferSize = process.env.BUFFER_SIZE || info.bufferSize;
    info.tileSize = process.env.TILE_SIZE || info.tileSize;

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

var loadSources = function(stylesheet, info, options, callback) {
  // write this to a different filename to avoid corrupting the original
  // stylesheet
  var style = path.join(process.cwd(), "style.xml");

  return async.waterfall([
    async.apply(fs.writeFile, style, stylesheet),
    function(next) {
      return async.parallel({
        "@1x": function(done) {
          return tilelive.load({
            protocol: "mapnik:",
            pathname: style,
            query: {
              metatile: info.metatile,
              bufferSize: info.bufferSize,
              tileSize: info.tileSize,
              scale: info.scale
            }
          }, done);
        },
        "@2x": function(done) {
          return tilelive.load({
            protocol: "mapnik:",
            pathname: style,
            query: {
              metatile: info.metatile,
              bufferSize: info.bufferSize,
              tileSize: info.tileSize * 2,
              scale: info.scale * 2
            }
          }, done);
        }
      }, next);
    }
  ], callback);
};

module.exports = {
  load: load,
  readStyle: readStyle,
  getInfo: getInfo,
  injectParams: injectParams
};
