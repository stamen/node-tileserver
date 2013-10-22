#!/usr/bin/env node
"use strict";

var AWS = require("aws-sdk"),
    env = require("require-env");

var STYLE_NAME = env.require("STYLE_NAME");

// TODO pull from environment
AWS.config.update({region: "us-east-1"});

var sqs = new AWS.SQS();

// sqs.createQueue({
//   QueueName: "render-" + STYLE_NAME,
//   Attributes: {
//     VisibilityTimeout: "180"
//   }
// }, function(err, data) {
//   if (err) {
//     throw err;
//   }
// 
//   sqs.deleteQueue({
//     QueueUrl: data.QueueUrl
//   }, function(err, data) {
//     console.log(arguments);
//   });
// });

sqs.createQueue({
  QueueName: STYLE_NAME,
  Attributes: {
    VisibilityTimeout: "150"
  }
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
