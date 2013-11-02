"use strict";

var path = require("path"),
    util = require("util");

var async = require("async"),
    express = require("express"),
    metricsd = require("metricsd"),
    merc = new (require("sphericalmercator"))();

// TODO name me
var tbd = require("./");

var metrics = metricsd({
  log: !!process.env.ENABLE_METRICS
});

module.exports.initialize = function(options, callback) {
  options.path = options.path || path.join(process.cwd(), "stylesheet.xml");

  return async.waterfall([
    async.apply(tbd.readStyle, options.path),
    async.apply(tbd.initializeSources),
    async.apply(makeApp, options)
  ], function(err, app, info) {
    if (err) {
      console.error(err.stack);
      process.exit(1);
    }

    return callback(err, app, info);
  });
};

var makeApp = function(options, sources, info, callback) {
  var app = express(),
      defaultSource = sources["@1x"];

  info.maxAge = info.maxAge || options.maxAge;

  // UTFGrid handler
  app.get(new RegExp("^/(\\d+)/(\\d+)/(\\d+)\\.json"),
          makeUTFGridHandler(defaultSource, info));

  // std handler
  app.get(new RegExp("^/(\\d+)/(\\d+)/(\\d+)\\." + info.format),
          makeRenderHandler(defaultSource, info, 1));

  // retina handler
  app.get(new RegExp("^/(\\d+)/(\\d+)/(\\d+)@2x\\." + info.format),
          makeRenderHandler(sources["@2x"], info, 2));

  return callback(null, app, info);
};

var makeRenderHandler = function(source, info, scale) {
  setInterval(function() {
    Object.keys(source._stats).forEach(function(k) {
      metrics.updateGauge("%dx.%s", scale, k, source._stats[k]);
    });
  }, 30000);

  console.log("@%dx initialized.", scale);

  return function(req, res, next) {
    var z = +req.params[0],
        x = +req.params[1],
        y = +req.params[2];

    // validate zoom
    if (z < info.minzoom || z > info.maxzoom) {
      return res.send(404);
    }

    // validate coords against bounds
    var xyz = merc.xyz(info.bounds, z);

    if (x < xyz.minX ||
        x > xyz.maxX ||
        y < xyz.minY ||
        y > xyz.maxY) {
      return res.send(404);
    }

    return source.getTile(z, x, y,
                          metrics.timeCallback("render." + scale + "x.z" + z,
                                               function(err, tile, headers) {
      if (err) {
        return next(err);
      }

      res.set(headers);

      if (info.maxAge) {
        res.set("Cache-Control", util.format("public,max-age=%d", info.maxAge));
      }

      return res.send(tile);
    }));
  };
};

var makeUTFGridHandler = function(source, info) {
  return function(req, res, next) {
    var z = +req.params[0],
        x = +req.params[1],
        y = +req.params[2];

    // validate zoom
    if (z < info.minzoom || z > info.maxzoom) {
      return res.send(404);
    }

    // validate coords against bounds
    var xyz = merc.xyz(info.bounds, z);

    if (x < xyz.minX ||
        x > xyz.maxX ||
        y < xyz.minY ||
        y > xyz.maxY) {
      return res.send(404);
    }

    return source.getGrid(z, x, y,
                                 metrics.timeCallback("render.grid.z" + z,
                                       function(err, tile, headers) {
      if (err) {
        return next(err);
      }

      res.set(headers);

      if (info.maxAge) {
        res.set("Cache-Control", util.format("public,max-age=%d", info.maxAge));
      }

      return res.send(tile);
    }));
  };
};
