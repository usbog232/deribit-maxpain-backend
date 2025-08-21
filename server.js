
/**
 * Deribit Max Pain Backend
 * - /api/expiries?currency=BTC
 * - /api/oi?currency=BTC&expiry=YYYY-MM-DD
 */

const express = require('express');
const cors = require('cors');
// node-fetch v3 是 ESM，这里用动态导入以兼容 CommonJS：
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const app = express();

// ---------- 环境变量 ----------
const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || '*';
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 15000);
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// ---------- CORS ----------
let corsOptions = {};
if (ALLOWED_ORIGINS === '*' || ALLOWED_ORIGINS.trim() === '') {
  corsOptions = { origin: true };
} else {
  const allow = ALLOWED_ORIGINS.split(',').map(s => s.trim());
  corsOptions = {
    origin(origin, cb) {
      if (!origin || allow.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    }
  };
}
app.use(cors(corsOptions));

// ---------- 常量 ----------
const DERIBIT_BASE = 'https://www.deribit.com/api/v2';

// ---------- 简单日志 ----------
function log(...args) {
  if (LOG_LEVEL === 'silent') return;
  console.log('[info]', ...args);
}
function debug(...args) {
  if (LOG_LEVEL !== 'debug') return;
  console.log('[debug]', ...args);
}

// ---------- 简易缓存（内存） ----------
const cache = new Map();
function getCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.t > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.v;
}
function setCache(key, v) {
  cache.set(key, { v, t: Date.now() });
}

// ---------- 带重试的 fetch ----------
async function fetchJSON(url, { retries = 2, backoff = 400 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { timeout: 15000 });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, backoff * (i + 1)));
    }
  }
  throw lastErr;
}

// ---------- Deribit API 封装 ----------
async function getBookSummaryByCurrency(currency) {
  const key = `book_${currency}`;
  const cached = getCache(key);
  if (cached) return cached;

  const url = `${DERIBIT_BASE}/public/get_book_summary_by_currency?currency=${currency}&kind=option`;
  const json = await fetchJSON(url);
  if (!json || !json.result) throw new Error('Deribit get_book_summary_by_currency error');
  setCache(key, json.result);
  return json.result;
}

async function getInstruments(currency) {
  const key = `inst_${currency}`;
  const cached = getCache(key);
  if (cached) return cached;

  const url = `${DERIBIT_BASE}/public/get_instruments?currency=${currency}&expired=false&kind=option`;
  const json = await fetchJSON(url);
  if (!json || !json.result) throw new Error('Deribit get_instruments error');
  setCache(key, json.result);
  return json.result;
}

// ---------- 工具：Max Pain ----------
function computeMaxPain(callByStrike, putByStrike) {
  const strikes = Array.from(new Set([
    ...Object.keys(callByStrike || {}),
    ...Object.keys(putByStrike || {})
  ])).map(Number).sort((a, b) => a - b);
  if (strikes.length === 0) return { price: null, loss: 0 };

  let best = { price: null, loss: Infinity };
  for (const S of strikes) {
    let loss = 0;
    for (const kStr in callByStrike) {
      const K = Number(kStr);
      const oi = callByStrike[kStr] || 0;
      loss += Math.max(0, S - K) * oi;
    }
    for (const kStr in putByStrike) {
      const K = Number(kStr);
      const oi = putByStrike[kStr] || 0;
      loss += Math.max(0, K - S) * oi;
    }
    if (loss < best.loss) best = { price: S, loss };
  }
  return best;
}

// ---------- Routes ----------
app.get('/health', (req, res) => res.send('ok'));

app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    cacheSize: cache.size,
    cacheTtlMs: CACHE_TTL_MS,
    logLevel: LOG_LEVEL,
    ts: Date.now()
  });
});

// 列出到期日
app.get('/api/expiries', async (req, res) => {
  try {
    const currency = (req.query.currency || 'BTC').toUpperCase();
    if (!['BTC', 'ETH'].includes(currency)) {
      return res.status(400).json({ error: 'currency must be BTC or ETH' });
    }
    const instruments = await getInstruments(currency);
    const uniq = new Map();
    for (const it of instruments) {
      const d = new Date(it.expiration_timestamp);
      const key = d.toISOString().slice(0, 10);
      uniq.set(key, d.getTime());
    }
    const expiries = Array.from(uniq.entries())
      .sort((a, b) => a[1] - b[1])
      .map(([k]) => k);
    res.json({ currency, expiries });
  } catch (e) {
    log('expiries error', e.message);
    res.status(500).json({ error: e.message });
  }
});

// OI 分布 & Max Pain
app.get('/api/oi', async (req, res) => {
  try {
    const currency = (req.query.currency || 'BTC').toUpperCase();
    const expiry = req.query.expiry;
    if (!['BTC', 'ETH'].includes(currency)) {
      return res.status(400).json({ error: 'currency must be BTC or ETH' });
    }
    if (!expiry || !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
      return res.status(400).json({ error: 'Missing expiry=YYYY-MM-DD' });
    }

    // 缓存键
    const key = `oi_${currency}_${expiry}`;
    const cached = getCache(key);
    if (cached) return res.json(cached);

    const [book, instruments] = await Promise.all([
      getBookSummaryByCurrency(currency),
      getInstruments(currency)
    ]);

    const targetNames = new Set(
      instruments
        .filter(it => new Date(it.expiration_timestamp).toISOString().slice(0, 10) === expiry)
        .map(it => it.instrument_name)
    );

    const callByStrike = {};
    const putByStrike = {};
    let callOI = 0, putOI = 0, underlying = null;

    for (const row of book) {
      if (!targetNames.has(row.instrument_name)) continue;
      const parts = row.instrument_name.split('-'); // BTC-29AUG25-70000-C
      const strike = Number(parts[2]);
      const type = parts[3]; // C or P
      const oi = Number(row.open_interest || 0);

      if (underlying == null && row.underlying_price != null) {
        underlying = Number(row.underlying_price);
      }
      if (type === 'C') {
        callByStrike[strike] = (callByStrike[strike] || 0) + oi;
        callOI += oi;
      } else if (type === 'P') {
        putByStrike[strike] = (putByStrike[strike] || 0) + oi;
        putOI += oi;
      }
    }

    const maxPain = computeMaxPain(callByStrike, putByStrike);
    const strikes = Array.from(new Set([
      ...Object.keys(callByStrike),
      ...Object.keys(putByStrike)
    ])).map(Number).sort((a, b) => a - b);

    const idx = underlying || 0;
    const totalOI = callOI + putOI;
    const notional = idx * totalOI; // 近似估算

    const payload = {
      currency,
      expiry,
      underlying: idx,
      call_open_interest: callOI,
      put_open_interest: putOI,
      total_open_interest: totalOI,
      call_put_ratio: totalOI ? callOI / Math.max(1, putOI) : 0,
      notional_value_est: notional,
      max_pain_price: maxPain.price,
      strikes,
      call_by_strike: callByStrike,
      put_by_strike: putByStrike
    };

    setCache(key, payload);
    res.json(payload);
  } catch (e) {
    log('oi error', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  log(`Server running on http://localhost:${PORT}`);
});
