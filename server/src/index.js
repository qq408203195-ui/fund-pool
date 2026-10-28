import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApiRouter } from './routes/api.js';
import { DB_PATH, countFunds } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
// 必须绑 0.0.0.0：云环境通过反向代理访问容器，绑 127.0.0.1 会让外部请求连不进来
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.use(express.json());
app.use('/api', createApiRouter());

const distDir = path.resolve(__dirname, '..', '..', 'web', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.listen(PORT, HOST, () => {
  console.log(`[fund-pool] API 已启动  http://${HOST}:${PORT}`);
  console.log(`[fund-pool] 数据库 ${DB_PATH}`);
  console.log(`[fund-pool] 基金数量 ${countFunds()}`);
  if (!fs.existsSync(distDir)) {
    console.log('[fund-pool] 未检测到前端构建产物，开发模式请另开终端运行 web 的 vite');
  }
});
