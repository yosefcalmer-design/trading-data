/**
 * orderbook_simple_conditionid.ts
 *
 * Script único y sencillo:
 * - Introduces SOLO un conditionId
 * - Resuelve token YES y token NO
 * - Lee order book de ambos (REST)
 * - Imprime best bid/ask de YES y NO
 *
 * Requisitos:
 *   npm i @polymarket/clob-client
 *   Node 18+
 * 
 ❌ sin var

❌ sin arrow functions

❌ sin reduce

❌ sin .then()

✅ async/await

✅ script único
 */

import { ClobClient } from "@polymarket/clob-client";

const HOST = "https://clob.polymarket.com";
const CHAIN_ID = 137;

// ⬇️ PEGA AQUÍ TU conditionId
const CONDITION_ID = "0x28e70bf138d26916e26896b0c64f0e0e73067b07286989a24350cce5288ba397";

const INTERVAL_MS = 1000;

const client = new ClobClient(HOST, CHAIN_ID);

type Level = { price: number; size: number };

function parseLevels(raw: Array<{ price: string; size: string }>): Level[] {
  const out: Level[] = [];
  let i = 0;

  while (i < raw.length) {
    out.push({
      price: Number(raw[i].price),
      size: Number(raw[i].size),
    });
    i++;
  }

  return out;
}

function getBestBid(levels: Level[]): Level {
  let best: Level = { price: 0, size: 0 };
  let i = 0;

  while (i < levels.length) {
    if (levels[i].price > best.price) {
      best = levels[i];
    }
    i++;
  }

  return best;
}

function getBestAsk(levels: Level[]): Level {
  let best: Level = { price: 0, size: 0 };
  let i = 0;

  while (i < levels.length) {
    if (best.price === 0 || levels[i].price < best.price) {
      best = levels[i];
    }
    i++;
  }

  return best;
}

async function leerOrderBookBest(tokenId: string) {
  const ob = await client.getOrderBook(tokenId);

  const bids = parseLevels(ob.bids || []);
  const asks = parseLevels(ob.asks || []);

  const bb = getBestBid(bids);
  const ba = getBestAsk(asks);

  return {
    bestBid: bb.price,
    bestBidSize: bb.size,
    bestAsk: ba.price,
    bestAskSize: ba.size,
  };
}

function normalizeOutcome(outcome: any): string {
  const s = String(outcome || "").trim().toLowerCase();
  if (s === "yes") return "YES";
  if (s === "no") return "NO";
  return s.toUpperCase();
}

async function resolverTokenYesNo(conditionId: string) {
  // getMarket(conditionId) es método público según docs :contentReference[oaicite:1]{index=1}
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

  if (!tokenYes || !tokenNo) {
    // Por si vinieran outcomes raros (UP/DOWN, etc.), lo mantenemos simple:
    // si no hay YES/NO claros, devolvemos el orden tal cual (pero avisamos).
    console.log("⚠️ No pude identificar outcome YES/NO claramente. Uso el orden devuelto por market.tokens.");
    tokenYes = String(market.tokens[0].token_id);
    tokenNo = String(market.tokens[1].token_id);
  }

  return { tokenYes: tokenYes, tokenNo: tokenNo };
}

async function main() {
  console.log("ConditionId:", CONDITION_ID);

  const pair = await resolverTokenYesNo(CONDITION_ID);

  console.log("Token YES:", pair.tokenYes);
  console.log("Token NO :", pair.tokenNo);

  setInterval(async function () {
    try {
      const yes = await leerOrderBookBest(pair.tokenYes);
      const no = await leerOrderBookBest(pair.tokenNo);

      console.clear();

      console.log("YES");
      console.log("  bestBid:", yes.bestBid, "size:", yes.bestBidSize);
      console.log("  bestAsk:", yes.bestAsk, "size:", yes.bestAskSize);

      console.log("");
      console.log("NO");
      console.log("  bestBid:", no.bestBid, "size:", no.bestBidSize);
      console.log("  bestAsk:", no.bestAsk, "size:", no.bestAskSize);
    } catch (e) {
      console.error("Error leyendo order books:", e);
    }
  }, INTERVAL_MS);
}

main().catch(function (e) {
  console.error("Error fatal:", e);
});
