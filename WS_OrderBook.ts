/**
 * ws_orderbook_simple_conditionid.ts
 *
 * - Input: SOLO conditionId
 * - Resuelve token YES/NO via REST (getMarket)
 * - Se conecta al WS "market" del CLOB y se subscribe a 2 assets_ids
 * - Imprime bestBid/bestAsk (si puede parsear el mensaje)
 * - Si no puede parsear, imprime RAW para que veas el formato
 *
 * Requisitos:
 *   npm i ws @polymarket/clob-client
 *   Node 18+
 */

import WebSocket from "ws";
import { ClobClient } from "@polymarket/clob-client";

// =====================
// CONFIG
// =====================

const REST_HOST = "https://clob.polymarket.com";
const CHAIN_ID = 137;

// WS oficial del CLOB (market/user channels) :contentReference[oaicite:1]{index=1}
const WS_HOST = "wss://ws-subscriptions-clob.polymarket.com";

// ⬇️ PEGA AQUÍ TU conditionId
const CONDITION_ID = "0x4a629eb456c10ea56e4819f5b54c6727be8010b03c31375fed5b9f100f0dee53";

// si quieres el dump inicial (snapshot) al suscribirte
const INITIAL_DUMP = true;

// =====================
// CLIENTE REST (público) PARA RESOLVER TOKENS
// =====================

const client = new ClobClient(REST_HOST, CHAIN_ID);

// =====================
// TIPOS
// =====================

type Best = {
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
};

type TokenPair = {
  tokenYes: string;
  tokenNo: string;
};

// =====================
// HELPERS (sin reduce, sin arrows)
// =====================

function normalizeOutcome(outcome: any): string {
  const s = String(outcome || "").trim().toLowerCase();
  if (s === "yes") return "YES";
  if (s === "no") return "NO";
  return s.toUpperCase();
}

async function resolverTokenYesNo(conditionId: string): Promise<TokenPair> {
  // getMarket(conditionId) está documentado como método público :contentReference[oaicite:2]{index=2}
  const market: any = await client.getMarket(conditionId);

  if (!market || !market.tokens || market.tokens.length !== 2) {
    throw new Error("No se encontraron exactamente 2 tokens en market.tokens para este conditionId.");
  }

  let tokenYes = "";
  let tokenNo = "";

  let i = 0;
  while (i < market.tokens.length) {
    const t = market.tokens[i];
    const out = normalizeOutcome(t.outcome);

    if (out === "YES") tokenYes = String(t.token_id);
    if (out === "NO") tokenNo = String(t.token_id);

    i++;
  }

  // fallback ultra simple si no vienen como YES/NO (UP/DOWN, etc.)
  if (!tokenYes || !tokenNo) {
    tokenYes = String(market.tokens[0].token_id);
    tokenNo = String(market.tokens[1].token_id);
    console.log("⚠️ Outcome no era YES/NO claro. Uso el orden de market.tokens[0/1].");
  }

  return { tokenYes: tokenYes, tokenNo: tokenNo };
}

function toNumber(x: any): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function bestFromLevels(levels: any, side: "bid" | "ask"): Best {
  // Esperamos algo tipo: [{ price: "0.56", size: "12.3" }, ...]
  // pero no asumimos orden ni tipo.
  let bestPrice = 0;
  let bestSize = 0;

  if (!Array.isArray(levels)) {
    return { bid: 0, ask: 0, bidSize: 0, askSize: 0 };
  }

  let i = 0;
  while (i < levels.length) {
    const lvl = levels[i];
    const p = toNumber(lvl.price);
    const s = toNumber(lvl.size);

    if (side === "bid") {
      if (p > bestPrice) {
        bestPrice = p;
        bestSize = s;
      }
    } else {
      if (bestPrice === 0 || (p > 0 && p < bestPrice)) {
        bestPrice = p;
        bestSize = s;
      }
    }

    i++;
  }

  if (side === "bid") {
    return { bid: bestPrice, ask: 0, bidSize: bestSize, askSize: 0 };
  }

  return { bid: 0, ask: bestPrice, bidSize: 0, askSize: bestSize };
}

function mergeBest(prev: Best, add: Best): Best {
  return {
    bid: add.bid > 0 ? add.bid : prev.bid,
    ask: add.ask > 0 ? add.ask : prev.ask,
    bidSize: add.bid > 0 ? add.bidSize : prev.bidSize,
    askSize: add.ask > 0 ? add.askSize : prev.askSize,
  };
}

/**
 * Intenta extraer:
 * - asset_id (tokenId)
 * - bids / asks
 *
 * Si no lo consigue, devuelve null para que imprimamos RAW.
 */
