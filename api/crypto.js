// GET /api/crypto
// Returns: { btc, gold, twd, vnd, ts }
// btc  = USD per BTC
// gold = USD per troy ounce
// twd  = TWD per 1 USD
// vnd  = VND per 1 USD
//
// Sources (no API keys needed):
//   - CoinGecko simple price (BTC + GOLD via PAXG proxy)
//   - exchangerate.host (USD → TWD/VND)
// Caches 60s at the edge.

export const config = { runtime: 'nodejs' };

let cache = { data: null, ts: 0 };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=60');

  const now = Date.now();
  if (cache.data && now - cache.ts < 55_000) {
    return res.status(200).json(cache.data);
  }

  const out = { ts: now };

  try {
    const [coingecko, fx] = await Promise.allSettled([
      // BTC + PAXG (gold-pegged token, ≈ spot gold/oz USD)
      fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,pax-gold&vs_currencies=usd', {
        headers: { Accept: 'application/json' },
      }).then((r) => r.json()),
      // USD → TWD, VND
      fetch('https://api.exchangerate.host/latest?base=USD&symbols=TWD,VND', {
        headers: { Accept: 'application/json' },
      }).then((r) => r.json()),
    ]);

    if (coingecko.status === 'fulfilled') {
      const d = coingecko.value;
      if (d?.bitcoin?.usd) out.btc = d.bitcoin.usd;
      if (d?.['pax-gold']?.usd) out.gold = d['pax-gold'].usd;
    }
    if (fx.status === 'fulfilled') {
      const d = fx.value;
      if (d?.rates?.TWD) out.twd = d.rates.TWD;
      if (d?.rates?.VND) out.vnd = d.rates.VND;
    }

    // Last-known fallback if any source failed
    if (cache.data) {
      out.btc  ??= cache.data.btc;
      out.gold ??= cache.data.gold;
      out.twd  ??= cache.data.twd;
      out.vnd  ??= cache.data.vnd;
    }

    cache = { data: out, ts: now };
    return res.status(200).json(out);
  } catch (e) {
    if (cache.data) return res.status(200).json(cache.data);
    return res.status(502).json({ error: String(e.message || e) });
  }
}
