#!/usr/bin/env node

"use strict";

var path = require("path"),
    util = require("util");

var async = require("async"),
    AWS = require("aws-sdk");

var tbd = require("../lib");

AWS.config.update({
  region: process.env.AWS_DEFAULT_REGION || "us-east-1"
});

var sqs = new AWS.SQS();

async.waterfall([
  async.apply(tbd.loadInfo, {
    path: path.join(process.cwd(), "stylesheet.xml")
  }),
  function(info, callback) {
    return sqs.getQueueUrl({
      QueueName: info.name
    }, callback);
  },
  function(data, callback) {
    return sqs.deleteQueue({
      QueueUrl: data.QueueUrl
    }, callback);
  }
], function(err) {
  if (err) {
    console.error(err.stack);
    process.exit(1);
  }

  console.log("Queue emptied.");
});
