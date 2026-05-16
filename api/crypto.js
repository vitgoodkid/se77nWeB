// GET /api/crypto
// Returns: { btc, gold, twd, vnd, series: { btc, gold, twd, vnd }, ts }
// btc      = USD per BTC (current)
// gold     = USD per troy ounce (via PAXG)
// twd      = TWD per 1 USD
// vnd      = VND per 1 USD
// series.* = array of ~40 historical closes (oldest → newest), real values only
//
// Sources (no API keys needed):
//   - CoinGecko simple price + market_chart (BTC + PAXG, last ~40h)
//   - exchangerate.host /latest + /timeseries (USD → TWD/VND, last 40 days)
// Caches 60s at the edge.

export const config = { runtime: 'nodejs' };

let cache = { data: null, ts: 0 };

const SERIES_LEN = 40;

function tail(arr, n) {
  if (!Array.isArray(arr)) return null;
  if (arr.length <= n) return arr.slice();
  return arr.slice(arr.length - n);
}

function fxDateRange(days) {
  const end = new Date();
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=60');

  const now = Date.now();
  if (cache.data && now - cache.ts < 55_000) {
    return res.status(200).json(cache.data);
  }

  const out = { ts: now, series: {} };
  const { start: fxStart, end: fxEnd } = fxDateRange(SERIES_LEN);

  try {
    const [
      cgPrice,
      cgBtcChart,
      cgGoldChart,
      fxLatest,
      fxSeries,
    ] = await Promise.allSettled([
      fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,pax-gold&vs_currencies=usd', {
        headers: { Accept: 'application/json' },
      }).then((r) => r.json()),
      // hourly granularity — CoinGecko returns hourly when days <= 90 and >1
      fetch('https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=2&interval=hourly', {
        headers: { Accept: 'application/json' },
      }).then((r) => r.json()),
      fetch('https://api.coingecko.com/api/v3/coins/pax-gold/market_chart?vs_currency=usd&days=2&interval=hourly', {
        headers: { Accept: 'application/json' },
      }).then((r) => r.json()),
      fetch('https://api.exchangerate.host/latest?base=USD&symbols=TWD,VND', {
        headers: { Accept: 'application/json' },
      }).then((r) => r.json()),
      fetch(`https://api.exchangerate.host/timeseries?start_date=${fxStart}&end_date=${fxEnd}&base=USD&symbols=TWD,VND`, {
        headers: { Accept: 'application/json' },
      }).then((r) => r.json()),
    ]);

    if (cgPrice.status === 'fulfilled') {
      const d = cgPrice.value;
      if (d?.bitcoin?.usd) out.btc = d.bitcoin.usd;
      if (d?.['pax-gold']?.usd) out.gold = d['pax-gold'].usd;
    }
    if (fxLatest.status === 'fulfilled') {
      const d = fxLatest.value;
      if (d?.rates?.TWD) out.twd = d.rates.TWD;
      if (d?.rates?.VND) out.vnd = d.rates.VND;
    }

    if (cgBtcChart.status === 'fulfilled') {
      const prices = cgBtcChart.value?.prices;
      if (Array.isArray(prices)) {
        const closes = prices.map((p) => p[1]).filter((v) => Number.isFinite(v));
        const t = tail(closes, SERIES_LEN);
        if (t && t.length) out.series.btc = t;
      }
    }
    if (cgGoldChart.status === 'fulfilled') {
      const prices = cgGoldChart.value?.prices;
      if (Array.isArray(prices)) {
        const closes = prices.map((p) => p[1]).filter((v) => Number.isFinite(v));
        const t = tail(closes, SERIES_LEN);
        if (t && t.length) out.series.gold = t;
      }
    }
    if (fxSeries.status === 'fulfilled') {
      const rates = fxSeries.value?.rates;
      if (rates && typeof rates === 'object') {
        const days = Object.keys(rates).sort();
        const twd = [];
        const vnd = [];
        for (const d of days) {
          const r = rates[d];
          if (Number.isFinite(r?.TWD)) twd.push(r.TWD);
          if (Number.isFinite(r?.VND)) vnd.push(r.VND);
        }
        if (twd.length) out.series.twd = tail(twd, SERIES_LEN);
        if (vnd.length) out.series.vnd = tail(vnd, SERIES_LEN);
      }
    }

    // Make sure last point of each series equals the live price so the card
    // and sparkline never disagree visually.
    for (const k of ['btc', 'gold', 'twd', 'vnd']) {
      const s = out.series[k];
      if (Array.isArray(s) && s.length && Number.isFinite(out[k])) {
        s[s.length - 1] = out[k];
      }
    }

    // Last-known fallback if any source failed
    if (cache.data) {
      out.btc  ??= cache.data.btc;
      out.gold ??= cache.data.gold;
      out.twd  ??= cache.data.twd;
      out.vnd  ??= cache.data.vnd;
      for (const k of ['btc', 'gold', 'twd', 'vnd']) {
        if (!out.series[k] && cache.data.series?.[k]) {
          out.series[k] = cache.data.series[k];
        }
      }
    }

    cache = { data: out, ts: now };
    return res.status(200).json(out);
  } catch (e) {
    if (cache.data) return res.status(200).json(cache.data);
    return res.status(502).json({ error: String(e.message || e) });
  }
}
