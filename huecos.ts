/**
 * ws_gap_rotating_15m.ts
 *
 * CSV columnas:
 *   timestamp_ms, utc_iso, slug, best_bid_up, best_bid_down
 */

import WebSocket from "ws";
import axios from "axios";
import fs from "fs";

// =====================
// CONFIG
// =====================

const URL_GAMMA = "https://gamma-api.polymarket.com/markets/slug/";
const PREFIJO = "btc-updown-15m-";
const WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";

const THRESHOLD = 0.02;
const INITIAL_DUMP = true;
const CHECK_EVERY_MS = 3000;

// =====================
// HELPERS
// =====================

function num(x: any): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function currentMarketTs(): number {
  return Math.floor(nowSec() / 900) * 900;
}

function slugFromMarketTs(marketTs: number): string {
  return `${PREFIJO}${marketTs}`;
}

function csvPathFor(marketTs: number): string {
  return `huecos_${PREFIJO}${marketTs}.csv`;
}

function ensureCsvHeader(path: string) {
  if (!fs.existsSync(path)) {
    fs.writeFileSync(
      path,
      "timestamp_ms,utc_iso,slug,best_bid_up,best_bid_down\n",
      "utf8"
    );
  }
}

function appendCsvRow(
  path: string,
  tsMs: string,
  slug: string,
  up: number,
  down: number
) {
  const iso = new Date(Number(tsMs)).toISOString();
  const row =
    `${tsMs},${iso},${slug},${up.toFixed(6)},${down.toFixed(6)}\n`;
  fs.appendFileSync(path, row, "utf8");
}

// =====================
// GAMMA
// =====================

type MarketInfo = {
  marketTs: number;
  slug: string;
  conditionId: string;
  tokenUp: string;
  tokenDown: string;
};

async function obtenerTokensParaMarketTs(marketTs: number): Promise<MarketInfo> {
  const slug = slugFromMarketTs(marketTs);
  const url = `${URL_GAMMA}${slug}`;

  const response = await axios.get(url);
  const data = response.data;

  const conditionId = String(data["conditionId"] || "");
  let raw = data["clobTokenIds"];
  let tokens = typeof raw === "string" ? JSON.parse(raw) : raw;

  if (!Array.isArray(tokens) || tokens.length !== 2) {
    throw new Error("clobTokenIds inválido");
  }

  return {
    marketTs,
    slug,
    conditionId,
    tokenUp: String(tokens[0]),
    tokenDown: String(tokens[1]),
  };
}

// =====================
// WS SESSION
// =====================

type WsSession = {
  ws: WebSocket;
  csvPath: string;
  slug: string;
  tokenUp: string;
  tokenDown: string;
  bestBidUp: number;
  bestBidDown: number;
  lastUp: number;
  lastDown: number;
};

function startWsSession(info: MarketInfo): WsSession {
  const csvPath = csvPathFor(info.marketTs);
  ensureCsvHeader(csvPath);

  console.log("▶ Mercado activo:", info.slug);

  const ws = new WebSocket(WS_URL);

  const sess: WsSession = {
    ws,
    csvPath,
    slug: info.slug,
    tokenUp: info.tokenUp,
    tokenDown: info.tokenDown,
    bestBidUp: 0,
    bestBidDown: 0,
    lastUp: -1,
    lastDown: -1,
  };

  ws.on("open", () => {
    ws.send(
      JSON.stringify({
        type: "market",
        markets: [],
        assets_ids: [sess.tokenUp, sess.tokenDown],
        initial_dump: INITIAL_DUMP,
      })
    );

    setInterval(() => {
      try { ws.send("PING"); } catch {}
    }, 50000);
  });

  ws.on("message", (data) => {
    const text = data.toString();
    if (text === "PING" || text === "PONG") return;

    let obj: any;
    try { obj = JSON.parse(text); } catch { return; }
    if (obj.event_type !== "price_change") return;

    const tsMs = String(obj.timestamp || "");
    const pcs = obj.price_changes;
    if (!Array.isArray(pcs) || !tsMs) return;

    for (const pc of pcs) {
      const bb = num(pc.best_bid);
      if (pc.asset_id === sess.tokenUp && bb > 0) sess.bestBidUp = bb;
      if (pc.asset_id === sess.tokenDown && bb > 0) sess.bestBidDown = bb;
    }

    if (sess.bestBidUp <= 0 || sess.bestBidDown <= 0) return;

    const hole = 1 - (sess.bestBidUp + sess.bestBidDown);
    if (hole < THRESHOLD) return;

    if (sess.bestBidUp === sess.lastUp && sess.bestBidDown === sess.lastDown) return;

    appendCsvRow(
      sess.csvPath,
      tsMs,
      sess.slug,
      sess.bestBidUp,
      sess.bestBidDown
    );

    sess.lastUp = sess.bestBidUp;
    sess.lastDown = sess.bestBidDown;

    console.log(
      `📝 ${sess.slug} | ${new Date(Number(tsMs)).toISOString()} | ` +
      `UP=${sess.bestBidUp.toFixed(3)} DOWN=${sess.bestBidDown.toFixed(3)}`
    );
  });

  return sess;
}

function stopWsSession(sess: WsSession | null) {
  if (!sess) return;
  try { sess.ws.close(); } catch {}
}

// =====================
// MAIN
// =====================

async function main() {
  let active: WsSession | null = null;
  let activeMarketTs: number | null = null;

  async function rotateIfNeeded() {
    const mt = currentMarketTs();
    if (activeMarketTs === mt) return;

    stopWsSession(active);
    activeMarketTs = mt;

    try {
      const info = await obtenerTokensParaMarketTs(mt);
      active = startWsSession(info);
    } catch (e: any) {
      console.error("❌ Gamma error:", e?.message || e);
    }
  }

  await rotateIfNeeded();
  setInterval(rotateIfNeeded, CHECK_EVERY_MS);
}

main().catch(console.error);
