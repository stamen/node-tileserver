#!/usr/bin/env node
"use strict";

var cors = require("cors"),
    express = require("express");

var app = express(),
    renderer = require("../lib/renderer");

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

// TODO path should optionally be a command-line argument for relative
// filenames to work, we should probably chdir to the directory containing the
// stylesheet (once it's configurable)
renderer.initialize({
  maxAge: 3600, // TODO configurable, note that it can come from the stylesheet
  surrogateControl: "max-age=2592000",
  surrogateKey: "{{info.name}} {{tile.z}} {{info.name}}/{{tile.z}} {{info.format}}"
}, function(err, routes, info) {
  app.use(routes);

  return app.listen(process.env.PORT || 8080, function() {
    console.log("Listening at http://%s:%d/", this.address().address, this.address().port);
  });
});
