"use strict";

var express = require("express"),
    tilelive = require("tilelive");

require("tilelive-mapnik").registerProtocols(tilelive);

var app = express();

tilelive.load("mapnik://./stylesheet.xml", function(err, source) {
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
