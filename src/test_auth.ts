import "dotenv/config";
import { ClobClient, AssetType } from "@polymarket/clob-client";
import { Wallet } from "@ethersproject/wallet";
import fs from "node:fs";

async function main() {
  const host = process.env.CLOB_HOST ?? "https://clob.polymarket.com";
  const chainId = Number(process.env.CLOB_CHAIN_ID ?? "137");
  const signatureType = Number(process.env.SIGNATURE_TYPE ?? "0");

  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("Falta PRIVATE_KEY en .env");
  const signer = new Wallet(pk);

  const raw = JSON.parse(fs.readFileSync(".credentials.json", "utf8"));

  const apiKey = raw.apiKey ?? raw.key;
  const secret = raw.secret;
  const passphrase = raw.passphrase;

  if (!apiKey || !secret || !passphrase) {
    throw new Error("Campos inválidos en .credentials.json (apiKey/key, secret, passphrase)");
  }

  const creds = {
    apiKey,
    key: apiKey,          // compat
    secret,
    passphrase,
  };

  const client = new ClobClient(host, chainId, signer, creds as any, signatureType as any);

  const openOrders = await client.getOpenOrders();

  // ✅ BALANCE “GENERAL” (COLLATERAL / USDC en el CLOB)
  const collateral = await client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });

  console.log("✅ Auth OK.");
  console.log("Wallet:", await signer.getAddress());
  console.log("OpenOrders:", openOrders);
  console.log("USDC balance:", collateral.balance);
  console.log("Allowances:");
  for (const [spender, amount] of Object.entries(collateral.allowance || {})) {
    console.log("  ", spender, "=>", amount);
  }

}

main().catch((e) => {
  console.error("❌", e?.message || e);
  process.exit(1);
});
