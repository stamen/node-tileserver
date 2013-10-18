"use strict";

var url = require("url");

var kue = require("kue"),
    redis = require("kue/node_modules/redis");

kue.redis.createClient = function() {
  if (!process.env.REDIS_URL) {
    console.warn("REDIS_URL not set, kue will not work.");
    return;
  }

  var redisUrl = url.parse(process.env.REDIS_URL),
      client = redis.createClient(redisUrl.port, redisUrl.hostname);

  if (redisUrl.auth) {
    client.auth(redisUrl.auth.split(":")[1]);
  }

  return client;
};

module.exports = kue;
