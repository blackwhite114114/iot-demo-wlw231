require('dotenv').config();
const mqtt = require('mqtt');

const url = process.env.MQTT_URL || 'mqtt://localhost:1883';
const topic = process.env.TOPIC || 'iot/demo/temperature';

const client = mqtt.connect(url, {
  username: process.env.MQTT_USERNAME || undefined,
  password: process.env.MQTT_PASSWORD || undefined,
  reconnectPeriod: 1000, // 断线重连
});

client.on('connect', () => {
  console.log('[SUB] Connected:', url);
  client.subscribe(topic, { qos: 0 }, (err) => {
    if (err) {
      console.error('[SUB] Subscribe error:', err);
    } else {
      console.log('[SUB] Subscribed to:', topic);
    }
  });
});

client.on('message', (t, payload) => {
  console.log(`[SUB] ${t} => ${payload.toString()}`);
});

client.on('error', (err) => {
  console.error('[SUB] Error:', err.message);
});