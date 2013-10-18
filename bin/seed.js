#!/usr/bin/env node

"use strict";

var util = require("util");

var async = require("async"),
    env = require("require-env"),
    kue = require("../lib/kue"),
    SphericalMercator = require("sphericalmercator");

var METATILE = +process.env.METATILE || 4,
    STYLE_NAME = env.require("STYLE_NAME"),
    DEBUG = !!process.env.DEBUG;

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


var queue = async.queue(function(task, callback) {
  if (DEBUG) {
    console.log("Queuing", task);
  }

  return jobs
    .create("render-" + STYLE_NAME, task)
    .priority(0)
    .attempts(5)
    .save(callback);
});

var queueMetaTiles = function(zoom, range) {
  var minX = range.minX - (range.minX % METATILE),
      maxX = range.maxX - (METATILE - (range.maxX % METATILE)),
      minY = range.minY - (range.minY % METATILE),
      maxY = range.maxY - (METATILE - (range.maxY % METATILE));

  for (var x = minX; x <= maxX; x++) {
    for (var y = maxY; y >= minY; y--) {
      if (x % METATILE === 0 &&
          y % METATILE === 0) {

        var task = {
          z: zoom,
          x: x,
          y: y
        };

        if (argv.retina) {
          task.path = util.format("/%d/%d/%d@2x.png", task.z, task.x, task.y);
        } else {
          task.path = util.format("/%d/%d/%d.png", task.z, task.x, task.y);
        }

        task.title = task.path;
        task.bbox = bbox;
        task.maxZoom = maxZoom;
        task.retina = !!argv.retina;
        task.metaTile = METATILE;
        task.style = STYLE_NAME;

        queue.push(task);
      }
    }
  }
};

var bbox = argv.bbox.split(" ", 4).map(Number);
var zoom = argv.z;
var maxZoom = argv.Z;

console.log("Rendering [%s] from z%d-%d", bbox.join(", "), zoom, maxZoom);

var jobs = kue.createQueue();

queueMetaTiles(zoom, merc.xyz(bbox, zoom));

queue.drain = function() {
  process.exit();
};
