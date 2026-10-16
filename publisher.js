require('dotenv').config();
const mqtt = require('mqtt');
const express = require('express');
const path = require('path');

const url = process.env.MQTT_URL || 'mqtt://localhost:1883';
const topic = process.env.TOPIC || 'iot/demo/temperature';
const port = process.env.PORT || 3000;

const client = mqtt.connect(url, {
  username: process.env.MQTT_USERNAME || undefined,
  password: process.env.MQTT_PASSWORD || undefined,
});

client.on('connect', () => console.log('[PUB] Connected:', url));
client.on('error', (err) => console.error('[PUB] Error:', err.message));

// ---- 数据缓存与 SSE 客户端 ----
const MAX_HISTORY = 120; // 保留最近 120 条（约 4 分钟）
const history = [];
const sseClients = [];

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    res.write(msg);
  }
}

// 模拟设备上报温度（顶层定时器，不依赖 MQTT 连接成功）
setInterval(() => {
  const data = {
    deviceId: 'sensor-001',
    ts: Date.now(),
    temperature: Number((20 + Math.random() * 5).toFixed(2)),
    humidity: Number((40 + Math.random() * 10).toFixed(2)),
  };
  const payload = JSON.stringify(data);

  // 仅在 MQTT 已连接时发布
  if (client.connected) {
    client.publish(topic, payload, { qos: 0 }, (err) => {
      if (err) {
        console.error('[PUB] Publish error:', err.message);
      } else {
        console.log('[PUB] Sent:', payload);
      }
    });
  }

  // 写入历史并推送给网页客户端
  history.push(data);
  if (history.length > MAX_HISTORY) history.shift();
  broadcast(data);
}, 2000);

// ---- Express 网页界面 ----
const app = express();

app.use(express.static(path.join(__dirname, 'public')));

// 根路径返回仪表盘页面
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// 历史数据，供页面初始化
app.get('/api/history', (req, res) => {
  res.json(history);
});

// SSE 实时推送
app.get('/api/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  sseClients.push(res);
  req.on('close', () => {
    const idx = sseClients.indexOf(res);
    if (idx !== -1) sseClients.splice(idx, 1);
  });
});

app.listen(port, () => {
  console.log(`[WEB] Dashboard: http://localhost:${port}`);
});
