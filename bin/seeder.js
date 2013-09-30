#!/usr/bin/env node

"use strict";

var http = require("http"),
    os = require("os"),
    util = require("util");

var async = require("async"),
    env = require("require-env"),
    kue = require("kue"),
    request = require("request"),
    SphericalMercator = require("sphericalmercator"),
    tilelive = require("tilelive"),
    tileliveMapnik = require("tilelive-mapnik");

tileliveMapnik.registerProtocols(tilelive);

http.globalAgent.maxSockets = 200;

var SCALE = process.env.SCALE || 1,
    METATILE = process.env.METATILE || 4,
    BUFFER_SIZE = process.env.BUFFER_SIZE || 128,
    TILE_SIZE = process.env.TILE_SIZE || 256;

var ACCESS_KEY_ID = env.require("AWS_ACCESS_KEY_ID"),
    SECRET_ACCESS_KEY = env.require("AWS_SECRET_ACCESS_KEY"),
    S3_BUCKET = env.require("S3_BUCKET");

var merc = new SphericalMercator({
  size: TILE_SIZE
});

var getMetaTiles = function(zoom, range) {
  var tiles = [];

  var minX = range.minX - (range.minX % METATILE),
      maxX = range.maxX - (METATILE - (range.maxX % METATILE)),
      minY = range.minY - (range.minY % METATILE),
      maxY = range.maxY - (METATILE - (range.maxY % METATILE));

  for (var x = minX; x <= maxX; x++) {
    for (var y = maxY; y >= minY; y--) {
      if (x % METATILE === 0 &&
          y % METATILE === 0) {
        tiles.push({
          z: zoom,
          x: x,
          y: y
        });
      }
    }
  }

  return tiles;
};

var getSubtiles = function(z, x, y) {
  return [
    { z: z + 1, x: x * 2, y: y * 2 },
    { z: z + 1, x: x * 2 + 1, y: y * 2 },
    { z: z + 1, x: x * 2, y: y * 2 + 1 },
    { z: z + 1, x: x * 2 + 1, y: y * 2 + 1 }
  ];
};

var argv = {};

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
    throw err;
  }

  var jobs = kue.createQueue();

  // TODO pack maxZoom into the payload
  // TODO pack retina into the payload
  // TODO pay bbox into the payload
  var maxZoom = 14;

  jobs.process("render", function(job, callback) {
    var queueSubtiles = function(tile) {
      if (tile.z < maxZoom) {
        var subtiles = getSubtiles(tile.z, tile.x, tile.y).filter(function(t) {
          return (t.x % METATILE === 0 &&
                  t.y % METATILE === 0);
        });

        subtiles.forEach(function(x) {
          x.title = util.format("/%d/%d/%d.png", x.z, x.x, x.y);
          jobs.create("render", x).priority(x.z).save();
        });
      }
    };

    var task = job.data;

    // TODO this is dependent on METATILE (2x2 = METATILE = 2)
    var tiles = [
      { z: task.z, x: task.x, y: task.y },
      { z: task.z, x: task.x, y: task.y + 1 },
      { z: task.z, x: task.x + 1, y: task.y },
      { z: task.z, x: task.x + 1, y: task.y + 1}
    ];

    async.each(tiles, function(tile, done) {
      var path;

      if (argv.retina) {
        path = util.format("/%d/%d/%d@2x.png", tile.z, tile.x, tile.y);
      } else {
        path = util.format("/%d/%d/%d.png", tile.z, tile.x, tile.y);
      }

      console.log("rendering", path);

      // TODO time
      return source.getTile(tile.z, tile.x, tile.y, function(err, data, headers) {
        if (err) {
          console.warn(err);

          queueSubtiles(tile);

          return done(err);
        }

        // TODO configurable max-age
        headers["Cache-Control"] = "public,max-age=300";
        headers["x-amz-acl"] = "public-read";

        // uploadQueue.push({
        //   path: path,
        //   tile: data,
        //   headers: headers
        // });

        queueSubtiles(tile);

        return done();
      });
    }, callback);
  }, os.cpus().length * 4);

  var uploadQueue = async.queue(function(task, callback) {
    request.put({
      uri: util.format("http://%s.s3.amazonaws.com%s", S3_BUCKET, task.path),
      aws: {
        key: ACCESS_KEY_ID,
        secret: SECRET_ACCESS_KEY,
        bucket: S3_BUCKET
      },
      body: task.tile,
      headers: task.headers
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
  }, http.globalAgent.maxSockets);
});
