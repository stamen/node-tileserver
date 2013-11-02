"use strict";

var async = require("async"),
    AWS = require("aws-sdk");

AWS.config.update({
  region: process.env.AWS_DEFAULT_REGION || "us-east-1"
});

var sqs = new AWS.SQS();

var Job = function(queue, data) {
  this.queue = queue;
  this.payload = {
    attempts: 1,
    data: data
  };
};

Job.prototype.priority = function(priority) {
  // console.warn("Not implemented: priority");

  return this;
};

Job.prototype.attempts = function(attempts) {
  this.payload.attempts = attempts;

  return this;
};

Job.prototype.save = function(callback) {
  callback = callback || function() {};

  var self = this;

  sqs.createQueue({
    QueueName: self.queue,
    Attributes: {
      VisibilityTimeout: "150" // 2.5 minutes
    }
  }, function(err, data) {
    if (err) {
      return callback(err);
    }

    return sqs.sendMessage({
      QueueUrl: data.QueueUrl,
      MessageBody: JSON.stringify(self.payload)
    }, function(err, data) {
      if (err) {
        return callback(err);
      }

      self.messageId = data.messageId;

      return callback(null, err);
    });
  });

  return this;
};

module.exports.createQueue = function() {
  return {
    create: function(queue, data) {
      return new Job(queue, data);
    },

    process: function(queueName, concurrency, worker) {
      var queue = this.queue = async.queue(worker, concurrency);
      var pause = false;

      queue.saturated = function() {
        // queue is saturated--pause
        pause = true;
      };

      queue.empty = function() {
        // queue has emptied--resume
        pause = false;
      };

      sqs.getQueueUrl({
        QueueName: queueName
      }, function(err, data) {
        if (err) {
          console.warn(err.stack);
          return;
        }

        var queueUrl = data.QueueUrl;

        return async.forever(function(callback) {
          var done = function() {
            var args = arguments;

            if (queue.length() > concurrency * 2) {
              return setImmediate(function() {
                return done.apply(null, args);
              });
            }

            return callback.apply(null, args);
          };

          return sqs.receiveMessage({
            QueueUrl: queueUrl,
            MaxNumberOfMessages: Math.min(10, concurrency),
            WaitTimeSeconds: 5,
            AttributeNames: ["ApproximateFirstReceiveTimestamp",
                            "ApproximateReceiveCount",
                            "SentTimestamp"]
          }, function(err, data) {
            if (err) {
              console.warn(err.stack);
              return done();
            }

            if (data.Messages) {
              var tasks = data.Messages.map(function(msg) {
                var attempts = +msg.Attributes.ApproximateReceiveCount;

                var payload;
                
                try {
                  payload = JSON.parse(msg.Body);
                } catch (e) {
                  console.warn(e);
                  return;
                }

                if (attempts > payload.attempts) {
                  // limit render attempts, deleting when it has failed out
                  sqs.deleteMessage({
                    QueueUrl: queueUrl,
                    ReceiptHandle: msg.ReceiptHandle
                  }, function(err, data) {
                    if (err) {
                      console.warn(err);
                      return;
                    }
                  });

                  return;
                }

                try {
                  return {
                    queue: queueUrl,
                    messageId: msg.MessageId,
                    receiptHandle: msg.ReceiptHandle,
                    attributes: msg.Attributes,
                    attempts: attempts,
                    data: payload.data
                  };
                } catch (e) {
                  console.warn(e);
                }
              }).filter(function(task) {
                // filter out tasks that failed to parse
                return !!task;
              });

              queue.push(tasks, function(err) {
                if (err) {
                  console.warn(err.stack);
                  return;
                }

                // TODO retry this (like uploads)
                return sqs.deleteMessage({
                  QueueUrl: this.data.queue,
                  ReceiptHandle: this.data.receiptHandle
                }, function(err, data) {
                  if (err) {
                    console.warn(err.stack);
                    return;
                  }
                });
              });
            }

            return done();
          });
        }, function(err) {
          console.warn(err.stack);
        });
      });
    },

    inactiveCount: function(callback) {
      return sqs.getQueueUrl({
        // TODO modify createQueue to specify a queue name and use that here
        QueueName: process.env.STYLE_NAME
      }, function(err, data) {
        if (err) {
          console.warn(err.stack);
          return;
        }

        return sqs.getQueueAttributes({
          QueueUrl: data.QueueUrl,
          AttributeNames: ["ApproximateNumberOfMessages"]
        }, function(err, data) {
          if (err) {
            return callback(err);
          }

          return callback(null, data.Attributes.ApproximateNumberOfMessages);
        });
      });
    },

    activeCount: function(callback) {
      return sqs.getQueueUrl({
        // TODO modify createQueue to specify a queue name and use that here
        QueueName: process.env.STYLE_NAME
      }, function(err, data) {
        if (err) {
          console.warn(err.stack);
          return;
        }

        return sqs.getQueueAttributes({
          QueueUrl: data.QueueUrl,
          AttributeNames: ["ApproximateNumberOfMessagesNotVisible"]
        }, function(err, data) {
          if (err) {
            return callback(err);
          }

          return callback(null, data.Attributes.ApproximateNumberOfMessagesNotVisible);
        });
      });
    },

    runningCount: function(callback) {
      return callback(null, this.queue.running());
    },

    pendingCount: function(callback) {
      return callback(null, this.queue.length());
    }
  };
};
