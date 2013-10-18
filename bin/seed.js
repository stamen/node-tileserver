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

var bbox = argv.bbox.split(" ", 4).map(Number);
var zoom = argv.z;
var maxZoom = argv.Z;

console.log("Rendering [%s] from z%d-%d", bbox.join(", "), zoom, maxZoom);

var jobs = kue.createQueue();

async.each(getMetaTiles(zoom, merc.xyz(bbox, zoom)), function(tile, done) {
  var path;

  if (argv.retina) {
    path = util.format("/%d/%d/%d@2x.png", tile.z, tile.x, tile.y);
  } else {
    path = util.format("/%d/%d/%d.png", tile.z, tile.x, tile.y);
  }

  tile.title = path;
  tile.bbox = bbox;
  tile.maxZoom = maxZoom;
  tile.retina = !!argv.retina;
  tile.metaTile = METATILE;

  if (DEBUG) {
    console.log("Queueing %s as %j", STYLE_NAME, tile);
  }

  jobs
    .create("render-" + STYLE_NAME, tile)
    .priority(0)
    .attempts(5)
    .save(done);
}, function() {
  process.exit();
});
