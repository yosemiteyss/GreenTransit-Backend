const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccount.json');
const firebaseFunctions = require('firebase-functions');

// Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Firestore
const db = admin.firestore();
db.settings({
  ignoreUndefinedProperties: true,
});

// Functions
const functions = firebaseFunctions.region('asia-east2');

module.exports = {
  admin,
  db,
  functions,
};
