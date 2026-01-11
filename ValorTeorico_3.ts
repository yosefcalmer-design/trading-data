/**
FUNCIONA BIEN
Para la primera carga, chupa de binance los primeros 1200klines en segundos para calcular la volatilidad. 
A partir de que se renueve por segunda vez el mercado, ya no chupa nada. 

* live_rollover_model.ts  (FULL)
 *
 * - Rota mercado BTC up/down cada 15m: slug = btc-updown-15m-<market_ts>
 * - Gamma REST: resuelve tokens UP/DOWN (clobTokenIds + outcomes)
 * - CLOB WS: best bid UP/DOWN (usa best_bid si viene en price_change)
 * - RTDS WS (Chainlink): precio S_chainlink + latch strike K al entrar en ventana
 * - Binance:
 *    - Backfill REST klines 1s para precargar retornos (600/900/1200) al arrancar
 *    - WS trades para live: construye close_1s y actualiza retornos
 * - Calcula pUp teórico para 600/900/1200 y edge vs bestBidUP
 * - Imprime por consola 1 línea/seg y escribe CSV
 *
 * Reqs:
 *   npm i ws
 *   Node 18+ (fetch nativo)
 */

import WebSocket from "ws";
import * as fs from "fs";

// --------------------
// CONFIG
// --------------------
const PREFIJO = "btc-updown-15m-";
const MARKET_SECONDS = 900;

const GAMMA_MARKETS = "https://gamma-api.polymarket.com/markets"; // query ?slug=
const GAMMA_HEADERS: Record<string, string> = {
  "User-Agent": "LiveRolloverModel/0.2",
  "Accept": "application/json",
};

const WSS_CLOB = "wss://ws-subscriptions-clob.polymarket.com/ws/market";
const WSS_RTDS = "wss://ws-live-data.polymarket.com";
const WSS_BINANCE = "wss://stream.binance.com:9443/ws/btcusdt@trade";

const CHAINLINK_SYMBOL = "btc/usd";

// Vol windows (seconds)
const SIG_WINS = [600, 900, 1200] as const;
type Win = (typeof SIG_WINS)[number];

// Si quieres que empiece a producir con menos datos, baja MIN_RET.
// OJO: si pones muy bajo, sigma será ruidosa.
const MIN_RET = 30;

const CSV_PATH = "live_rollover_model.csv";

// Gamma puede tardar unos segundos en publicar el nuevo slug
const GAMMA_RETRY_SLEEP_MS = 1000;

// Binance REST backfill (klines 1s)
const BINANCE_REST = "https://api.binance.com";
const BINANCE_SYMBOL = "BTCUSDT";
const BINANCE_INTERVAL_1S = "1s";

// --------------------
// Types / State
// --------------------
type BestBid = { price: number; size: number };

let currentMarketTs: number | null = null;
let currentSlug: string | null = null;
let currentTitle: string | null = null;

let TOKEN_UP: string | null = null;
let TOKEN_DOWN: string | null = null;

// CLOB best bids
let bestBidUp: BestBid = { price: 0, size: 0 };
let bestBidDown: BestBid = { price: 0, size: 0 };

// RTDS (Chainlink)
let S_chainlink: number | null = null;
let strikeK: number | null = null;
let strikeForMarketTs: number | null = null;

// Binance aggregation -> close_1s
let bn_last_sec_seen: number | null = null;
let bn_close_this_sec: number | null = null;
let bn_prev_close_1s: number | null = null;

// logrets buffer (cap max 1200)
let bn_logrets: number[] = [];

// computed outputs
let sigmaByWin: Record<string, number> = {};
let pUpByWin: Record<string, number> = {};
let edgeByWin: Record<string, number> = {};

// CSV header tracking
let wroteHeader = false;

// WS handles
let wsCLOB: WebSocket | null = null;
let wsRTDS: WebSocket | null = null;
let wsBN: WebSocket | null = null;

