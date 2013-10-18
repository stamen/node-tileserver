#!/usr/bin/env node

"use strict";

var http = require("http"),
    os = require("os"),
    util = require("util");

var async = require("async"),
    env = require("require-env"),
    kue = require("../lib/kue"),
    metricsd = require("metricsd"),
    request = require("request"),
    SphericalMercator = require("sphericalmercator"),
    tilelive = require("tilelive"),
    tileliveMapnik = require("tilelive-mapnik");

tileliveMapnik.registerProtocols(tilelive);

http.globalAgent.maxSockets = 200;

var metrics = metricsd({
  log: !!process.env.ENABLE_METRICS
});

var SCALE = process.env.SCALE || 1,
    BUFFER_SIZE = process.env.BUFFER_SIZE || 128,
    TILE_SIZE = process.env.TILE_SIZE || 256;

var ACCESS_KEY_ID = env.require("AWS_ACCESS_KEY_ID"),
    SECRET_ACCESS_KEY = env.require("AWS_SECRET_ACCESS_KEY"),
    S3_BUCKET = env.require("S3_BUCKET"),
    PATH_PREFIX = process.env.PATH_PREFIX || "";

var merc = new SphericalMercator({
  size: TILE_SIZE
});

var jobs = kue.createQueue();

var getSubtiles = function(z, x, y) {
  return [
    { z: z + 1, x: x * 2, y: y * 2 },
    { z: z + 1, x: x * 2 + 1, y: y * 2 },
    { z: z + 1, x: x * 2, y: y * 2 + 1 },
    { z: z + 1, x: x * 2 + 1, y: y * 2 + 1 }
  ];
};

var queueSubtiles = function(jobs, task, tile) {
  if (tile.z < task.maxZoom) {
    var subtiles = getSubtiles(tile.z, tile.x, tile.y).filter(function(t) {
      return (t.x % task.metaTile === 0 &&
              t.y % task.metaTile === 0);
    });

    subtiles.forEach(function(x) {
      var path;

      if (task.retina) {
        path = util.format("/%d/%d/%d@2x.png", x.z, x.x, x.y);
      } else {
        path = util.format("/%d/%d/%d.png", x.z, x.x, x.y);
      }

      x.title = path;
      x.retina = task.retina;
      x.maxZoom = task.maxZoom;
      x.bbox = task.bbox;
      x.metaTile = task.metaTile;

      jobs.create("render", x).priority(x.z).save();
    });
  }
};

var upload = function(path, headers, body, callback) {
  return request.put({
    // TODO prefix
    uri: util.format("http://%s.s3.amazonaws.com%s%s", S3_BUCKET, PATH_PREFIX, path),
    aws: {
      key: ACCESS_KEY_ID,
      secret: SECRET_ACCESS_KEY,
      bucket: S3_BUCKET
    },
    headers: headers,
    body: body,
    timeout: 5000
  }, function(err, response, body) {
    if (err) {
      return callback(err);
    }

    if (response.statusCode === 200) {
      return callback();
    } else {
      return callback(new Error(util.format("%d: %s", response.statusCode, body)));
    }
  });
};


jobs.process("render", os.cpus().length * 4, function(job, callback) {
  var task = job.data;

  var tiles = [];

  for (var x = task.x; x < task.x + task.metaTile; x++) {
    for (var y = task.y; y < task.y + task.metaTile; y++) {
      tiles.push({ z: task.z, x: x, y: y });
    }
  }

  // validate coords against bounds
  var xyz = merc.xyz(task.bbox, task.z);

  tiles = tiles.filter(function(t) {
    return t.x >= xyz.minX &&
            t.x <= xyz.maxX &&
            t.y >= xyz.minY &&
            t.y >= xyz.maxY;
  });

  var scale = SCALE,
      bufferSize = BUFFER_SIZE,
      tileSize = TILE_SIZE;

  if (task.retina) {
    scale *= 2;
    bufferSize *= 2;
    tileSize *= 2;
  }

  // assume tilelive caches sources; these will probably all be the same, but
  // if retina seeding is mixed with standard-def, scale will vary
  // in theory, setting scale at render-time will set the option on the pooled
  // map object and allow the stylesheet to only be loaded once
  // MapnikSource._createPool uses the options that it's initialized with
  // (potentially deferred), so that won't work with the current implementation
  return tilelive.load({
    protocol: "mapnik:",
    hostname: ".",
    pathname: "/stylesheet.xml",
    query: {
      metatile: task.metaTile,
      bufferSize: bufferSize,
      tileSize: tileSize,
      scale: scale
    }
  }, function(err, source) {
    if (err) {
      console.warn("load:", err);
      return callback(err);
    }

    return async.each(tiles, function(tile, done) {
      var path;

      if (task.retina) {
        path = util.format("/%d/%d/%d@2x.png", tile.z, tile.x, tile.y);
      } else {
        path = util.format("/%d/%d/%d.png", tile.z, tile.x, tile.y);
      }

      // console.log("rendering", path);

      return source.getTile(tile.z, tile.x, tile.y,
                            metrics.timeCallback("render." + scale + "x.z" + tile.z,
                                                 function(err, data, headers) {
        queueSubtiles(jobs, task, tile);

        if (err) {
          console.warn("render:", err);
          return done(err);
        }

        // TODO configurable max-age
        headers["Cache-Control"] = "public,max-age=300";
        headers["x-amz-acl"] = "public-read";

        // TODO if image was solid (and transparent), register an S3 redirect
        // instead of uploading:
        // http://stackoverflow.com/questions/2272835/amazon-s3-object-redirect
        // tilelive-mapnik does not currently expose whether that's the case,
        // although it knows:
        // https://github.com/mapbox/tilelive-mapnik/blob/master/lib/render.js#L91

        // TODO retry failed uploads
        return upload(path, headers, data, done);
      });
    }, callback);
  });
});
