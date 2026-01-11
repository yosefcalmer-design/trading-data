import "dotenv/config";
//dotenv es un paquete de npm que lee archivos .env y carga sus valores en process.env
//dotenv/config es una forma abreviada de importar y ejecutar dotenv automáticamente al inicio de tu aplicación
/*
El funcionamiento es el siguiente
1. Node.js lee el import (Node.js es un entorno de ejecución que te permite ejecutar JavaScript fuera del navegador, porque tradicionalmente sólo funcionaba en chrome, safari...)
2. dotenv busca un archivo .env en la raíz del proyecto
3. Lee cada línea:  CLAVE=valor
4. Las inyecta en process.env. CLAVE
5. Ahora puedes acceder:  process.env.POLYGON_RPC_URL
*/

import { Wallet } from "@ethersproject/wallet";
/*
Importa la clase Wallet desde la librería @ethersproject/wallet para poder crear y gestionar billeteras (wallets) de Ethereum/Polygon.
@ethersproject Es una colección de librerías creadas por ethers.js para interactuar con Ethereum (y chains compatibles como Polygon).
Wallet es una clase que representa una billetera blockchain. Te permite:

✅ Almacenar tu clave privada
✅ Firmar transacciones
✅ Obtener tu dirección pública
✅ Enviar transacciones a la blockchain

Al crear el objeto Wallet, podemos:
// 1️⃣ Obtener tu dirección: 
const owner = await wallet.getAddress();
// → "0x9876fedc..."

// 2️⃣ Firmar transacciones:
const tx = await usdc.approve(exchangeSpender, desired, {... });
// ↑ wallet firma esto automáticamente porque el contrato usa "wallet" como signer

Es decir, al crear el objeto const wallet = new Wallet(pk, provider) [Este wallet PUEDE firmar transacciones]
y al crear el contrato const usdc = new Contract(usdcAddress, ERC20_ABI, wallet) e incluir la wallet, estamos diciendo que el signer es la wallet

// 3️⃣ Consultar balance:
const balance = await wallet. getBalance();

El objeto wallet de ethers incluye vairos métodos, como getAddress(), signTransaction(), sendTransaction(), getBalance(), etc.

*/
import { JsonRpcProvider } from "@ethersproject/providers";
/*
importa la clase JsonRpcProvider desde la librería @ethersproject/providers para conectarse a una blockchain compatible con JSON-RPC, como Polygon.
@ethersproject/providers es parte de ethers.js y proporciona varias clases para interactuar con diferentes tipos de proveedores blockchain.
JSON-RPC es un protocolo estándar para comunicarse con nodos blockchain. Permite enviar solicitudes y recibir respuestas en formato JSON.
Esta clase incluye los siguientes métodos importantes como:
✅ getBalance(address): Obtiene el balance de una dirección.
✅ getTransaction(txHash): Obtiene los detalles de una transacción por su hash.
✅ sendTransaction(signedTx): Envía una transacción firmada a la blockchain.
✅ getFeeData(): Obtiene datos actuales sobre tarifas de gas (importante para Polygon).
Al crear un JsonRpcProvider, le pasas la URL del nodo RPC al que quieres conectarte (por ejemplo, un nodo de Infura o Alchemy para Polygon).
*/

import { Contract } from "@ethersproject/contracts";
/*
Contract es una clase de la misma libreria que la anterior
const usdc = new Contract(address, abi, signerOrProvider);
Es un smart contract, que es un programa desplegado en la blockchain que puede ejecutar código automáticamente cuando se cumplen ciertas condiciones.

Al crear un objeto Contract, le pasas:
1️⃣ address: La dirección del contrato en la blockchain (por ejemplo, la dirección del contrato USDC en Polygon).
  la definimos con const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
2️⃣ abi: La Application Binary Interface, que define las funciones y eventos del contrato.
3️⃣ signerOrProvider: Un objeto Wallet (signer) o Provider para interactuar con el contrato.
*/

import { parseUnits, formatUnits } from "@ethersproject/units";
/*
Importa dos funciones desde la librería @ethersproject/units para convertir entre números legibles y números de blockchain.
parseUnits   // "5" → "5000000" (humano → blockchain)
formatUnits  // "5000000" → "5" (blockchain → humano)
*/

