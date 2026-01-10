import "dotenv/config";
import { ClobClient } from "@polymarket/clob-client";
import { Wallet } from "@ethersproject/wallet";
import fs from "node:fs";

async function main() {
  const host = process.env.CLOB_HOST ?? "https://clob.polymarket.com";
  const chainId = Number(process.env.CLOB_CHAIN_ID ?? "137");
  const pk = process.env.PRIVATE_KEY;

  if (!pk || !pk.startsWith("0x")) {
    throw new Error("PRIVATE_KEY falta o no empieza por 0x");
  }

  const signer = new Wallet(pk);

  const client = new ClobClient(host, chainId, signer);
  const creds = await client.createOrDeriveApiKey();

  const apiKey = (creds as any).apiKey ?? (creds as any).key;

  console.log("apiKey:", apiKey);
  console.log("secret:", creds.secret);
  console.log("passphrase:", creds.passphrase);

  fs.writeFileSync(
    ".credentials.json",
    JSON.stringify({ apiKey, secret: creds.secret, passphrase: creds.passphrase }, null, 2)
  );

  console.log("✅ Guardadas en .credentials.json");
}

main().catch((e) => {
  console.error("❌", e?.message || e);
  process.exit(1);
});
