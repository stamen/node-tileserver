#!/usr/bin/env node

"use strict";

var util = require("util");

var async = require("async"),
    env = require("require-env"),
    ProgressBar = require("progress"),
    SphericalMercator = require("sphericalmercator");

var q = require("../lib/queue"),
    tbd = require("../lib");

var DEBUG = !!process.env.DEBUG;

var merc = new SphericalMercator({
  size: process.env.TILE_SIZE || 256
});

var argv = require("optimist")
    .usage("Usage: $0 -b=<bbox> -z <min zoom> -Z <max zoom>")
    .alias("b", "bbox")
    .describe("b", "Bounding box.")
    .alias("z", "min-zoom")
    .describe("z", "Min zoom (inclusive).")
    .alias("Z", "max-zoom")
    .describe("Z", "Max zoom (inclusive).")
    .alias("r", "retina")
    .describe("r", "Render retina tiles.")
    .demand(["b", "z", "Z"])
    .argv;

// first arg is a placeholder for options
tbd.loadInfo({}, function(err, info) {
  if (err) {
    console.error(err.stack);
    process.exit(1);
  }

  var bbox = argv.bbox.split(" ", 4).map(Number),
      zoom = argv.z,
      maxZoom = argv.Z,
      merc = new SphericalMercator({
        size: info.tileSize
      });

  console.log("Rendering [%s] from z%d-%d", bbox.join(", "), zoom, maxZoom);

  var range = merc.xyz(bbox, zoom),
      tileCount = (1 + range.maxX - range.minX) * (1 + range.maxY - range.minY) / info.metatile,
      bar = new ProgressBar(util.format("%s [:bar] :percent :etas", info.name), {
        total: tileCount,
        incomplete: " ",
        width: 72
      }),
      queue = createQueue(info.name, q.createQueue());

  return metaTiles(range, info, function(xy, callback) {
    var task = xy;
    task.z = zoom;

    if (argv.retina) {
      task.path = util.format("/%d/%d/%d@2x.png", task.z, task.x, task.y);
    } else {
      task.path = util.format("/%d/%d/%d.png", task.z, task.x, task.y);
    }

    task.title = task.path;
    task.bbox = bbox;
    task.maxZoom = maxZoom;
    task.retina = !!argv.retina;
    task.metaTile = info.metatile;
    task.style = info.name;

    queue.push(task, bar.tick.bind(bar));

    return callback();
  }, function(err) {
    var code = 0;

    if (err) {
      console.error(err.stack);
      code = 1;
    }

    queue.drain = function() {
      process.exit(code);
    };
  });
});

var createQueue = function(styleName, queue) {
  return async.queue(function(task, callback) {
    if (DEBUG) {
      console.log("Queuing", task);
    }

    return queue
      .create(styleName, task)
      .priority(0)
      .attempts(5)
      .save(callback);
  }, 50);
};

var metaTiles = function(range, info, iterator, callback) {
  callback = callback || function() {};

  var metatile = info.metatile;

  // start on the left-/top-most metatile
  var minX = range.minX - (range.minX % metatile),
      maxX = range.maxX,
      minY = range.minY - (range.minY % metatile),
      maxY = range.maxY;

  var x = minX;

  return async.whilst(function() {
    return x <= maxX;
  }, function(nextRow) {
    var y = maxY;

    return async.whilst(function() {
      return y >= minY;
    }, function(nextCol) {
      if (x % metatile === 0 &&
          y % metatile === 0) {
        return iterator({
          x: x,
          y: y
        }, function() {
          y--;
          return setImmediate(nextCol);
        });
      }

      y--;
      return nextCol();
    }, function() {
      x++;

      return nextRow();
    });
  }, callback);
};
