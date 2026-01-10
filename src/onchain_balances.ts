import "dotenv/config";
import { ethers } from "ethers";

const USDC_NATIVE = "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359"; // USDC (native) :contentReference[oaicite:2]{index=2}
const USDC_BRIDGED = "0x2791bca1f2de4661ed88a30c99a7a9449aa84174"; // USDC.e (bridged) :contentReference[oaicite:3]{index=3}

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

async function readErc20(provider: ethers.providers.Provider, tokenAddr: string, owner: string) {
  const token = new ethers.Contract(tokenAddr, ERC20_ABI, provider);

  const [symbol, decimals, bal] = await Promise.all([
    token.symbol().catch(() => "ERC20"),
    token.decimals().catch(() => 6),
    token.balanceOf(owner),
  ]);

  return {
    token: tokenAddr,
    symbol,
    decimals,
    raw: bal.toString(),
    human: ethers.utils.formatUnits(bal, decimals),
  };
}

async function main() {
  const rpcUrl = process.env.POLYGON_RPC_URL;
  if (!rpcUrl) throw new Error("Falta POLYGON_RPC_URL en .env");

  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("Falta PRIVATE_KEY en .env");

  // Provider = conexión a Polygon (vía Infura)
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

  // Wallet solo para sacar la address (no vamos a firmar nada)
  const wallet = new ethers.Wallet(pk);
  const address = await wallet.getAddress();

  console.log("Address:", address);

  // MATIC/POL (gas token) balance
  const maticWei = await provider.getBalance(address);
  console.log("POL:", ethers.utils.formatEther(maticWei));

  // USDC balances (native + bridged)
  const usdcNative = await readErc20(provider, USDC_NATIVE, address);
  const usdcBridged = await readErc20(provider, USDC_BRIDGED, address);

  console.log("USDC (native):", usdcNative.human, "| raw:", usdcNative.raw, "| token:", usdcNative.token);
  console.log("USDC.e (bridged):", usdcBridged.human, "| raw:", usdcBridged.raw, "| token:", usdcBridged.token);
}

main().catch((e) => {
  console.error("❌", e?.message || e);
  process.exit(1);
});
