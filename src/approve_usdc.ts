import "dotenv/config";
import { Wallet } from "@ethersproject/wallet";
import { JsonRpcProvider } from "@ethersproject/providers";
import { Contract } from "@ethersproject/contracts";
import { parseUnits, formatUnits } from "@ethersproject/units";
import { getContractConfig } from "@polymarket/clob-client/dist/config.js";

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"; // el que tú tienes

async function main() {
  const chainId = Number(process.env.CLOB_CHAIN_ID ?? "137");
  const rpcUrl = process.env.POLYGON_RPC_URL;
  if (!rpcUrl) throw new Error("Falta POLYGON_RPC_URL en .env");

  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("Falta PRIVATE_KEY en .env");

  const amountStr = process.argv[2] ?? "5"; // por defecto 5 USDC

  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(pk, provider);
  const owner = await wallet.getAddress();

  const cfg: any = getContractConfig(chainId);

  const usdcAddress = USDC_E;          // ✅ USDC correcto
  const exchangeSpender: string = cfg.exchange; // ✅ spender correcto

  const usdc = new Contract(usdcAddress, ERC20_ABI, wallet);

  const [symbol, decimals] = await Promise.all([
    usdc.symbol().catch(() => "USDC"),
    usdc.decimals().catch(() => 6),
  ]);

  const desired = parseUnits(amountStr, decimals);

  console.log("Owner:", owner);
  console.log("ChainId:", chainId);
  console.log("USDC token:", usdcAddress);
  console.log("Exchange spender:", exchangeSpender);
  console.log("Desired allowance:", formatUnits(desired, decimals), symbol);

  const current = await usdc.allowance(owner, exchangeSpender);
  console.log("Current allowance:", formatUnits(current, decimals), symbol);

  if (current.gte(desired)) {
    console.log("✅ Ya hay allowance suficiente. No hago nada.");
    return;
  }

  // ✅ Forzar gas EIP-1559 (evita el mínimo de Infura)
  const feeData = await provider.getFeeData();

  const minTip = parseUnits("30", "gwei");
  const minMax = parseUnits("80", "gwei");

  const tip = (feeData.maxPriorityFeePerGas ?? minTip).lt(minTip)
    ? minTip
    : (feeData.maxPriorityFeePerGas ?? minTip);

  const max = (feeData.maxFeePerGas ?? minMax).lt(minMax)
    ? minMax
    : (feeData.maxFeePerGas ?? minMax);

  console.log("Gas tip (gwei):", formatUnits(tip, "gwei"));
  console.log("Gas max (gwei):", formatUnits(max, "gwei"));

  console.log("🟡 Enviando approve...");
  const tx = await usdc.approve(exchangeSpender, desired, {
    maxPriorityFeePerGas: tip,
    maxFeePerGas: max,
  });

  console.log("TX hash:", tx.hash);
  console.log("⏳ Esperando confirmación...");
  const receipt = await tx.wait(1);
  console.log("✅ Confirmado en bloque:", receipt.blockNumber);

  const after = await usdc.allowance(owner, exchangeSpender);
  console.log("New allowance:", formatUnits(after, decimals), symbol);
}

main().catch((e) => {
  console.error("❌", e?.message || e);
  process.exit(1);
});
