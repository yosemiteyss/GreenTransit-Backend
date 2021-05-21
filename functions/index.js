const functions = require('firebase-functions');
const crawlJob = require('./crawlJob');

exports.crawlJob = functions
    .runWith({
      timeoutSeconds: 540,
      memory: '1GB'
    })
    .pubsub
    .schedule('0 0 * * *')
    .timeZone('Asia/Hong_Kong')
    .onRun(crawlJob);
