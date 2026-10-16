# 计划：用 Express 为 publisher.js 添加数据可视化网页界面

## Summary

在 `publisher.js` 中内嵌一个 Express HTTP 服务（默认端口 3000），提供单页仪表盘：用 Chart.js 绘制温度/湿度实时曲线，通过 **SSE（Server-Sent Events）** 把每 2 秒生成的模拟数据推送给浏览器。原有 MQTT 发布逻辑保持不变。

## Current State Analysis

- [publisher.js](file:///d:/iot-demo-wlw231/publisher.js)：连接 MQTT 后，`setInterval` 每 2000ms 生成 `{deviceId, ts, temperature, humidity}` 并发布到 `TOPIC`（`iot/demo/temperature`）。注意 `toFixed(2)` 返回字符串。
- [package.json](file:///d:/iot-demo-wlw231/package.json)：依赖仅 `dotenv`、`mqtt`；脚本 `pub` / `sub`。未安装 express。
- [subscriber.js](file:///d:/iot-demo-wlw231/subscriber.js)：独立订阅端，本任务不改动。
- 项目无 `public/` 或静态资源目录。

## Proposed Changes

### 1. 安装依赖

```bash
npm install express
```

### 2. 修改 `publisher.js`

在现有 MQTT 逻辑基础上追加：

- **调整数据生成时机**：把 `setInterval` 从 `client.on('connect')` 回调中**移到顶层**，发布前用 `client.connected` 判断（未连接则跳过 publish，仅生成数据）。这样没有 MQTT Broker 时网页仪表盘依然有数据可展示，同时顺带消除重连导致 interval 叠加的问题。
- **数据缓冲**：新增内存环形数组 `history`（保留最近 120 条 ≈ 4 分钟），每次生成数据时 `history.push(data)`，并将 `temperature`/`humidity` 用 `Number(...)` 转为数值再存储/推送（图表需要数值型）。
- **Express 服务**：
  - `app.use(express.static('public'))` — 托管静态页面。
  - `GET /api/history` — 返回 `history` JSON，供页面初始化。
  - `GET /api/stream` — SSE 端点：设置 `Content-Type: text/event-stream` 等响应头，把该响应加入 `clients` 数组；每次生成新数据时向所有客户端 `res.write('data: ' + JSON.stringify(data) + '\n\n')`；处理 `req.on('close')` 移除客户端。
  - `app.listen(process.env.PORT || 3000)`，启动时打印 `[WEB] Dashboard: http://localhost:3000`。
- 定时器回调中在 `client.publish(...)` 之后追加：写入 `history` + 广播 SSE。

### 3. 新建 `public/dashboard.html`

单文件页面（内联 CSS/JS），不引入构建工具：

- 通过 CDN 引入 Chart.js（`https://cdn.jsdelivr.net/npm/chart.js`）。
- 布局：顶部两个大数字卡片（当前温度 ℃ / 当前湿度 %），下方一条双 Y 轴折线图（温度、湿度两条曲线，X 轴为时间）。
- 逻辑：
  1. 页面加载时 `fetch('/api/history')` 渲染已有数据点；
  2. `new EventSource('/api/stream')` 监听推送，每收到一条就追加数据点并滚动窗口（最多保留 120 点）；
  3. 顶部显示连接状态（SSE 打开/断开）。

### 4. `package.json`

无需新增脚本（`npm run pub` 同时启动 MQTT 发布 + Web 界面）。

## Assumptions & Decisions

- **实时方案选 SSE** 而非 WebSocket/轮询：单向推送足够、零额外依赖、浏览器原生 `EventSource` 自带断线重连。
- **Chart.js 走 CDN**：demo 项目接受联网；页面需联网才能显示图表。
- **仪表盘内嵌在 publisher.js**：符合"为 publisher.js 添加"的要求；数据直接来自生成处，无需再订阅 MQTT。
- 端口默认 3000，可用环境变量 `PORT` 覆盖（不改动 .env，除非用户要求）。
- **不修复既有代码中的其他问题**，保持改动最小（interval 位置调整除外，见 Proposed Changes 第 2 节，这是仪表盘可用性的必要改动）。

## Verification

1. `npm install express` 成功，`package.json` 出现 express 依赖。
2. `npm run pub` 启动后：
   - 控制台同时出现 `[PUB] Connected` 与 `[WEB] Dashboard: http://localhost:3000`；
   - 浏览器打开 `http://localhost:3000`，可见温湿度卡片与折线图，且每 2 秒新增一个数据点；
   - `curl http://localhost:3000/api/history` 返回 JSON 数组。
3. （可选）用 browser agent 打开页面截图验证渲染与实时更新。
4. 原有 MQTT 发布不受影响：`npm run sub` 仍能收到 `[SUB] iot/demo/temperature => {...}`（需本地 Broker 在运行；若无 Broker，Web 界面仍应正常工作，仅 `[PUB] Error` 打印连接失败——实现时确保 Express 启动不依赖 MQTT 连接成功）。
