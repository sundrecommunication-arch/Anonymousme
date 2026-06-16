const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const cors = require('cors');
const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/alert', async (req, res) => {
  try {
    const { type, message, zone, state } = req.body;

    const { data, error } = await supabase
      .from('alerts')
      .insert([{ type, message, zone, state, status: 'new' }])
      .select();

    if (error) throw error;

    res.json({ success: true, alertId: data[0].id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/alerts/:zone', async (req, res) => {
  try {
    const { zone } = req.params;

    const { data, error } = await supabase
      .from('alerts')
      .select('*')
      .eq('zone', zone)
      .eq('status', 'new')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/responder/register', async (req, res) => {
  try {
    const { name, type, zone, phone, fcmToken } = req.body;

    const { error } = await supabase
      .from('responders')
      .insert([{ name, type, zone, phone, fcm_token: fcmToken }]);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/alert/resolve', async (req, res) => {
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

app.post('/api/sms', async (req, res) => {
  try {
    const { phone, message } = req.body;

    await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phone
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