#!/usr/bin/env node

"use strict";

var url = require("url");

var redis = require("kue/node_modules/redis");

var redisUrl = url.parse(process.env.REDIS_URL),
    client = redis.createClient(redisUrl.port, redisUrl.hostname);

if (redisUrl.auth) {
  client.auth(redisUrl.auth.split(":")[1]);
}

client.flushall(function() {
  console.log("Queue flushed.");
  process.exit();
});
