const dotenv = require('dotenv');
dotenv.config();

console.log('Google creds path:', process.env.GOOGLE_APPLICATION_CREDENTIALS);

const express = require('express');
const admin = require('firebase-admin');
const twilio = require('twilio');
const cors = require('cors');

const serviceAccount = require('./firebase-key.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const messaging = admin.messaging();
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/alert', async (req, res) => {
  try {
    const { type, message, zone, state } = req.body;

    const alertDoc = await db.collection('alerts').add({
      type: type,
      message: message,
      zone: zone,
      state: state,
      timestamp: new Date(),
      status: 'new'
    });

    const responderTypes = {
      medical: ['hospital', 'ambulance'],
      security: ['police', 'civil-defence'],
      fire: ['fire-service', 'lasema'],
      community: ['volunteer']
    };

    const targets = responderTypes[type] || [];

    for (const target of targets) {
      const responders = await db.collection('responders')
        .where('type', '==', target)
        .where('zone', '==', zone)
        .get();

      responders.forEach(async (doc) => {
        const responder = doc.data();

        if (responder.fcmToken) {
          await messaging.send({
            notification: {
              title: `New ${type.toUpperCase()} alert in ${zone}`,
              body: message || 'Anonymous alert received'
            },
            data: {
              alertId: alertDoc.id,
              zone: zone
            },
            token: responder.fcmToken
          });
        }

        if (responder.phone) {
          await twilioClient.messages.create({
            body: `AnonymousMe alert (${type}): ${message || 'Alert received'} - Zone: ${zone}`,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: responder.phone
          });
        }
      });
    }

    res.json({ success: true, alertId: alertDoc.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/alerts/:zone', async (req, res) => {
  try {
    const { zone } = req.params;
    const snapshot = await db.collection('alerts')
      .where('zone', '==', zone)
      .orderBy('timestamp', 'desc')
      .limit(50)
      .get();

    const alerts = [];
    snapshot.forEach(doc => {
      alerts.push({ id: doc.id, ...doc.data() });
    });

    res.json(alerts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/responder/register', async (req, res) => {
  try {
    const { name, type, zone, phone, fcmToken } = req.body;

    await db.collection('responders').add({
      name: name,
      type: type,
      zone: zone,
      phone: phone,
      fcmToken: fcmToken,
      timestamp: new Date()
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/alert/resolve', async (req, res) => {
  try {
    const { alertId } = req.body;

    await db.collection('alerts').doc(alertId).update({
      status: 'resolved',
      resolvedAt: new Date()
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`AnonymousMe backend running on port ${PORT}`);
});