import { getContractConfig } from "@polymarket/clob-client/dist/config.js";
/*
importa la función getContractConfig desde la librería @polymarket/clob-client para obtener las direcciones de los contratos específicos del CLOB (Central Limit Order Book) de Polymarket según la chainId.
Esta función toma como parámetro el chainId (por ejemplo, 137 para Polygon) y devuelve un objeto con las direcciones de los contratos relevantes, como:
- exchange: Dirección del contrato PolymarketExchange
- collateral: Dirección del contrato de colateral (USDC)
- otros contratos relacionados con el CLOB
*/

const ERC20_ABI = [
  "function decimals() view returns (uint8)", //cuántos decimales usa el token
  "function symbol() view returns (string)", //símbolo del token (ej: "USDC")
  "function allowance(address owner, address spender) view returns (uint256)", //cuántos tokens puede gastar el spender en nombre del owner
  "function approve(address spender, uint256 amount) returns (bool)", //aprobar que el spender pueda gastar amount tokens en tu nombre
];

/*
ERC20_ABI es el nombre descriptivo del ABI del estándar ERC20 de tokens en Ethereum/Polygon.
Es un estándar que define un conjunto común de funciones y eventos que todos los tokens ERC20 deben implementar.
Todos los tokens ERC20 tienen las mismas funciones básicas:

Funciones obligatorias de ERC20:
✅ name()           - Nombre del token
✅ symbol()         - Símbolo (ej: "USDC")
✅ decimals()       - Número de decimales
✅ totalSupply()    - Cantidad total de tokens
✅ balanceOf()      - Balance de una dirección
✅ transfer()       - Transferir tokens
✅ approve()        - Aprobar allowance
✅ allowance()      - Consultar allowance
✅ transferFrom()   - Transferir desde otra dirección

Events:
✅ Transfer
✅ Approval
USDC, DAI, WETH, etc., todos siguen este estándar. Por eso puedes usar el mismo ABI para cualquier token ERC20.

3️⃣ ¿Por qué solo 4 funciones?
El estándar ERC20 completo tiene 9 funciones, pero tú solo necesitas 4 para tu script:
*/

const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"; // el que tú tienes
//Es la dirección única del smart contract de USDC.e desplegado en Polygon.
//se puede hardcodear porque nunca cambia y es el mismo para todos los usuarios en Polygon.
//en cambio, el spender (PolymarketExchange) depende de la chainId y se obtiene dinámicamente.


