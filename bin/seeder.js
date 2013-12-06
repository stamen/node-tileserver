#!/usr/bin/env node

"use strict";

var http = require("http"),
    os = require("os"),
    path = require("path"),
    util = require("util");

var async = require("async"),
    env = require("require-env"),
    metricsd = require("metricsd"),
    request = require("request"),
    retry = require("retry"),
    SphericalMercator = require("sphericalmercator"),
    tilelive = require("tilelive"),
    tileliveMapnik = require("tilelive-mapnik");

tileliveMapnik.registerProtocols(tilelive);

var q = require("../lib/queue"),
    tbd = require("../lib");

http.globalAgent.maxSockets = 200;

var metrics = metricsd({
  log: !!process.env.ENABLE_METRICS
});

var ACCESS_KEY_ID = env.require("AWS_ACCESS_KEY_ID"),
    SECRET_ACCESS_KEY = env.require("AWS_SECRET_ACCESS_KEY"),
    S3_BUCKET = env.require("S3_BUCKET"),
    PATH_PREFIX = process.env.PATH_PREFIX || "",
    DEBUG = !!process.env.DEBUG;

// add a leading slash if necessary
if (PATH_PREFIX && PATH_PREFIX.indexOf("/") !== 0) {
  PATH_PREFIX = "/" + PATH_PREFIX;
}


tbd.getSources({
  path: path.join(process.cwd(), "stylesheet.xml")
}, function(err, sources, info) {
  if (err) {
    console.error(err.stack);
    process.exit(1);
  }

  console.log(info);

  var queue = q.createQueue(info.name);

  queue.process(os.cpus().length * 4, createWorker(sources, info, queue));

  if (!process.env.DYNO || process.env.DYNO === "worker.1") {
    // log locally / on the first worker
    setInterval(function() {

      return async.parallel({
        queued: async.apply(queue.inactiveCount.bind(queue)),
        active: async.apply(queue.activeCount.bind(queue)),
        running: async.apply(queue.runningCount.bind(queue)),
        pending: async.apply(queue.runningCount.bind(queue))
      }, function(err, counts) {
        metrics.updateGauge("jobs.pending_uploads", pendingUploads);
        metrics.updateGauge("jobs.queued", counts.queued);
        metrics.updateGauge("jobs.active", counts.active);

        console.log("==============================");
        console.log("  %d pending upload(s)", pendingUploads);
        console.log("  %d queued job(s)", counts.queued);
        console.log("  %d active job(s)", counts.active);
        console.log("  %d locally running job(s)", counts.running);
        console.log("  %d locally pending job(s)", counts.pending - counts.running);
        console.log("==============================");
      });
    }, 5000).unref();
  }
});

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
      return (t.x % task.metatile === 0 &&
              t.y % task.metatile === 0);
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
      x.metatile = task.metatile;
      x.style = task.style;

      jobs
        .create(x)
        .priority(x.z)
        .attempts(5)
        .save();
    });
  }
};

var pendingUploads = 0;

var upload = function(path, headers, body, callback) {
  callback = callback || function() {};

  pendingUploads++;

  var operation = retry.operation({
    retries: 5,
    minTimeout: 50,
    maxTimeout: 1000
  });

  // add S3-specific headers
  headers["x-amz-acl"] = "public-read";
  headers["x-amz-storage-class"] = "REDUCED_REDUNDANCY";

  return operation.attempt(function(currentAttempt) {
    return request.put({
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
      if (operation.retry(err)) {
        return;
      }

      pendingUploads--;

      if (err) {
        return callback(operation.mainError());
      }

      if (response.statusCode === 200) {
        return callback();
      } else {
        return callback(new Error(util.format("%d: %s", response.statusCode, body)));
      }
    });
  });
};

var createWorker = function(sources, info, queue) {
  var merc = new SphericalMercator({
    size: info.tileSize
  });

  return function(job, callback) {
    var task = job.data,
        tiles = [];

    for (var x = task.x; x < task.x + task.metatile; x++) {
      for (var y = task.y; y < task.y + task.metatile; y++) {
        tiles.push({ z: task.z, x: x, y: y });
      }
    }

    // validate coords against bounds
    var xyz = merc.xyz(task.bbox, task.z);

    tiles = tiles.filter(function(t) {
      return t.x >= xyz.minX &&
              t.x <= xyz.maxX &&
              t.y >= xyz.minY &&
              t.y <= xyz.maxY;
    });

    var scale = task.retina ? 2 : 1,
        source = sources["@" + scale + "x"];

    return async.each(tiles, function(tile, done) {
      var path;

      // TODO use info.format for this (and simplify so that the correct
      // extension is actually chosen)
      if (task.retina) {
        path = util.format("/%d/%d/%d@2x.png", tile.z, tile.x, tile.y);
      } else {
        path = util.format("/%d/%d/%d.png", tile.z, tile.x, tile.y);
      }

      if (DEBUG) {
        console.log("rendering", path);
      }

      if (info.interactivity_layer) {
        // TODO success of this job does not depend on completion of the grid
        // render
        source.getGrid(tile.z, tile.x, tile.y,
                       metrics.timeCallback("render.grid" + scale + "x.z" + tile.z,
                                            function(err, data, headers) {
          if (!err) {
            // TODO configurable max-age / Surrogate headers
            // renderer allows max-age to be set as info.maxAge, so that should
            // be respected as should the rest
            // Surrogate-Key could be {{mustached}}
            // TODO spend some more time thinking about surrogate keys (format,
            // retina, various combinations)
            headers["Cache-Control"] = "public,max-age=3600";
            headers["x-amz-meta-Surrogate-Control"] = "max-age=2592000";
            headers["x-amz-meta-Surrogate-Key"] = [
              info.name,
              "z" + tile.z,
              [info.name, "z" + tile.z].join("/"),
              "json"
            ].join(" ");

            upload(util.format("/%d/%d/%d.json", tile.z, tile.x, tile.y), headers, data);
          }
        }));
      }

      // TODO check if it's already in S3 before rendering (for slow tiles?)
      // TODO when this is rendering a metatile, it would be nice to get back
      // a list of the other tiles that got rendered so we can fetch them
      // separately
      return source.getTile(tile.z, tile.x, tile.y,
                            metrics.timeCallback("render." + scale + "x.z" + tile.z,
                                                function(err, data, headers) {
        queueSubtiles(queue, task, tile);

        if (!err) {
          // TODO configurable max-age / Surrogate headers
          // renderer allows max-age to be set as info.maxAge, so that should
          // be respected as should the rest
          // Surrogate-Key could be {{mustached}}
          headers["Cache-Control"] = "public,max-age=3600";
          headers["x-amz-meta-Surrogate-Control"] = "max-age=2592000";
          headers["x-amz-meta-Surrogate-Key"] = [
            info.name,
            "z" + tile.z,
            [info.name, "z" + tile.z].join("/"),
            "png"
          ].join(" ");

          // TODO if image was solid (and transparent), register an S3 redirect
          // instead of uploading:
          // http://stackoverflow.com/questions/2272835/amazon-s3-object-redirect
          // tilelive-mapnik does not currently expose whether that's the case,
          // although it knows:
          // https://github.com/mapbox/tilelive-mapnik/blob/master/lib/render.js#L91
          // NOTE: 334 is the size of a 256x256 transparent tile

          // NOTE: no callback here--fire and forget
          upload(path, headers, data);
        }

        // claim that we're done and let the upload take care of itself
        return done(err);
      }));
    }, callback);
  };
};

