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

