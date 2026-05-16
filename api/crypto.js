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
//   - CoinGecko BTC chart in TWD/VND → derive hourly exchange rate series
//   - open.er-api.com /latest (USD → TWD/VND current rate, fallback)
// Caches 60s at the edge.

export const config = { runtime: 'nodejs' };

let cache = { data: null, ts: 0 };

const SERIES_LEN = 40;

function tail(arr, n) {
  if (!Array.isArray(arr)) return null;
  if (arr.length <= n) return arr.slice();
  return arr.slice(arr.length - n);
}

// Derive exchange rate series by dividing BTC price in fiat by BTC price in USD
function fxSeriesFromBtcRatio(btcFiatPrices, btcUsdPrices) {
  if (!Array.isArray(btcFiatPrices) || !Array.isArray(btcUsdPrices)) return null;
  const len = Math.min(btcFiatPrices.length, btcUsdPrices.length);
  const rates = [];
  for (let i = 0; i < len; i++) {
    const fiat = btcFiatPrices[i][1];
    const usd  = btcUsdPrices[i][1];
    if (Number.isFinite(fiat) && Number.isFinite(usd) && usd > 0) {
      rates.push(fiat / usd);
    }
  }
  return rates.length ? rates : null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=60');

  const now = Date.now();
  if (cache.data && now - cache.ts < 55_000) {
    return res.status(200).json(cache.data);
  }

  const out = { ts: now, series: {} };

  try {
    const [
      cgPrice,
      cgBtcChart,
      cgGoldChart,
      cgBtcChartTwd,
      cgBtcChartVnd,
      erLatest,
    ] = await Promise.allSettled([
      // BTC + GOLD + TWD/VND spot price via CoinGecko (twd/vnd derived from BTC ratio)
      fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,pax-gold&vs_currencies=usd,twd,vnd', {
        headers: { Accept: 'application/json' },
      }).then((r) => r.json()),
      // hourly BTC chart USD — used for BTC series and TWD/VND ratio denominator
      fetch('https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=2&interval=hourly', {
        headers: { Accept: 'application/json' },
      }).then((r) => r.json()),
      fetch('https://api.coingecko.com/api/v3/coins/pax-gold/market_chart?vs_currency=usd&days=2&interval=hourly', {
        headers: { Accept: 'application/json' },
      }).then((r) => r.json()),
      // BTC chart in TWD/VND → divide by USD chart to get hourly FX rate series
      fetch('https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=twd&days=2&interval=hourly', {
        headers: { Accept: 'application/json' },
      }).then((r) => r.json()),
      fetch('https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=vnd&days=2&interval=hourly', {
        headers: { Accept: 'application/json' },
      }).then((r) => r.json()),
      // open.er-api.com — free, no key, fallback for current FX rate
      fetch('https://open.er-api.com/v6/latest/USD', {
        headers: { Accept: 'application/json' },
      }).then((r) => r.json()),
    ]);

    // --- Current prices ---
    if (cgPrice.status === 'fulfilled') {
      const d = cgPrice.value;
      if (d?.bitcoin?.usd)      out.btc  = d.bitcoin.usd;
      if (d?.['pax-gold']?.usd) out.gold = d['pax-gold'].usd;
      // Derive FX from BTC ratio (most accurate, same timestamp as price)
      if (d?.bitcoin?.usd && d?.bitcoin?.twd) out.twd = d.bitcoin.twd / d.bitcoin.usd;
      if (d?.bitcoin?.usd && d?.bitcoin?.vnd) out.vnd = d.bitcoin.vnd / d.bitcoin.usd;
    }

    // Fallback current FX from open.er-api.com if CoinGecko ratio failed
    if (erLatest.status === 'fulfilled') {
      const d = erLatest.value;
      if (!Number.isFinite(out.twd) && d?.rates?.TWD) out.twd = d.rates.TWD;
      if (!Number.isFinite(out.vnd) && d?.rates?.VND) out.vnd = d.rates.VND;
    }

    // --- Series ---
    const btcUsdPrices = cgBtcChart.status === 'fulfilled' ? cgBtcChart.value?.prices : null;

    if (Array.isArray(btcUsdPrices)) {
      const closes = btcUsdPrices.map((p) => p[1]).filter((v) => Number.isFinite(v));
      const t = tail(closes, SERIES_LEN);
      if (t && t.length) out.series.btc = t;
    }
    if (cgGoldChart.status === 'fulfilled') {
      const prices = cgGoldChart.value?.prices;
      if (Array.isArray(prices)) {
        const closes = prices.map((p) => p[1]).filter((v) => Number.isFinite(v));
        const t = tail(closes, SERIES_LEN);
        if (t && t.length) out.series.gold = t;
      }
    }

    // TWD/VND series derived from BTC price ratio
    if (cgBtcChartTwd.status === 'fulfilled' && btcUsdPrices) {
      const rates = fxSeriesFromBtcRatio(cgBtcChartTwd.value?.prices, btcUsdPrices);
      const t = tail(rates, SERIES_LEN);
      if (t && t.length) out.series.twd = t;
    }
    if (cgBtcChartVnd.status === 'fulfilled' && btcUsdPrices) {
      const rates = fxSeriesFromBtcRatio(cgBtcChartVnd.value?.prices, btcUsdPrices);
      const t = tail(rates, SERIES_LEN);
      if (t && t.length) out.series.vnd = t;
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
