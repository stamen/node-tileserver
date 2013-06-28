"use strict";

var cors = require("cors"),
    express = require("express"),
    tilelive = require("tilelive");

require("tilelive-mapnik").registerProtocols(tilelive);

var app = express();

app.configure(function() {
  app.use(cors());
  app.use(express.static(__dirname + "/public"));
});

// tilelive.load("mapnik://./stylesheet.xml?metatile=15&scale=4&tileSize=1024&bufferSize=1024", function(err, source) {
// TODO these should be environment variables
tilelive.load("mapnik://./stylesheet.xml?metatile=15&bufferSize=128", function(err, source) {
  if (err) {
    console.error(err);
    process.exit(1);
  }

  // TODO templatize index.html to center on the right location

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