// --------------------
// Utils
// --------------------
function nowEpochSec(): number {
  return Math.floor(Date.now() / 1000);
}

function buildMarketTs(tsSec: number): number {
  return Math.floor(tsSec / MARKET_SECONDS) * MARKET_SECONDS;
}

function slugForMarketTs(marketTs: number): string {
  return `${PREFIJO}${marketTs}`;
}

function nextBoundary(tsSec: number): number {
  return (Math.floor(tsSec / MARKET_SECONDS) + 1) * MARKET_SECONDS;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function toUtcIso(tsSec: number): string {
  return new Date(tsSec * 1000).toISOString().replace(".000Z", "Z");
}

function safeNum(x: any): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : NaN;
}

// erf approximation -> norm cdf
function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const absx = Math.abs(x);
  const t = 1 / (1 + p * absx);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-absx * absx);
  return sign * y;
}

function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.sqrt(2)));
}

function pUpBase(S: number, K: number, sigmaPerSec: number, tSec: number): number {
  if (!(S > 0) || !(K > 0) || !(sigmaPerSec > 0) || !(tSec > 0)) return NaN;
  const denom = sigmaPerSec * Math.sqrt(tSec);
  const z = Math.log(K / S) / denom;
  return 1 - normCdf(z);
}

function stdSample(arr: number[]): number {
  const n = arr.length;
  if (n < 2) return NaN;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += arr[i];
  mean /= n;

  let ss = 0;
  for (let i = 0; i < n; i++) {
    const d = arr[i] - mean;
    ss += d * d;
  }
  return Math.sqrt(ss / (n - 1)); // ddof=1
}

function lastN(arr: number[], n: number): number[] {
  if (arr.length <= n) return arr.slice();
  return arr.slice(arr.length - n);
}

