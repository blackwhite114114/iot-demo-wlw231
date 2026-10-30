require('dotenv').config();
const path = require('path');
const express = require('express');
const mqtt = require('mqtt');
const Database = require('better-sqlite3');

const url = process.env.MQTT_URL || 'mqtt://localhost:1883';
const topic = process.env.TOPIC || 'iot/demo/temperature';
const PORT = process.env.PORT || 3000;

// ---------- SQLite：数据库落地 ----------
const db = new Database(process.env.DB_PATH || path.join(__dirname, 'sensor-data.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS readings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id   TEXT    NOT NULL,
    ts          INTEGER NOT NULL,            -- 设备上报时间戳(ms)
    temperature REAL,
    humidity    REAL,
    received_at TEXT    DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_readings_device_ts ON readings (device_id, ts);
`);
const insertStmt = db.prepare(
  'INSERT INTO readings (device_id, ts, temperature, humidity) VALUES (?, ?, ?, ?)'
);

// ---------- MQTT：订阅并落库 ----------
const client = mqtt.connect(url, {
  username: process.env.MQTT_USERNAME || undefined,
  password: process.env.MQTT_PASSWORD || undefined,
  reconnectPeriod: 1000,
});

// SSE 客户端集合（实时推送新数据）
const sseClients = new Set();

client.on('connect', () => {
  console.log('[SRV] MQTT connected:', url);
  client.subscribe(topic, { qos: 0 });
});

client.on('message', (t, payload) => {
  const text = payload.toString();
  try {
    const data = JSON.parse(text);
    const row = {
      deviceId: data.deviceId ?? 'unknown',
      ts: data.ts ?? Date.now(),
      temperature: data.temperature != null ? Number(data.temperature) : null,
      humidity: data.humidity != null ? Number(data.humidity) : null,
    };
    insertStmt.run(row.deviceId, row.ts, row.temperature, row.humidity);
    sseClients.forEach((res) => res.write(`data: ${JSON.stringify(row)}\n\n`));
    console.log('[SRV] saved:', text);
  } catch (err) {
    console.error('[SRV] 落库失败:', err.message);
  }
});

client.on('error', (err) => console.error('[SRV] MQTT error:', err.message));

// ---------- Express：页面 + API ----------
const app = express();

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/history', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'visualization_history.html'));
});

// 实时仪表盘用的最近数据（内存缓存没有，直接查库）
app.get('/api/history', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 120, 5000);
  const rows = db
    .prepare('SELECT device_id, ts, temperature, humidity FROM readings ORDER BY ts DESC LIMIT ?')
    .all(limit)
    .reverse();
  res.json(rows);
});

// 历史查询：支持设备、时间范围、条数
app.get('/api/query', (req, res) => {
  const device = req.query.device || 'sensor-001';
  const from = Number(req.query.from) || 0;
  const to = Number(req.query.to) || Date.now();
  const limit = Math.min(Number(req.query.limit) || 500, 10000);
  const rows = db
    .prepare(
      `SELECT device_id, ts, temperature, humidity, received_at
       FROM readings
       WHERE device_id = ? AND ts >= ? AND ts <= ?
       ORDER BY ts DESC LIMIT ?`
    )
    .all(device, from, to, limit);
  res.json(rows.reverse());
});

// 设备列表与数据概况
app.get('/api/devices', (req, res) => {
  const rows = db
    .prepare('SELECT device_id, COUNT(*) AS count, MAX(ts) AS last_ts FROM readings GROUP BY device_id')
    .all();
  res.json(rows);
});

// SSE 实时流
app.get('/api/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

app.listen(PORT, () => {
  console.log(`[SRV] Web: http://localhost:${PORT}  |  历史页: http://localhost:${PORT}/history`);
});

// 退出时清理
process.on('SIGINT', () => {
  sseClients.forEach((res) => res.end());
  db.close();
  client.end(true);
  process.exit(0);
});