/*
en la siguiente función necesitamos async porque hacemos llamadas a la blockchain que son operaciones de red que pueden tardar un tiempo en completarse.
Estas llamadas devuelven Promesas que se resuelven cuando la blockchain responde.
Usar async/await nos permite escribir código asíncrono de manera más sencilla y legible, como si fuera código síncrono.
*/
async function main() {
  const chainId = Number(process.env.CLOB_CHAIN_ID ?? "137");
  // ?? devuelve el valor de la izquierda si no es null/undefined; si lo es, devuelve el de la derecha
  //137 es el Chain ID de Polygon Mainnet - la red principal donde opera Polymarket.

  const rpcUrl = process.env.POLYGON_RPC_URL;
  /*
  Necesitamos POLYGON_RPC_URL para conectarnos a la red de Polygon y leer datos on-chain (como allowance actual).
  Un RPC URL es la dirección de un nodo de Polygon al que podemos enviar solicitudes JSON-RPC para interactuar con la blockchain.
  Ejemplos de RPC URLs son los que proporcionan servicios como Infura, Alchemy, QuickNode, etc.
  Esta url es propia de cada usuario y no se puede hardcodear en el script.
  */
  if (!rpcUrl) throw new Error("Falta POLYGON_RPC_URL en .env");

  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("Falta PRIVATE_KEY en .env");

  const amountStr = process.argv[2] ?? "5"; // por defecto 5 USDC
  /*
  amountStr es la cantidad de USDC que queremos aprobar como allowance para el contrato PolymarketExchange.
  process.argv es un array que contiene los argumentos de la línea de comandos cuando ejecutas un script de Node.js.
  Es decir, cuando escribimos npx ts-node src/approve_usdc.ts 10
  process.argv[0] → ruta a node
  process.argv[1] → ruta al script (src/approve_usdc.ts)
  process.argv[2] → "10" (primer argumento del usuario)
  Si el usuario no proporciona un valor, usamos "5" como valor por defecto.
  5 USDC es una cantidad razonable para empezar y cubrir varias órdenes en el CLOB sin tener que aprobar cada vez.  

  Y si escribiéramos npx ts-node src/approve_usdc.ts 10 0.1
  process.argv[2] → "10" (cantidad de USDC)
  process.argv[3] → "0.1" (otro argumento que podríamos usar para otra cosa)
  10 USDC es una cantidad mayor que 5, útil si planeas hacer muchas órdenes o quieres tener un margen más amplio. 
  */
  const provider = new JsonRpcProvider(rpcUrl); // ← Conexión a Polygon
  //Crea un objeto provider que establece la conexión a la blockchain de Polygon a través de la URL RPC que leíste del archivo .env.

  const wallet = new Wallet(pk, provider); // ← Firmar TXs
  //Crea un objeto wallet que representa tu billetera en Polygon usando la clave privada (pk) y el provider para conectarse a la red.
  const owner = await wallet.getAddress(); // Necesita RPC
  //Obtiene la dirección pública (owner) asociada a tu clave privada. Esta es la dirección desde la que aprobarás el allowance.

  const cfg: any = getContractConfig(chainId);
  /*
  Usa la función getContractConfig para obtener las direcciones de los contratos específicos del CLOB de Polymarket según el chainId (137 para Polygon).
  El objeto cfg contendrá varias direcciones de contratos, incluyendo la del exchange (PolymarketExchange) que necesitamos como spender.
  La utilizamos para obtener la dirección del spender correcto según la red en la que estemos trabajando.
  
  */
  const usdcAddress = USDC_E;          // ✅ USDC correcto
  const exchangeSpender: string = cfg.exchange; // ✅ spender correcto
 

  const usdc = new Contract(usdcAddress, ERC20_ABI, wallet);
  /*
  Crea un objeto que representa el contrato de USDC en Polygon, permitiéndote llamar a sus funciones (como approve(), symbol(), allowance(), etc.).
  Es como "conectar tu código al contrato USDC desplegado en la blockchain".
  */
  const [symbol, decimals] = await Promise.all([
    usdc.symbol().catch(() => "USDC"),
    usdc.decimals().catch(() => 6),
  ]);

  /*
  Llama SIMULTÁNEAMENTE (en paralelo) a dos funciones del contrato USDC (symbol() y decimals()), 
  y si alguna falla, usa valores por defecto ("USDC" y 6).
  el Promise.all espera a que ambas promesas se resuelvan y devuelve un array con los resultados.
  Esto es más eficiente que llamar a cada función por separado, ya que reduce el tiempo de espera total.
  1️⃣ usdc.symbol() obtiene el símbolo del token (ej: "USDC").
  2️⃣ usdc.decimals() obtiene el número de decimales que usa el token (USDC usa 6 decimales). 
  */

  const desired = parseUnits(amountStr, decimals);
  //Convierte el monto que pasaste como argumento (ejemplo: "5") a formato blockchain (5000000) usando los decimales del token USDC (6).
  //cómo se pasa como argumento? npx ts-node src/approve_usdc.ts 10
  console.log("Owner:", owner);
  console.log("ChainId:", chainId);
  console.log("USDC token:", usdcAddress);
  console.log("Exchange spender:", exchangeSpender);
  console.log("Desired allowance:", formatUnits(desired, decimals), symbol);

  const current = await usdc.allowance(owner, exchangeSpender);
  /*
  con usdc.allowance() haces una llamada de solo lectura al contrato USDC en la blockchain para obtener 
  la cantidad de tokens USDC que el propietario (owner) ha aprobado para que el gastador (spender) pueda usar en su nombre.
  1. Tu código genera la llamada → "eth_call"
  2. Se envía via HTTP al RPC URL
  3. El nodo de Polygon ejecuta la consulta
  4. Devuelve el resultado
  5. Tu código lo recibe ← allowance actual
  */

  console.log("Current allowance:", formatUnits(current, decimals), symbol);

  if (current.gte(desired)) {
    console.log("✅ Ya hay allowance suficiente. No hago nada.");
    return;
  }
/*
gte() es un método de los objetos BigNumber en ethers.js que significa "greater than or equal" (mayor o igual que).
Verifica si ya tienes allowance suficiente aprobado para el Exchange de Polymarket. 
Si ya lo tienes, termina el script sin gastar gas en una transacción innecesaria.
*/

  // ✅ Forzar gas EIP-1559 (evita el mínimo de Infura)
  const feeData = await provider.getFeeData();
  /*
  Consulta a la blockchain de Polygon para obtener información sobre las tarifas de gas actuales (fees), 
  para saber cuánto debes pagar por tu transacción de approve().

  El provider es tu conexión a Polygon - puede consultar datos de la blockchain.
  getFeeData() envía una solicitud al nodo RPC para obtener las tarifas recomendadas.
  Devuelve un objeto con:
  - gasPrice: Precio promedio del gas (legacy)
  - maxFeePerGas: Máximo que estás dispuesto a pagar por unidad de gas (EIP-1559)
  - maxPriorityFeePerGas: Propina máxima para los mineros (EIP-1559)
  Usar EIP-1559 es importante en redes como Polygon para asegurarte de que tu transacción se procese rápidamente y evitar problemas con precios mínimos impuestos por algunos proveedores RPC como Infura.
  */
  const minTip = parseUnits("30", "gwei");
  const minMax = parseUnits("80", "gwei");
  //Establece valores mínimos para la propina (tip) y el máximo (max) en gwei para asegur
  const tip = (feeData.maxPriorityFeePerGas ?? minTip).lt(minTip)
    ? minTip
    : (feeData.maxPriorityFeePerGas ?? minTip);
  //Asegura que la propina (tip) sea al menos minTip (30 gwei)
  const max = (feeData.maxFeePerGas ?? minMax).lt(minMax)
    ? minMax
    : (feeData.maxFeePerGas ?? minMax);
  //Asegura que el máximo (max) sea al menos minMax (80 gwei)
  console.log("Gas tip (gwei):", formatUnits(tip, "gwei"));
  console.log("Gas max (gwei):", formatUnits(max, "gwei"));

  console.log("🟡 Enviando approve...");
  const tx = await usdc.approve(exchangeSpender, desired, {
    maxPriorityFeePerGas: tip,
    maxFeePerGas: max,
  });
  /*
  Ejecuta la transacción de approve() en el contrato USDC, dando permiso al Exchange de Polymarket para gastar la cantidad especificada de tu USDC, con los parámetros de gas que configuraste.
  Ya hemos visto que hay que incluir al spender y la cantidad. Pero además, aquí pasamos un objeto extra con las configuraciones de gas:
  - maxPriorityFeePerGas: La propina máxima que estás dispuesto a pagar a los mineros (tip).
  - maxFeePerGas: El máximo total que estás dispuesto a pagar por unidad de gas (max).
  Esto asegura que tu transacción use tarifas EIP-1559 adecuadas para la red de Polygon.
  La llamada a usdc.approve() crea y firma la transacción usando tu wallet, y la envía a la red.

  lo que devuelve es un objeto tx que representa la transacción enviada.
  Este objeto incluye detalles como:
// {
//   hash: "0xabc123...",           // Hash de la TX
//   from: "0x742d35Cc.. .",         // Tu dirección
//   to: "0x2791Bca.. .",            // Contrato USDC
//   nonce: 42,                     // Nonce de tu wallet
//   gasLimit: BigNumber(50000),    // Límite de gas
//   maxPriorityFeePerGas: BigNumber(30000000000),
//   maxFeePerGas: BigNumber(80000000000),
//   data: "0x095ea7b3.. .",         // approve() codificado
//   value: BigNumber(0),           // No envías MATIC
//   chainId: 137,                  // Polygon
//   type: 2,                       // EIP-1559
//   wait: async function() {... }   // Método para esperar confirmación
// }
  esto no significa que la transacción ya esté confirmada en la blockchain, solo que ha sido enviada.
  Para confirmar que se ha incluido en un bloque, debes esperar a que se mine (confirmación).
  Y esto se sabrá con tx.wait()
  */
  console.log("TX hash:", tx.hash);
  console.log("⏳ Esperando confirmación...");
  const receipt = await tx.wait(1);
  /*
  Espera a que la transacción se confirme en la blockchain (es decir, que se mine en un bloque).
  El método wait(1) espera hasta que la transacción tenga al menos 1 confirmación (1 bloque minado encima).
  Una vez confirmada, devuelve un receipt que contiene detalles sobre la transacción confirmada, como por ejemplo:
// {
//   to: "0x2791Bca1f2de4661ED88A30c99A7a9449Aa84174", // Contrato USDC


  */
  console.log("✅ Confirmado en bloque:", receipt.blockNumber);

  const after = await usdc.allowance(owner, exchangeSpender);
  console.log("New allowance:", formatUnits(after, decimals), symbol);
}

main().catch((e) => {
  console.error("❌", e?.message || e);
  process.exit(1);
});
/*
Ejecuta la función main() y captura cualquier error que ocurra durante su ejecución.
*/
