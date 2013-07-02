"use strict";

var util = require("util");
var cors = require("cors"),
    express = require("express"),
    tilelive = require("tilelive");

require("tilelive-mapnik").registerProtocols(tilelive);

var SCALE = process.env.SCALE || 1;
var METATILE = process.env.METATILE || 4;
var BUFFER_SIZE = process.env.BUFFER_SIZE || 128;
var TILE_SIZE = process.env.TILE_SIZE || 256;

var app = express();

app.configure(function() {
  app.use(cors());
  app.use(express.static(__dirname + "/public"));
});

// tilelive.load("mapnik://./stylesheet.xml?metatile=15&scale=4&tileSize=1024&bufferSize=1024", function(err, source) {
tilelive.load(util.format("mapnik://./stylesheet.xml?metatile=%d&bufferSize=%d&tileSize=%d&scale=%d",
                          META_TILE,
                          BUFFER_SIZE,
                          TILE_SIZE,
                          SCALE), function(err, source) {
  if (err) {
    console.error(err);
    process.exit(1);
  }

  // TODO templatize index.html to center on the right location and use correct
  // tile size / zoom offsets

  // TODO not all tiles will be PNGs
  app.get("/:z/:x/:y.png", function(req, res) {
    source.getTile(req.params.z, req.params.x, req.params.y, function(err, tile, headers) {
      if (err) {
        console.warn(err);
        return res.send(500);
      }

      res.set(headers);
      res.send(tile);
    });
  });

  app.listen(process.env.PORT || 8080, function() {
    console.log("Listening at http://%s:%d/", this.address().address, this.address().port);
  });
});
