const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const cors = require('cors');
const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const app = express();
app.use(cors({
  origin: [
    'https://anonymousme-frontend.vercel.app',
    'http://localhost:3000'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
  credentials: true
}));
app.use(express.json());

const authenticateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Unauthorized. Invalid API key.' });
  }
  next();
};

const deviceAlertCount = {};

const rateLimit = (req, res, next) => {
  const deviceId = req.body.deviceId || req.ip;
  const now = Date.now();

  if (!deviceAlertCount[deviceId]) {
    deviceAlertCount[deviceId] = [];
  }

  deviceAlertCount[deviceId] = deviceAlertCount[deviceId].filter(time => now - time < 3600000);

  if (deviceAlertCount[deviceId].length >= 20) {
    return res.status(429).json({ error: 'Too many alerts. Please wait before sending another.' });
  }

  deviceAlertCount[deviceId].push(now);
  next();
};

app.post('/api/alert', authenticateApiKey, rateLimit, async (req, res) => {
  try {
    const { type, message, zone, state, deviceId } = req.body;

    const { data, error } = await supabase
      .from('alerts')
      .insert([{
        type,
        message,
        zone,
        state,
        lga: req.body.lga || null,
        status: 'new',
        confirmations: 0,
        confirmed: false,
        dispatched: false,
        evidence_url: req.body.evidenceUrl || null
      }])
      .select();

    if (error) throw error;

    res.json({
      success: true,
      alertId: data[0].id,
      message: 'Alert received. Waiting for confirmation from others in your area before dispatching to responders.'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/alert/confirm', authenticateApiKey, async (req, res) => {
  try {
    const { alertId } = req.body;

    const { data: alert } = await supabase
      .from('alerts')
      .select('*')
      .eq('id', alertId)
      .single();

    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    const newConfirmations = (alert.confirmations || 0) + 1;
    const isConfirmed = newConfirmations >= 2;

    const { error } = await supabase
      .from('alerts')
      .update({
        confirmations: newConfirmations,
        confirmed: isConfirmed,
        dispatched: isConfirmed
      })
      .eq('id', alertId);

    if (error) throw error;

    if (isConfirmed && !alert.dispatched) {
      const { data: responders } = await supabase
        .from('responders')
        .select('*')
        .eq('zone', alert.state);

      if (responders && responders.length > 0) {
        responders.forEach(responder => {
          if (responder.phone) {
            twilioClient.messages.create({
              body: `CONFIRMED AnonymousMe ALERT (${alert.type.toUpperCase()}): ${alert.message || 'Alert confirmed by multiple users'} - Zone: ${alert.zone}, State: ${alert.state}. Please respond immediately.`,
              from: process.env.TWILIO_PHONE_NUMBER,
              to: responder.phone
            }).then(() => console.log('SMS sent to', responder.phone))
              .catch(err => console.log('SMS failed:', err.message));
          }
        });
      }
    }

    res.json({
      success: true,
      confirmations: newConfirmations,
      confirmed: isConfirmed,
      message: isConfirmed ? 'Alert confirmed and responders notified' : `Alert needs ${2 - newConfirmations} more confirmation(s)`
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/alerts/:zone', authenticateApiKey, async (req, res) => {
  try {
    const { zone } = req.params;

    const { data, error } = await supabase
      .from('alerts')
      .select('*')
      .or(`zone.eq.${zone},state.eq.${zone}`)
      .eq('status', 'new')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/responder/register', authenticateApiKey, async (req, res) => {
  try {
    const { name, type, zone, phone, fcmToken, serviceNumber } = req.body;

    const { error } = await supabase
      .from('responders')
      .insert([{ 
        name, 
        type, 
        zone, 
        phone, 
        fcm_token: fcmToken,
        service_number: serviceNumber,
        verified: serviceNumber ? true : false
      }]);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/alert/resolve', authenticateApiKey, async (req, res) => {
  try {
    const { alertId } = req.body;

    const { error } = await supabase
      .from('alerts')
      .update({ status: 'resolved' })
      .eq('id', alertId);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/alert/false', authenticateApiKey, async (req, res) => {
  try {
    const { alertId } = req.body;

    const { error } = await supabase
      .from('alerts')
      .update({ status: 'false_alert' })
      .eq('id', alertId);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.post('/api/alert/false', async (req, res) => {
  try {
    const { alertId } = req.body;

    const { error } = await supabase
      .from('alerts')
      .update({ status: 'false_alert' })
      .eq('id', alertId);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/alert/backup', authenticateApiKey, async (req, res) => {
  try {
    const { alertId, responderName, responderType, zone } = req.body;

    const { data: alert } = await supabase
      .from('alerts')
      .select('*')
      .eq('id', alertId)
      .single();

    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    const { data: responders } = await supabase
      .from('responders')
      .select('*')
      .eq('zone', alert.state);

    if (responders && responders.length > 0) {
      responders.forEach(responder => {
        if (responder.phone) {
          twilioClient.messages.create({
            body: `BACKUP NEEDED — AnonymousMe Alert (${alert.type.toUpperCase()}): ${alert.message || 'Backup requested'} - Zone: ${alert.zone}, State: ${alert.state}. Requested by: ${responderName} (${responderType}). Please respond immediately.`,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: responder.phone
          }).then(() => console.log('Backup SMS sent to', responder.phone))
            .catch(err => console.log('Backup SMS failed:', err.message));
        }
      });
    }

    res.json({ success: true, notified: responders ? responders.length : 0 });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`AnonymousMe backend running on port ${PORT}`);
});