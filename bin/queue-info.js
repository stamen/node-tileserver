#!/usr/bin/env node
"use strict";

var AWS = require("aws-sdk"),
    env = require("require-env");

// TODO get this from the stylesheet
var STYLE_NAME = env.require("STYLE_NAME");

AWS.config.update({
  region: process.env.AWS_DEFAULT_REGION || "us-east-1"
});

var sqs = new AWS.SQS();

sqs.getQueueUrl({
  QueueName: STYLE_NAME
}, function(err, data) {
  if (err) {
    throw err;
  }

  console.log(data.QueueUrl);

  return sqs.getQueueAttributes({
    QueueUrl: data.QueueUrl,
    AttributeNames: ["All"]
  }, function(err, data) {
    if (err) {
      throw err;
    }

    Object.keys(data.Attributes).forEach(function(k) {
      console.log("%s:", k, data.Attributes[k]);
    });
  });
});
