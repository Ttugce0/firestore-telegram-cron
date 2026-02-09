const admin = require("firebase-admin");

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  throw new Error("FIREBASE_SERVICE_ACCOUNT env değişkeni yok");
}

const serviceAccount = JSON.parse(
  Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, "base64").toString("utf-8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

module.exports = db;
