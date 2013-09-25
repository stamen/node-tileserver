#!/usr/bin/env node

"use strict";

var http = require("http"),
    os = require("os"),
    url = require("url"),
    util = require("util");

var async = require("async"),
    env = require("require-env"),
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

var argv = require("optimist")
    .usage("Usage: $0 -b=<bbox> -z <min zoom> -Z <max zoom>")
    .alias("b", "bbox")
    .describe("b", "Bounding box.")
    .alias("z", "min-zoom")
    .describe("z", "Min zoom (inclusive).")
    .alias("Z", "max-zoom")
    .describe("Z", "Max zoom (inclusive).")
    .demand(["b", "z", "Z"])
    .argv;

var getTiles = function(zoom, range) {
  var tiles = [];

  for (var x = range.minX; x <= range.maxX; x++) {
    for (var y = range.maxY; y >= range.minY; y--) {
      tiles.push({
        z: zoom,
        x: x,
        y: y
      });
    }
  }

  return tiles;
};

var getSubtiles = function(z, x, y) {
  return [
    {
      z: z + 1,
      x: x * 2,
      y: y * 2
    },
    {
      z: z + 1,
      x: x * 2 + 1,
      y: y * 2
    },
    {
      z: z + 1,
      x: x * 2,
      y: y * 2 + 1
    },
    {
      z: z + 1,
      x: x * 2 + 1,
      y: y * 2 + 1
    }
  ];
};

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

  var bbox = argv.bbox.split(" ", 4);
  var zoom = argv.z;
  var maxZoom = argv.Z;

  console.log("Rendering [%s] from z%d-%d", bbox.join(", "), zoom, maxZoom);

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

  var renderQueue = async.queue(function(task, callback) {
    var done = function() {
      if (task.z < maxZoom) {
        // TODO when generating subtiles, attempt to cluster within metatiles
        // this probably means generating a hash of keys that can be claimed
        // / cleared
        setImmediate(function() {
          renderQueue.push(getSubtiles(task.z, task.x, task.y), function(err) {
            if (err) {
              console.error(err);
            }
          });
        });
      }

      return callback();
    };

    var path = util.format("/%d/%d/%d.png", task.z, task.x, task.y);

    request.head({
      uri: util.format("http://%s.s3.amazonaws.com%s", S3_BUCKET, path),
      aws: {
        key: ACCESS_KEY_ID,
        secret: SECRET_ACCESS_KEY,
        bucket: S3_BUCKET
      }
    }, function(err, rsp, body) {
      if (rsp && rsp.statusCode === 200) {
        // tile already exists
        console.log("skipping", path);
        return done();
      }

      console.log("rendering", path);

      return source.getTile(task.z, task.x, task.y, function(err, tile, headers) {
        // TODO configurable max-age
        headers["Cache-Control"] = "public,max-age=300";
        headers["x-amz-acl"] = "public-read";

        uploadQueue.push({
          path: path,
          tile: tile,
          headers: headers
        });

        return done();
      });
    });
  }, os.cpus().length * 2);

  setInterval(function() {
    console.log("render queue: %d/%d", renderQueue.running(), renderQueue.length());
    console.log("upload queue: %d/%d", uploadQueue.running(), uploadQueue.length());

    var renderHead = renderQueue.tasks[0];
    if (renderHead) {
      console.log(renderHead.data);
    }

    var uploadHead = uploadQueue.tasks[0];
    if (uploadHead) {
      console.log(uploadHead.data.path);
    }

    Object.keys(source._stats).forEach(function(k) {
      console.log("%s: %d", k, source._stats[k]);
    });

    if (renderQueue.length() === 0 &&
        renderQueue.running() === 0 &&
        uploadQueue.length() === 0 &&
        uploadQueue.running() === 0) {
      process.exit();
    }
  }, 15000);

  // TODO when generating tile coordinates, attempt to cluster within metatiles
  getTiles(zoom, merc.xyz(bbox, zoom)).forEach(function(tile) {
    renderQueue.push(tile, function(err) {
      if (err) {
        console.error(err);
      }
    });
  });
});
