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

  // TODO cacheControl instead?
  // TODO should info or options take precedence?
  info.maxAge = info.maxAge || options.maxAge;
  info.surrogateControl = info.surrogateControl || options.surrogateControl;
  info.surrogateKey = info.surrogateKey || options.surrogateKey;

  // UTFGrid handler
  app.get("/:z(\\d+)/:x(\\d+)/:y(\\d+).json",
          makeUTFGridHandler(defaultSource, info));

  // std handler
  app.get("/:z(\\d+)/:x(\\d+)/:y(\\d+)." + info.format,
          makeRenderHandler(defaultSource, info, 1));

  // retina handler
  app.get("/:z(\\d+)/:x(\\d+)/:y(\\d+)@2x." + info.format,
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
    // coerce to ints
    var z = req.params.z | 0,
        x = req.params.x | 0,
        y = req.params.y | 0;

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

      if (info.surrogateControl) {
        res.set("Surrogate-Control", info.surrogateControl);
      }

      if (info.surrogateKey) {
        // TODO use an actual templating framework for this
        var key = info.surrogateKey
          .replace(/{{info.name}}/g, info.name)
          .replace(/{{tile.z}}/g, z);

        res.set("Surrogate-Key", key);
      }

      return res.send(tile);
    }));
  };
};

var makeUTFGridHandler = function(source, info) {
  return function(req, res, next) {
    // coerce to ints
    var z = req.params.z | 0,
        x = req.params.x | 0,
        y = req.params.y | 0;

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

      if (info.surrogateControl) {
        res.set("Surrogate-Control", info.surrogateControl);
      }

      if (info.surrogateKey) {
        // TODO use an actual templating framework for this
        var key = info.surrogateKey
          .replace(/{{info.name}}/g, info.name)
          .replace(/{{info.format}}/g, "json")
          .replace(/{{tile.z}}/g, z);

        res.set("Surrogate-Key", key);
      }

      return res.send(tile);
    }));
  };
};
