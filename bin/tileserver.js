#!/usr/bin/env node
"use strict";

var fs   = require("fs"),
    path = require("path"),
    url  = require("url"),
    util = require("util");

var async = require("async"),
    cors = require("cors"),
    express = require("express"),
    metricsd = require("metricsd"),
    SphericalMercator = require("sphericalmercator"),
    tilelive = require("tilelive"),
    tileliveMapnik = require("tilelive-mapnik"),
    xml2js = require("xml2js");

tileliveMapnik.registerProtocols(tilelive);

var metrics = metricsd({
  log: !!process.env.ENABLE_METRICS
});

var merc = new SphericalMercator();

// TODO extract app into lib/app.js
var app = express();

app.configure(function() {
  app.disable("x-powered-by");
  app.use(express.responseTime());
  app.use(express.compress());
  app.use(cors());
  app.use(express.static(__dirname + "/../public"));
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

      // TODO configurable max-age
      res.set("Cache-Control", "public,max-age=300");

      res.send(tile);
    }));
  };
};

//
// Fill in stylesheet placeholders
//

var stylesheet = fs.readFileSync(path.join(process.cwd(), "stylesheet.xml"), {
  encoding: "utf8"
});

var creds = url.parse(process.env.DATABASE_URL),
    auth  = creds.auth.split(":", 2);

stylesheet = stylesheet
  .replace(/{{dbname}}/g, creds.path.slice(1))
  .replace(/{{dbhost}}/g, creds.hostname)
  .replace(/{{dbuser}}/g, auth[0])
  .replace(/{{dbpassword}}/g, auth[1] || "")
  .replace(/{{dbport}}/g, creds.port || "");

// write this to a different filename to avoid corrupting the source file (in
// case it needs to be used as an input again)
var stylesheetPath = path.join(process.cwd(), "style.xml");
fs.writeFileSync(stylesheetPath, stylesheet);

async.waterfall([
  function(done) {
    return xml2js.parseString(stylesheet, function(err, doc) {
      if (err) {
        return done(err);
      }

      // set some defaults
      var params = {
        scale: 1,
        metatile: 1,
        bufferSize: doc.Map.$["buffer-size"] || 0,
        tileSize: 256
      };

      doc.Map.Parameters[0].Parameter.forEach(function(param) {
        params[param.$.name] = param._;
      });

      // environmental overrides
      params.scale = process.env.SCALE || params.scale;
      params.metatile = process.env.METATILE || params.metatile;
      params.bufferSize = process.env.BUFFER_SIZE || params.bufferSize;
      params.tileSize = process.env.TILE_SIZE || params.tileSize;

      return done(null, params);
    });
  },
  function(params, done) {
    return async.parallel([
      function(done) {
        tilelive.load({
          protocol: "mapnik:",
          hostname: "",
          pathname: stylesheetPath,
          query: {
            metatile: params.metatile,
            bufferSize: params.bufferSize,
            tileSize: params.tileSize,
            scale: params.scale
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

          app.get(new RegExp("^/(\\d+)/(\\d+)/(\\d+)\\.json"), function(req, res) {
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

            source.getGrid(z, x, y,
                          metrics.timeCallback("render.grid." + info.scale + "x.z" + z, function(err, tile, headers) {
              if (err) {
                console.warn(err);
                return res.send(500);
              }

              res.set(headers);

              // TODO configurable max-age
              res.set("Cache-Control", "public,max-age=300");

              res.send(tile);
            }));
          });

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
          hostname: "",
          pathname: stylesheetPath,
          query: {
            metatile: params.metatile,
            bufferSize: params.bufferSize * 2,
            tileSize: params.tileSize * 2,
            scale: params.scale * 2
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
    ], done);
  },
], function(err) {
  if (err) {
    console.error(err.stack);
    process.exit(1);
  }

  console.log("Mapnik initialized.");

  app.listen(process.env.PORT || 8080, function() {
    console.log("Listening at http://%s:%d/", this.address().address, this.address().port);
  });
});
