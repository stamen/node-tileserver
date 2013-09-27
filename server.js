"use strict";

var path = require("path"),
    util = require("util");

var async = require("async"),
    cors = require("cors"),
    express = require("express"),
    tilelive = require("tilelive"),
    tileliveMapnik = require("tilelive-mapnik");

tileliveMapnik.registerProtocols(tilelive);

var SCALE = process.env.SCALE || 1;
var METATILE = process.env.METATILE || 4;
var BUFFER_SIZE = process.env.BUFFER_SIZE || 128;
var TILE_SIZE = process.env.TILE_SIZE || 256;

var app = express();

app.configure(function() {
  app.disable("x-powered-by");
  app.use(express.responseTime());
  app.use(cors());
  app.use(express.static(__dirname + "/public"));
});

app.configure("development", function() {
  app.use(express.logger());
});

// TODO templatize index.html to center on the right location and constrain
// zoom levels appropriately

async.parallel([
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

      // TODO not all tiles will be PNGs
      app.get(/^\/(\d+)\/(\d+)\/(\d+)\.png/, function(req, res) {
        var z = +req.params[0],
            x = +req.params[1],
            y = +req.params[2];

        source.getTile(z, x, y, function(err, tile, headers) {
          if (err) {
            console.warn(err);
            return res.send(500);
          }

          res.set(headers);
          res.send(tile);
        });
      });

      setInterval(function() {
        // TODO use metricsd
        Object.keys(source._stats).forEach(function(k) {
          console.log("1x.%s: %d", k, source._stats[k]);
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

      // TODO not all tiles will be PNGs
      app.get(/^\/(\d+)\/(\d+)\/(\d+)@2x\.png/, function(req, res) {
        var z = +req.params[0],
            x = +req.params[1],
            y = +req.params[2];

        source.getTile(z, x, y, function(err, tile, headers) {
          if (err) {
            console.warn(err);
            return res.send(500);
          }

          res.set(headers);
          res.send(tile);
        });
      });

      setInterval(function() {
        // TODO use metricsd
        Object.keys(source._stats).forEach(function(k) {
          console.log("2x.%s: %d", k, source._stats[k]);
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
