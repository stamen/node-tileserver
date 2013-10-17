#!/usr/bin/env node
"use strict";

var path = require("path"),
    util = require("util");

var async = require("async"),
    cors = require("cors"),
    express = require("express"),
    metricsd = require("metricsd"),
    SphericalMercator = require("sphericalmercator"),
    tilelive = require("tilelive"),
    tileliveMapnik = require("tilelive-mapnik");

tileliveMapnik.registerProtocols(tilelive);

var metrics = metricsd({
  log: !!process.env.ENABLE_METRICS
});

var merc = new SphericalMercator();

var SCALE = process.env.SCALE || 1;
var METATILE = process.env.METATILE || 4;
var BUFFER_SIZE = process.env.BUFFER_SIZE || 128;
var TILE_SIZE = process.env.TILE_SIZE || 256;

// TODO extract app into lib/app.js
var app = express();

app.configure(function() {
  app.disable("x-powered-by");
  app.use(express.responseTime());
  app.use(cors());
  app.use(express.static(__dirname + "/../public"));
  // TODO wrap a flag around this
  // app.use("/_/queue", require("kue").app);
});

app.configure("development", function() {
  app.use(express.logger());
});

// TODO templatize index.html to center on the right location and constrain
// zoom levels appropriately

var makeRenderHandler = function(info, source) {
  return function(req, res) {
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

    source.getTile(z, x, y,
                   metrics.timeCallback("render." + info.scale + "x.z" + z, function(err, tile, headers) {
      if (err) {
        console.warn(err);
        return res.send(500);
      }

      res.set(headers);
      res.send(tile);
    }));
  };
};

async.series([
  function(done) {
    tilelive.load({
      protocol: "mapnik:",
      hostname: ".",
      pathname: "/stylesheet.xml",
      query: {
        metatile: METATILE,
        bufferSize: BUFFER_SIZE,
        tileSize: TILE_SIZE,
        scale: SCALE
      }
    }, function(err, source) {
      if (err) {
        console.error(err);
        process.exit(1);
      }

      console.log("@1x initialized.");

      var info = source._info || {};
      info.minzoom = info.minzoom || 0;
      info.maxzoom = info.maxzoom || Infinity;
      info.bounds = info.bounds || [-180, -90, 180, 90];
      info.scale = info.scale || SCALE;

      var format = info.format || "png";

      app.get(new RegExp("^/(\\d+)/(\\d+)/(\\d+)\\." + format),
              makeRenderHandler(info, source));

      setInterval(function() {
        Object.keys(source._stats).forEach(function(k) {
          metrics.updateGauge("%sx.%s", info.scale, k, source._stats[k]);
        });
      }, 30000);

      return done();
    });
  },
  function(done) {
    tilelive.load({
      protocol: "mapnik:",
      hostname: ".",
      pathname: "/stylesheet.xml",
      query: {
        metatile: METATILE,
        bufferSize: BUFFER_SIZE * 2,
        tileSize: TILE_SIZE * 2,
        scale: SCALE * 2
      }
    }, function(err, source) {
      if (err) {
        console.error(err);
        process.exit(1);
      }

      console.log("@2x initialized.");

      var info = source._info || {};
      info.minzoom = info.minzoom || 0;
      info.maxzoom = info.maxzoom || Infinity;
      info.bounds = info.bounds || [-180, -90, 180, 90];
      info.scale = info.scale || SCALE * 2;

      var format = info.format || "png";

      app.get(new RegExp("^/(\\d+)/(\\d+)/(\\d+)@2x\\." + format),
              makeRenderHandler(info, source));

      setInterval(function() {
        Object.keys(source._stats).forEach(function(k) {
          metrics.updateGauge("%dx.%s", info.scale, k, source._stats[k]);
        });
      }, 30000);

      return done();
    });
  }
], function() {
  console.log("Mapnik initialized.");
});

app.listen(process.env.PORT || 8080, function() {
  console.log("Listening at http://%s:%d/", this.address().address, this.address().port);
});

