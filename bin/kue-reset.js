#!/usr/bin/env node

"use strict";

var url = require("url");

var env = require("require-env"),
    redis = require("kue/node_modules/redis");

var redisUrl = url.parse(env.require("REDIS_URL")),
    client = redis.createClient(redisUrl.port, redisUrl.hostname);

if (redisUrl.auth) {
  client.auth(redisUrl.auth.split(":")[1]);
}

client.flushall(function() {
  console.log("Queue flushed.");
  process.exit();
});