function tryParseBookMessage(obj: any): { assetId: string; bids: any; asks: any } | null {
  // Heurísticas porque el formato exacto puede variar por "type"/"event".
  // Buscamos en varios sitios típicos.
  if (!obj || typeof obj !== "object") return null;

  // Caso A: { asset_id, bids, asks, ... }
  if (obj.asset_id && (obj.bids || obj.asks)) {
    return { assetId: String(obj.asset_id), bids: obj.bids, asks: obj.asks };
  }

  // Caso B: { assetId, bids, asks }
  if (obj.assetId && (obj.bids || obj.asks)) {
    return { assetId: String(obj.assetId), bids: obj.bids, asks: obj.asks };
  }

  // Caso C: { data: { asset_id, bids, asks } }
  if (obj.data && typeof obj.data === "object") {
    const d = obj.data;
    if ((d.asset_id || d.assetId) && (d.bids || d.asks)) {
      return {
        assetId: String(d.asset_id || d.assetId),
        bids: d.bids,
        asks: d.asks,
      };
    }
  }

  // Caso D: { payload: { ... } } (algunos sistemas lo envuelven)
  if (obj.payload && typeof obj.payload === "object") {
    const p = obj.payload;
    if ((p.asset_id || p.assetId) && (p.bids || p.asks)) {
      return {
        assetId: String(p.asset_id || p.assetId),
        bids: p.bids,
        asks: p.asks,
      };
    }
  }

  return null;
}

function printTwoBooks(tokenYes: string, tokenNo: string, yes: Best, no: Best) {
  console.clear();

  console.log("YES");
  console.log("  tokenId:", tokenYes);
  console.log("  bestBid:", yes.bid, "size:", yes.bidSize);
  console.log("  bestAsk:", yes.ask, "size:", yes.askSize);

  console.log("");
  console.log("NO");
  console.log("  tokenId:", tokenNo);
  console.log("  bestBid:", no.bid, "size:", no.bidSize);
  console.log("  bestAsk:", no.ask, "size:", no.askSize);
}

// =====================
// MAIN
// =====================

async function main() {
  console.log("Resolviendo tokens desde conditionId...");
  const pair = await resolverTokenYesNo(CONDITION_ID);

  console.log("ConditionId:", CONDITION_ID);
  console.log("Token YES:", pair.tokenYes);
  console.log("Token NO :", pair.tokenNo);

  const wsUrl = WS_HOST + "/ws/market";
  console.log("Conectando WS:", wsUrl);

  const ws = new WebSocket(wsUrl);

  // Estado mínimo: bests por token
  let bestYes: Best = { bid: 0, ask: 0, bidSize: 0, askSize: 0 };
  let bestNo: Best = { bid: 0, ask: 0, bidSize: 0, askSize: 0 };

  ws.on("open", function () {
    console.log("🔌 WS abierto. Suscribiendo...");

    const subMsg = {
      type: "market",
      markets: [],
      assets_ids: [pair.tokenNo, pair.tokenYes],
      initial_dump: INITIAL_DUMP,
    };

    ws.send(JSON.stringify(subMsg));

    // keepalive como en el ejemplo oficial
    setInterval(function () {
      ws.send("PING");
    }, 50000);
  });

  ws.on("message", function (data: WebSocket.RawData) {
    const text = data.toString();

    // Ignora PONG u otros
    if (text === "PONG" || text === "PING") return;

    let obj: any;
    try {
      obj = JSON.parse(text);
    } catch (e) {
      // si no es JSON, lo mostramos por si acaso
      console.log("RAW:", text);
      return;
    }

    const parsed = tryParseBookMessage(obj);

    if (!parsed) {
      // Para que veas el formato real del WS y lo ajustamos a tu payload
      console.log("RAW(JSON):", text);
      return;
    }

    const bidPart = bestFromLevels(parsed.bids, "bid");
    const askPart = bestFromLevels(parsed.asks, "ask");
    const merged = mergeBest({ bid: 0, ask: 0, bidSize: 0, askSize: 0 }, mergeBest(bidPart, askPart));

    if (parsed.assetId === pair.tokenYes) {
      bestYes = mergeBest(bestYes, merged);
    } else if (parsed.assetId === pair.tokenNo) {
      bestNo = mergeBest(bestNo, merged);
    } else {
      // mensaje de otro asset que no pedimos
      return;
    }

    printTwoBooks(pair.tokenYes, pair.tokenNo, bestYes, bestNo);
  });

  ws.on("error", function (err) {
    console.error("❌ WS error:", err);
  });

  ws.on("close", function (code, reason) {
    console.log("🔌 WS cerrado. code:", code, "reason:", reason.toString());
  });
}

main().catch(function (e) {
  console.error("❌ Fatal:", e);
});
