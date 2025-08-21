# Deribit Max Pain Backend (BTC/ETH Options)

一个简洁的 Node/Express 后端服务：
- 从 Deribit 公共 API 拉取 BTC/ETH 期权合约摘要
- 按行权价聚合 Call/Put 未平仓量（OI）
- 计算 **Max Pain** 价格
- 提供给前端看板使用的 REST API

## 快速开始

> Node.js >= 18

```bash
git clone <your-repo-url> deribit-maxpain-backend
cd deribit-maxpain-backend
npm install
npm start

默认启动：http://localhost:3000

环境变量

PORT（默认 3000）

ALLOWED_ORIGINS 允许的跨域源（逗号分隔）。默认 *

CACHE_TTL_MS 缓存时间毫秒，默认 15000（15s）

LOG_LEVEL silent|info|debug，默认 info

API

获取到期日列表

GET /api/expiries?currency=BTC
GET /api/expiries?currency=ETH


响应：

{
  "currency": "BTC",
  "expiries": ["2025-08-29", "2025-09-05", "..."]
}


获取某到期日的 OI 分布 & Max Pain

GET /api/oi?currency=BTC&expiry=YYYY-MM-DD


响应：

{
  "currency": "BTC",
  "expiry": "2025-08-29",
  "underlying": 116234.45,
  "call_open_interest": 57452.3,
  "put_open_interest": 45400.7,
  "total_open_interest": 102853.0,
  "call_put_ratio": 1.27,
  "notional_value_est": 11867076287.0,
  "max_pain_price": 116000,
  "strikes": [50000, 52000, "..."],
  "call_by_strike": { "50000": 1200, "52000": 980, "...": "..." },
  "put_by_strike":  { "50000": 800,  "52000": 1300, "...": "..." }
}


健康检查

GET /health


服务状态

GET /api/status

cURL 示例
# 列出 BTC 到期日
curl "http://localhost:3000/api/expiries?currency=BTC"

# 取 ETH 某天的 OI 与 Max Pain
curl "http://localhost:3000/api/oi?currency=ETH&expiry=2025-08-29"

前端嵌入

前端看板建议独立部署，然后在博客用 <iframe> 内嵌。前端 API_BASE 指向本服务地址即可（例如 https://your-backend.example.com）。
