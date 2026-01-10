import "dotenv/config";
import { ClobClient, AssetType } from "@polymarket/clob-client";
import { Wallet } from "@ethersproject/wallet";
import { JsonRpcProvider } from "@ethersproject/providers";
import { Contract } from "@ethersproject/contracts";
import fs from "node:fs";

type CredentialsFile = {
  apiKey?: string;
  key?: string;
  secret?: string;
  passphrase?: string;
};

type Erc20AllowanceResult = {
  spender: string;
  allowance: string;
};

function parseSpenders(envValue: string | undefined): string[] {
  if (!envValue) {
    return [];
  }

  var parts: string[];
  parts = envValue.split(",");

  var out: string[];
  out = [];

  var i: number;
  for (i = 0; i < parts.length; i++) {
    var s: string;
    s = parts[i].trim();
    if (s.length > 0) {
      out.push(s);
    }
  }

  return out;
}

async function getUsdcAllowancesOnChain(
  provider: JsonRpcProvider,
  usdcAddress: string,
  owner: string,
  spenders: string[]
): Promise<Erc20AllowanceResult[]> {
  // Minimal ABI: allowance(owner, spender) returns uint256
  var abi: string[];
  abi = ["function allowance(address owner, address spender) view returns (uint256)"];

  var usdc: Contract;
  usdc = new Contract(usdcAddress, abi, provider);

  var results: Erc20AllowanceResult[];
  results = [];

  var i: number;
  for (i = 0; i < spenders.length; i++) {
    var spender: string;
    spender = spenders[i];

    var allowanceBn: any;
    allowanceBn = await usdc.allowance(owner, spender);

    results.push({
      spender: spender,
      allowance: allowanceBn.toString()
    });
  }

  return results;
}

async function main(): Promise<void> {
  const host = process.env.CLOB_HOST ?? "https://clob.polymarket.com";
  const chainId = Number(process.env.CLOB_CHAIN_ID ?? "137");
  const signatureType = Number(process.env.SIGNATURE_TYPE ?? "0");

  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("Falta PRIVATE_KEY en .env");

  const signer = new Wallet(pk);
  const walletAddress = await signer.getAddress();

  const rawCreds = JSON.parse(fs.readFileSync(".credentials.json", "utf8")) as CredentialsFile;

  const apiKey = rawCreds.apiKey ?? rawCreds.key;
  const secret = rawCreds.secret;
  const passphrase = rawCreds.passphrase;

  if (!apiKey || !secret || !passphrase) {
    throw new Error("Campos inválidos en .credentials.json (apiKey/key, secret, passphrase)");
  }

  const creds = {
    apiKey: apiKey,
    key: apiKey, // compat
    secret: secret,
    passphrase: passphrase
  };

  const client = new ClobClient(host, chainId, signer, creds as any, signatureType as any);

  // 1) Datos del CLOB
  const openOrders = await client.getOpenOrders();
  const collateral = await client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });

  console.log("✅ Auth OK.");
  console.log("Wallet:", walletAddress);
  console.log("OpenOrders:", openOrders);
  console.log("USDC balance (CLOB):", collateral.balance);

  console.log("---- Allowances (según CLOB endpoint) ----");
  if (collateral.allowance && Object.keys(collateral.allowance).length > 0) {
    var entries: [string, unknown][];
    entries = Object.entries(collateral.allowance);

    var i: number;
    for (i = 0; i < entries.length; i++) {
      var spender: string;
      spender = entries[i][0];
      var amount: unknown;
      amount = entries[i][1];
      console.log("  ", spender, "=>", amount);
    }
  } else {
    console.log("  (vacío / no reportado por el endpoint)");
  }

  // 2) Allowances on-chain (USDC ERC20)
  const rpcUrl = process.env.POLYGON_RPC_URL;
  const usdcAddress = process.env.USDC_ADDRESS;
  const spenders = parseSpenders(process.env.ALLOWANCE_SPENDERS);

  console.log("---- Allowances (on-chain ERC20 USDC) ----");
  if (!rpcUrl) {
    console.log("  Falta POLYGON_RPC_URL en .env (no puedo leer allowances on-chain).");
    return;
  }
  if (!usdcAddress) {
    console.log("  Falta USDC_ADDRESS en .env (no puedo leer allowances on-chain).");
    return;
  }
  if (spenders.length === 0) {
    console.log("  Falta ALLOWANCE_SPENDERS en .env (no sé contra qué spenders medir).");
    return;
  }

  var provider: JsonRpcProvider;
  provider = new JsonRpcProvider(rpcUrl);

  const onChain = await getUsdcAllowancesOnChain(provider, usdcAddress, walletAddress, spenders);

  var j: number;
  for (j = 0; j < onChain.length; j++) {
    console.log("  ", onChain[j].spender, "=>", onChain[j].allowance);
  }
}

main().catch((e) => {
  console.error("❌", e?.message || e);
  process.exit(1);
});