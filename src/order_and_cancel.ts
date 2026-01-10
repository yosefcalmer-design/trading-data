import "dotenv/config";
import fs from "node:fs";
import { ClobClient, Side, OrderType } from "@polymarket/clob-client";
import { Wallet } from "@ethersproject/wallet";

async function getGammaMarketMetaByTokenId(tokenId: string) {
  // Gamma soporta filtrar por clob_token_ids :contentReference[oaicite:1]{index=1}
  const url = new URL("https://gamma-api.polymarket.com/markets");
  url.searchParams.set("clob_token_ids", tokenId);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Gamma error ${res.status}: ${await res.text()}`);
  const data = await res.json();

  // Gamma a veces devuelve array; a veces objeto. Normalizamos:
  const market = Array.isArray(data) ? data[0] : (data?.data?.[0] ?? data?.[0] ?? data);
  if (!market) throw new Error(`No encuentro market en Gamma para tokenId=${tokenId}`);

  // tickSize y negRisk suelen venir en el objeto market (según doc/ejemplos) :contentReference[oaicite:2]{index=2}
  return {
    tickSize: String(market.tickSize ?? market.tick_size ?? "0.01"),
    negRisk: Boolean(market.negRisk ?? market.neg_risk ?? false),
    // mínimo: si Gamma no lo trae, usamos el que te ha devuelto el CLOB (5)
    minSize: Number(market.minOrderSize ?? market.min_order_size ?? 5),
  };
}

async function main() {
  const HOST = process.env.CLOB_HOST ?? "https://clob.polymarket.com";
  const CHAIN_ID = Number(process.env.CLOB_CHAIN_ID ?? "137");
  const SIGNATURE_TYPE = 0; // EOA

  const TOKEN_ID = process.argv[2];
  if (!TOKEN_ID) {
    throw new Error("Uso: npx ts-node src/order_and_cancel.ts <TOKEN_ID> [PRICE] [SIZE]");
  }

  const PRICE = Number(process.argv[3] ?? "0.10");
  const SIZE = Number(process.argv[4] ?? "5"); // 👈 mínimo 5 (tu error)

  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("Falta PRIVATE_KEY en .env");
  const signer = new Wallet(pk);
  const FUNDER_ADDRESS = await signer.getAddress();

  const raw = JSON.parse(fs.readFileSync(".credentials.json", "utf8"));
  const apiKey = raw.apiKey ?? raw.key;
  const secret = raw.secret;
  const passphrase = raw.passphrase;
  if (!apiKey || !secret || !passphrase) {
    throw new Error("Campos inválidos en .credentials.json (apiKey/key, secret, passphrase)");
  }
  const creds = { apiKey, key: apiKey, secret, passphrase } as any;

  const client = new ClobClient(
    HOST,
    CHAIN_ID,
    signer as any,
    creds,
    SIGNATURE_TYPE as any,
    FUNDER_ADDRESS
  );

  console.log("Wallet:", FUNDER_ADDRESS);
  console.log("TokenID:", TOKEN_ID);

  // ✅ Metadata desde Gamma (no /markets/{tokenId} del CLOB)
  const meta = await getGammaMarketMetaByTokenId(TOKEN_ID);
  console.log("Meta:", meta);

  if (SIZE < meta.minSize) {
    throw new Error(`SIZE (${SIZE}) < mínimo (${meta.minSize}). Sube SIZE a ${meta.minSize}+`);
  }

  console.log(`Placing order: BUY ${SIZE} @ ${PRICE}`);

  const resp: any = await (client as any).createAndPostOrder(
    { tokenID: TOKEN_ID, price: PRICE, side: Side.BUY, size: SIZE },
    { tickSize: meta.tickSize, negRisk: meta.negRisk },
    OrderType.GTC
  );

  console.log("Order response:", resp);

  const orderID = resp?.orderID ?? resp?.orderId ?? resp?.id;
  if (!orderID) {
    throw new Error("No hay orderID: la orden no se colocó (mira Order response).");
  }

  console.log("🧹 Cancelling order:", orderID);
    const cancelResp = await (client as any).cancelOrders([orderID]);
    console.log("Cancel response:", cancelResp);
}

main().catch((e) => {
  console.error("❌", e?.message || e);
  process.exit(1);
});