function csvEscape(s: any): string {
  const str = String(s ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function csvAppendRow(row: Record<string, any>) {
  const cols = Object.keys(row);
  if (!wroteHeader) {
    fs.appendFileSync(CSV_PATH, cols.map(csvEscape).join(",") + "\n", "utf8");
    wroteHeader = true;
  }
  fs.appendFileSync(CSV_PATH, cols.map((k) => csvEscape(row[k])).join(",") + "\n", "utf8");
}

// --------------------
// Gamma: fetch market by slug (query ?slug=)
// --------------------
async function fetchMarketBySlug(slug: string): Promise<any> {
  const url = new URL(GAMMA_MARKETS);
  url.searchParams.set("slug", slug);

  const res = await fetch(url.toString(), { headers: GAMMA_HEADERS });
  if (!res.ok) throw new Error(`Gamma HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`Gamma no devolvió mercado para slug=${slug}`);
  }
  return data[0];
}

function parseUpDownTokensAndTitle(market: any): { up: string; down: string; title: string } {
  const title =
    market?.title ||
    market?.question ||
    market?.marketTitle ||
    market?.name ||
    "";

  const outcomes = market?.outcomes || market?.shortOutcomes || [];
  const raw = market?.clobTokenIds;
  if (raw == null) throw new Error("Gamma: no veo clobTokenIds");

  let tokenIds: string[] = [];
  if (typeof raw === "string") {
    tokenIds = JSON.parse(raw).map((x: any) => String(x));
  } else if (Array.isArray(raw)) {
    tokenIds = raw.map((x: any) => String(x));
  } else {
    throw new Error("Gamma: clobTokenIds formato desconocido");
  }

  if (tokenIds.length < 2) throw new Error(`clobTokenIds < 2: ${tokenIds}`);

  // intenta mapear UP/DOWN con outcomes si cuadra
  if (Array.isArray(outcomes) && outcomes.length >= 2) {
    const mapping: Record<string, string> = {};
    for (let i = 0; i < Math.min(outcomes.length, tokenIds.length); i++) {
      const o = String(outcomes[i] ?? "").trim().toLowerCase();
      mapping[o] = tokenIds[i];
    }
    const up = mapping["up"];
    const down = mapping["down"];
    if (up && down) return { up, down, title };
  }

  // fallback: orden
  return { up: tokenIds[0], down: tokenIds[1], title };
}

// --------------------
// Binance REST backfill: klines 1s -> preload log returns
// --------------------
type Kline1s = { closeTimeMs: number; close: number };

async function fetchKlines1s(startMs: number, endMs: number, limit = 1000): Promise<Kline1s[]> {
  const url = new URL(`${BINANCE_REST}/api/v3/klines`);
  url.searchParams.set("symbol", BINANCE_SYMBOL);
  url.searchParams.set("interval", BINANCE_INTERVAL_1S);
  url.searchParams.set("startTime", String(startMs));
  url.searchParams.set("endTime", String(endMs));
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Binance klines HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();

  // kline: [ openTime, open, high, low, close, vol, closeTime, ...]
  const out: Kline1s[] = [];
  for (const k of data) {
    const closeTimeMs = Number(k[6]);
    const close = Number(k[4]);
    if (Number.isFinite(closeTimeMs) && Number.isFinite(close)) out.push({ closeTimeMs, close });
  }
  out.sort((a, b) => a.closeTimeMs - b.closeTimeMs);
  return out;
}

async function backfillReturns(targetReturns: number) {
  // Necesitas targetReturns + 1 closes
  const needCloses = targetReturns + 1;

  const endMs = Date.now();
  // margen extra por si faltan algunos puntos
  const spanMs = (needCloses + 120) * 1000;

  const startMs = endMs - spanMs;

  // 1ª llamada (hasta 1000)
  let all = await fetchKlines1s(startMs, endMs, 1000);

  // 2ª llamada si hace falta (por límite 1000)
  if (all.length < needCloses) {
    const earliestClose = all.length ? all[0].closeTimeMs : endMs;
    const start2 = startMs - spanMs;
    const end2 = earliestClose;
    const part2 = await fetchKlines1s(start2, end2, 1000);
    all = part2.concat(all);
    all.sort((a, b) => a.closeTimeMs - b.closeTimeMs);
  }

  if (all.length >= needCloses) {
    all = all.slice(all.length - needCloses);
  }

  if (all.length < 2) {
    console.log("⚠️ Backfill: no hay suficientes klines 1s. Sigo sin precarga.");
    return;
  }

  // returns
  const rets: number[] = [];
  for (let i = 1; i < all.length; i++) {
    const prev = all[i - 1].close;
    const cur = all[i].close;
    if (prev > 0 && cur > 0) {
      const r = Math.log(cur / prev);
      if (Number.isFinite(r)) rets.push(r);
    }
  }

  const finalRets = rets.length > targetReturns ? rets.slice(rets.length - targetReturns) : rets;

  bn_logrets = finalRets;
  bn_prev_close_1s = all[all.length - 1].close;
  bn_last_sec_seen = Math.floor(all[all.length - 1].closeTimeMs / 1000);

  console.log(
    `✅ Backfill OK: closes=${all.length} returns=${finalRets.length} prevClose=${bn_prev_close_1s.toFixed(2)}`
  );
}

// --------------------
// CLOB WS: subscribe & parse best bid
// --------------------
function resetClobStateForNewMarket(up: string, down: string) {
  TOKEN_UP = up;
  TOKEN_DOWN = down;
  bestBidUp = { price: 0, size: 0 };
  bestBidDown = { price: 0, size: 0 };
}

function tryParseClobPayload(obj: any): any[] {
  if (Array.isArray(obj)) return obj.filter((x) => x && typeof x === "object");
  if (obj && typeof obj === "object") return [obj];
  return [];
}

function updateBestBidFromBookLike(assetId: string, bids: any) {
  if (!Array.isArray(bids)) return;
  let bestP = 0;
  let bestS = 0;

  for (let i = 0; i < bids.length; i++) {
    const p = safeNum(bids[i]?.price);
    const s = safeNum(bids[i]?.size);
    if (Number.isFinite(p) && p > bestP) {
      bestP = p;
      bestS = Number.isFinite(s) ? s : 0;
    }
  }

  if (TOKEN_UP && assetId === TOKEN_UP) bestBidUp = { price: bestP, size: bestS };
  if (TOKEN_DOWN && assetId === TOKEN_DOWN) bestBidDown = { price: bestP, size: bestS };
}

function handleClobEvent(msg: any) {
  const et = msg?.event_type;

  if (et === "book") {
    const assetId = String(msg?.asset_id ?? "");
    const bids = msg?.bids || msg?.buys || [];
    updateBestBidFromBookLike(assetId, bids);
    return;
  }

  if (et === "price_change") {
    const pcs = msg?.price_changes;
    if (!Array.isArray(pcs)) return;

    // Si viene best_bid en el delta, úsalo directo
    for (let i = 0; i < pcs.length; i++) {
      const c = pcs[i];
      const assetId = String(c?.asset_id ?? "");
      const bb = safeNum(c?.best_bid);
      const bsz = safeNum(c?.best_bid_size);
      if (Number.isFinite(bb) && bb > 0) {
        if (TOKEN_UP && assetId === TOKEN_UP) bestBidUp = { price: bb, size: Number.isFinite(bsz) ? bsz : 0 };
        if (TOKEN_DOWN && assetId === TOKEN_DOWN) bestBidDown = { price: bb, size: Number.isFinite(bsz) ? bsz : 0 };
      }
    }
    return;
  }
}

function startOrRestartCLOBWS() {
  if (!TOKEN_UP || !TOKEN_DOWN) return;

  // cerrar anterior
  if (wsCLOB) {
    try { wsCLOB.close(); } catch {}
    wsCLOB = null;
  }

  const ws = new WebSocket(WSS_CLOB);
  wsCLOB = ws;

  ws.on("open", () => {
    const sub = { assets_ids: [TOKEN_UP, TOKEN_DOWN], type: "market" };
    ws.send(JSON.stringify(sub));

    // keepalive
    setInterval(() => {
      try { ws.send("PING"); } catch {}
    }, 50000);

    console.log(`✅ CLOB WS sub assets_ids=[UP,DOWN] -> ${TOKEN_UP}, ${TOKEN_DOWN}`);
  });

  ws.on("message", (data) => {
    const text = data.toString();
    if (text === "PONG" || text === "PING") return;

    let obj: any;
    try { obj = JSON.parse(text); } catch { return; }

    const items = tryParseClobPayload(obj);
    for (let i = 0; i < items.length; i++) {
      handleClobEvent(items[i]);
    }
  });

  ws.on("close", (code, reason) => {
    console.log(`⚠️ CLOB WS cerrado code=${code} reason=${reason.toString()}`);
  });

  ws.on("error", (err) => {
    console.log("⚠️ CLOB WS error:", err);
  });
}

// --------------------
// RTDS WS (Chainlink)
// --------------------
function startRTDSWS() {
  const ws = new WebSocket(WSS_RTDS);
  wsRTDS = ws;

  ws.on("open", () => {
    const sub = {
      action: "subscribe",
      subscriptions: [{
        topic: "crypto_prices_chainlink",
        type: "*",
        filters: JSON.stringify({ symbol: CHAINLINK_SYMBOL }),
      }],
    };
    ws.send(JSON.stringify(sub));
    console.log("✅ RTDS conectado (Chainlink).");
  });

  ws.on("message", (data) => {
    let obj: any;
    try { obj = JSON.parse(data.toString()); } catch { return; }

    if (obj?.topic !== "crypto_prices_chainlink" || obj?.type !== "update") return;
    const p = obj?.payload || {};
    const sym = String(p?.symbol || "").toLowerCase();
    if (sym !== CHAINLINK_SYMBOL) return;

    const v = safeNum(p?.value);
    if (!Number.isFinite(v)) return;

    S_chainlink = v;

    // latch strike si estamos en mercado actual y aún no lo tenemos
    if (strikeK == null && strikeForMarketTs != null && currentMarketTs === strikeForMarketTs) {
      strikeK = v;
      console.log(`🎯 STRIKE latched (Chainlink) K=${strikeK.toFixed(2)} slug=${currentSlug}`);
    }
  });

  ws.on("close", (code, reason) => {
    console.log(`⚠️ RTDS cerrado code=${code} reason=${reason.toString()}`);
    setTimeout(() => startRTDSWS(), 1000);
  });

  ws.on("error", (err) => {
    console.log("⚠️ RTDS error:", err);
  });
}

// --------------------
// Binance WS trades -> close_1s + returns
// --------------------
function startBinanceWS() {
  const ws = new WebSocket(WSS_BINANCE);
  wsBN = ws;

  ws.on("open", () => {
    console.log("✅ Binance WS conectado (trades).");
  });

  ws.on("message", (data) => {
    let obj: any;
    try { obj = JSON.parse(data.toString()); } catch { return; }

    const price = safeNum(obj?.p);
    const tsMs = safeNum(obj?.T);
    if (!Number.isFinite(price) || !Number.isFinite(tsMs)) return;

    const sec = Math.floor(tsMs / 1000);

    // init
    if (bn_last_sec_seen == null) {
      bn_last_sec_seen = sec;
      bn_close_this_sec = price;
      return;
    }

    // same second -> update close
    if (sec === bn_last_sec_seen) {
      bn_close_this_sec = price;
      return;
    }

    // second changed -> close previous second
    const close1s = bn_close_this_sec;

    bn_last_sec_seen = sec;
    bn_close_this_sec = price;

    if (close1s == null) return;

    // return (no inventamos retornos si hay huecos)
    if (bn_prev_close_1s != null && bn_prev_close_1s > 0 && close1s > 0) {
      const r = Math.log(close1s / bn_prev_close_1s);
      if (Number.isFinite(r)) {
        bn_logrets.push(r);
        const maxWin = Math.max(...SIG_WINS);
        if (bn_logrets.length > maxWin) bn_logrets = bn_logrets.slice(bn_logrets.length - maxWin);
      }
    }
    bn_prev_close_1s = close1s;

    // produce 1 tick output per closed second
    emitPerSecond(close1s);
  });

  ws.on("close", (code, reason) => {
    console.log(`⚠️ Binance WS cerrado code=${code} reason=${reason.toString()}`);
    setTimeout(() => startBinanceWS(), 1000);
  });

  ws.on("error", (err) => {
    console.log("⚠️ Binance WS error:", err);
  });
}

// --------------------
// Rotation loop (15m)
// --------------------
async function rotateToMarket(marketTs: number) {
  const slug = slugForMarketTs(marketTs);
  console.log(`\n⏱️ Rotando a: ${slug}`);

  while (true) {
    try {
      const m = await fetchMarketBySlug(slug);
      const { up, down, title } = parseUpDownTokensAndTitle(m);

      currentMarketTs = marketTs;
      currentSlug = slug;
      currentTitle = title;

      resetClobStateForNewMarket(up, down);

      // reset strike latch for this market
      strikeK = null;
      strikeForMarketTs = marketTs;

      console.log(`🟢 Nuevo mercado: ${slug}`);
      if (title) console.log(`   title: ${title}`);
      console.log(`   tokens UP/DOWN: ${up} / ${down}`);

      // restart CLOB WS to apply new subscription
      startOrRestartCLOBWS();

      return;
    } catch (e: any) {
      console.log(`⚠️ Gamma aún no devuelve ${slug}. Reintento... (${e?.message || e})`);
      await sleep(GAMMA_RETRY_SLEEP_MS);
    }
  }
}

async function rotatorLoop() {
  const initTs = buildMarketTs(nowEpochSec());
  await rotateToMarket(initTs);

  while (true) {
    await sleep(1000);
    const nowTs = buildMarketTs(nowEpochSec());
    if (currentMarketTs == null || nowTs !== currentMarketTs) {
      await rotateToMarket(nowTs);
    }
  }
}

// --------------------
// Per-second output
// --------------------
function emitPerSecond(binanceClose1s: number) {
  const nowSec = nowEpochSec();
  const boundary = nextBoundary(nowSec);
  const tRemain = boundary - nowSec;

  const upBid = bestBidUp.price || 0;
  const downBid = bestBidDown.price || 0;

  for (let i = 0; i < SIG_WINS.length; i++) {
    const w = SIG_WINS[i];

    // Calcula sigma con lo que haya disponible (hasta w), pero exige MIN_RET
    let sigma = NaN;
    if (bn_logrets.length >= MIN_RET) {
      const n = Math.min(w, bn_logrets.length);
      sigma = stdSample(lastN(bn_logrets, n));
    }
    sigmaByWin[String(w)] = sigma;

    let p = NaN;
    if (S_chainlink != null && strikeK != null && Number.isFinite(sigma) && sigma > 0) {
      p = pUpBase(S_chainlink, strikeK, sigma, tRemain);
    }
    pUpByWin[String(w)] = p;

    let edge = NaN;
    if (Number.isFinite(p) && upBid > 0) edge = p - upBid;
    edgeByWin[String(w)] = edge;
  }

  const p600 = pUpByWin["600"];
  const p900 = pUpByWin["900"];
  const p1200 = pUpByWin["1200"];

  console.log(
    `${toUtcIso(nowSec)} | ${currentSlug || ""} | ` +
    `S=${S_chainlink != null ? S_chainlink.toFixed(2) : "NA"} ` +
    `K=${strikeK != null ? strikeK.toFixed(2) : "NA"} t=${tRemain.toString().padStart(3, " ")} | ` +
    `UPbid=${upBid.toFixed(3)} DOWNbid=${downBid.toFixed(3)} | ` +
    `pUp600=${Number.isFinite(p600) ? p600.toFixed(3) : "NA"} ` +
    `pUp900=${Number.isFinite(p900) ? p900.toFixed(3) : "NA"} ` +
    `pUp1200=${Number.isFinite(p1200) ? p1200.toFixed(3) : "NA"}`
  );

  const row: Record<string, any> = {
    timestamp_utc: toUtcIso(nowSec),
    timestamp_unix_utc: nowSec,
    slug: currentSlug || "",
    title: currentTitle || "",

    S_chainlink: S_chainlink ?? "",
    K_strike: strikeK ?? "",
    t_remain_sec: tRemain,

    binance_close_1s: binanceClose1s,

    up_best_bid: upBid,
    down_best_bid: downBid,

    sigma_600: sigmaByWin["600"],
    pUp_600: pUpByWin["600"],
    edge_600: edgeByWin["600"],

    sigma_900: sigmaByWin["900"],
    pUp_900: pUpByWin["900"],
    edge_900: edgeByWin["900"],

    sigma_1200: sigmaByWin["1200"],
    pUp_1200: pUpByWin["1200"],
    edge_1200: edgeByWin["1200"],
  };

  csvAppendRow(row);
}

// --------------------
// MAIN
// --------------------
async function main() {
  console.log("🚀 Live rollover model (TS) arrancando...");
  console.log("📄 CSV:", CSV_PATH);

  // Backfill returns para que pUp salga desde el arranque (sin esperar)
  try {
    await backfillReturns(1200);
  } catch (e: any) {
    console.log("⚠️ Backfill falló (sigo sin precarga):", e?.message || e);
  }

  // start data feeds
  startRTDSWS();
  startBinanceWS();

  // rotator (handles CLOB restarts inside rotateToMarket)
  await rotatorLoop();
}

main().catch((e) => {
  console.error("❌ Fatal:", e);
  process.exit(1);
});
