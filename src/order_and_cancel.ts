import "dotenv/config";
import fs from "node:fs";
/*fs es el módulo de Node.js para manejar el sistema de archivos (leer/escribir archivos)
se utiliza para leer las credenciales desde .credentials.json
en el approve_usdc.ts no se utilizaba fs porque no leía archivos tipo json externos
*/
import { ClobClient, Side, OrderType } from "@polymarket/clob-client";
/*
Aquí se importan ClobClient, Side y OrderType desde la librería @polymarket/clob-client.
- ClobClient: Cliente para interactuar con el CLOB de Polymarket.
- Side: Enum para especificar el lado de la orden (BUY/SELL).
- OrderType: Enum para especificar el tipo de orden (GTC, IOC, etc.).

ClobClient es la clase principal y se compone de varios métodos para crear órdenes, cancelar órdenes, obtener balances, etc.,
Entre estos métodos se encuentran:
- createAndPostOrder(): Crea y envía una orden al CLOB.
- cancelOrders(): Cancela órdenes existentes en el CLOB.
- getOpenOrders(): Obtiene las órdenes abiertas del usuario.
- getBalanceAllowance(): Obtiene el balance y las asignaciones de tokens del usuario.
- getOrderStatus(): Obtiene el estado de una orden específica.
- getMarketInfo(): Obtiene información del mercado para un token específico.
- placeMarketOrder(): Coloca una orden de mercado.

El cloblient es el equivalente al contract de ethers.js pero para interactuar con el CLOB de Polymarket.
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
async function getGammaMarketMetaByTokenId(tokenId: string) {
  // Gamma soporta filtrar por clob_token_ids :contentReference[oaicite:1]{index=1}
  const url = new URL("https://gamma-api.polymarket.com/markets");
  //creamos un objeto URL para consultar la API de Gamma
  //URL es una clase nativa de JavaScript para manejar URLs
  url.searchParams.set("clob_token_ids", tokenId);
  /*
  Aquí se agrega un query parameter a la URL para filtrar por el tokenId específico.
  searchParams es una propiedad de la clase URL que permite manipular los parámetros de consulta (query parameters) de la URL.
  set() agrega o actualiza un parámetro de consulta con el nombre "clob_token_ids" y el valor tokenId.
  de esta forma, la url final será:
  https://gamma-api.polymarket.com/markets?clob_token_ids=<TOKEN_ID>
  */
  const res = await fetch(url.toString());
  /*
  Aquí se realiza una solicitud HTTP GET a la URL construida utilizando fetch.
  fetch es una función nativa de JavaScript para hacer solicitudes HTTP.
  url.toString() convierte el objeto URL a una cadena de texto (string) con la URL completa.
  La respuesta de la solicitud se almacena en la variable res.

  La respuesta es un objeto del tipo response algo así:
  // Response {
  //   ok:   true,
  //   status:  200,
  //   statusText: "OK",
  //   headers: Headers {... },
  //   body: ReadableStream,
  //   url: "https://gamma-api.polymarket.com/markets? clob_token_ids=.. .",
  //   // ... más propiedades
  // }

  */
  if (!res.ok) throw new Error(`Gamma error ${res.status}: ${await res.text()}`);
  //si la respuesta no es ok (status code 200-299), lanza un error con el status code y el texto de la respuesta
  const data = await res.json();
  // Convierte la respuesta a JSON y la almacena en data
  //  Los campos de data son algo así:conditionId, clobTokenId, description, endTime, feeRate, minOrderSize, negRisk, outcomes, question, resolution, startTime, tickSize, type, etc.
  


  // Gamma a veces devuelve array; a veces objeto. Normalizamos:
  const market = Array.isArray(data) ? data[0] : (data?.data?.[0] ?? data?.[0] ?? data);
  if (!market) throw new Error(`No encuentro market en Gamma para tokenId=${tokenId}`);

  // tickSize y negRisk suelen venir en el objeto market (según doc/ejemplos) :contentReference[oaicite:2]{index=2}
  
  //console.log("🔍 Market object from Gamma:", JSON.stringify(market, null, 2));

  return {
    tickSize: String(market.orderPriceMinTickSize ),
    negRisk: Boolean(market.negRisk),
    minSize: Number(market.orderMinSize),
  };

  /*
  Este return es lo que devuelve la función, que es un objeto (porque está entre corchetes), con esas tres clave-valor.
  */
}

async function main() {
  const HOST = process.env.CLOB_HOST ?? "https://clob.polymarket.com";
  const CHAIN_ID = Number(process.env.CLOB_CHAIN_ID ?? "137");
  const SIGNATURE_TYPE = 0; // EOA
  /*
  Estas tres líneas configuran los parámetros para conectarse al CLOB de Polymarket:
  - HOST: La URL del host del CLOB. Se obtiene de la variable de entorno CLOB_HOST o usa un valor por defecto.
  - CHAIN_ID: El ID de la cadena blockchain (Polygon = 137). Se obtiene de la variable de entorno CLOB_CHAIN_ID o usa un valor por defecto.
  - SIGNATURE_TYPE: El tipo de firma para las transacciones. Aquí se establece en 0, que indica una cuenta externa (EOA).

    0 = Wallet normal 🔑
    1 = Firmas estructuradas 📝
    2 = Smart contract wallet 🏦
  */
  const TOKEN_ID = process.argv[2];
  /*
  TOKEN_ID recibirá el valor que se pase como tercer argumento al ejecutar el script desde la línea de comandos.
  Es decir, al escribir npx ts-node src/order_and_cancel.ts <TOKEN_ID> [PRICE] [SIZE]
  process.argv[0] = "/usr/bin/node"                          // Ruta a Node
  process.argv[1] = "/ruta/a/tu/proyecto/src/order_and_cancel.ts"  // Tu script
  process.argv[2] = "123456"     // ← TOKEN_ID (primer argumento tuyo)
  process.argv[3] = "0.75"       // ← PRICE (segundo argumento tuyo)
  process.argv[4] = "10"         // ← SIZE (tercer argumento tuyo)
  
  */
  if (!TOKEN_ID) {
    throw new Error("Uso: npx ts-node src/order_and_cancel.ts <TOKEN_ID> [PRICE] [SIZE]");
  }
  /*
  throw lanza una excepción si no se proporciona TOKEN_ID.
  Esto detiene la ejecución del script y muestra un mensaje de error indicando cómo usar el script correctamente.
  salta diretamente al catch del final
  */
  const PRICE = Number(process.argv[3] ?? "0.10");// Precio por defecto 0.10 si no se proporciona
  const SIZE = Number(process.argv[4] ?? "5");

  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("Falta PRIVATE_KEY en .env");
  const signer = new Wallet(pk);
  /*
  El formato habitual del objeto wallet de ethers.js es: new Wallet(privateKey, provider)
  Aquí, al estar en off-chain (fuera de la blockchain), no necesitamos un provider.
  Por lo tanto, solo pasamos la clave privada (pk) para que Polymarket pueda firmar las transacciones
  Aún no se manda nada a la blockchain, solo se firman las órdenes para enviarlas al CLOB.
  El objeto wallet de ethers.js tiene varios métodos, como getAddress(), signTransaction(), sendTransaction(), getBalance(), etc.
  */
  const FUNDER_ADDRESS = await signer.getAddress();
  /*
  getAddress() obtiene la dirección pública asociada a la clave privada (pk) del signer
  Es el hash de la public address. El esquema es el siguiente:

  // 1. PRIVATE KEY (lo que tienes en . env)
  const pk = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
  // ↑ 64 caracteres hex (256 bits)

  // 2. PUBLIC KEY (derivada de private key con curva elíptica)
  // Coordenadas (x, y): aprox 128 caracteres hex (512 bits)
  // Ejemplo: "0x04a1b2c3d4... .(muy largo).... xyz"

  // 3. ADDRESS (lo que devuelve getAddress() --> Es el hash de la public address)
  const address = await signer.getAddress();
  // ↑ "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
  // ↑ 40 caracteres hex (160 bits) + prefijo "0x"

  */

  const raw = JSON.parse(fs.readFileSync(".credentials.json", "utf8"));
  /*
  gracias a fs leemos el archivo .credentials.json de forma síncrona (readFileSync)
  y lo convertimos a string con "utf8"
  luego, con JSON.parse convertimos ese string JSON a un objeto JavaScript
  */
  const apiKey = raw.apiKey ?? raw.key;
  const secret = raw.secret;
  const passphrase = raw.passphrase;

  /*
  Extraemos del credentials.json los campos apiKey (o key), secret y passphrase, 
  que es como si fuera usuario, contraseña y segundo factor para autenticar al usuario en el CLOB de Polymarket.
  */

  if (!apiKey || !secret || !passphrase) {
    throw new Error("Campos inválidos en .credentials.json (apiKey/key, secret, passphrase)");
  }
  const creds = { apiKey, key: apiKey, secret, passphrase } as any;
  /*
  Creamos un objeto creds con las credenciales necesarias para autenticar al usuario en el CLOB de Polymarket.
  Se usa "as any" para evitar errores de tipado en TypeScript.
  Hay 4 campos porque la librería ClobClient puede esperar apiKey o key.
  */

  const client = new ClobClient(
    HOST,
    CHAIN_ID,
    signer as any,
    creds,
    SIGNATURE_TYPE as any,
    FUNDER_ADDRESS
  );
  /*
  Y con todo lo que hemos obtenido previamente, creamos una instancia (objeto) de ClobClient para interactuar con el CLOB de Polymarket.
  El signer as any es porque el tipo esperado por ClobClient puede no coincidir exactamente con el tipo de ethers.js (diferentes versiones, interfaces, etc.)
  El proceso es el siguiente:
  // 1. Configuración
  const client = new ClobClient(
    "https://clob.polymarket.com",  // Servidor
    137,                              // Polygon
    signer,                           // Para firmar
    creds,                            // Para autenticar API
    0,                                // Tipo de firma EOA
    "0x742d..."                       // Tu dirección
  );

  // 2. Cuando creas una orden:
  client.createOrder({ tokenID, price, side, size })
    ↓
    Construye mensaje de orden
    ↓
    signer.signMessage(orden)  // Firma con private key
    ↓
    POST https://clob.polymarket.com/orders
      Headers: { apiKey, signature from creds }
      Body: { orden firmada, FUNDER_ADDRESS }
    ↓
    Servidor valida: 
      ✓ Credenciales API (creds)
      ✓ Firma criptográfica (signer)
      ✓ Address coincide (FUNDER_ADDRESS)
    ↓
    Ejecuta orden en blockchain (Polygon)
  */
  console.log("Wallet:", FUNDER_ADDRESS);
  console.log("TokenID:", TOKEN_ID);

  // ✅ Metadata desde Gamma (no /markets/{tokenId} del CLOB)
  const meta = await getGammaMarketMetaByTokenId(TOKEN_ID);
  //Recordemos que esa función devuelve tres cosas: tickSize, negRisk, minSize como un objeto.
  
  console.log("Meta:", meta);

  //si el SIZE que le hemos pasado por la línea de comandos es menor que el minSize del mercado, lanza un error
  //si no hemos pasado nada por la línea de comandos utiliza por defecto SIZE = 5
  if (SIZE < meta.minSize) {
    throw new Error(`SIZE (${SIZE}) < mínimo (${meta.minSize}). Sube SIZE a ${meta.minSize}+`);
  }

  console.log(`Placing order: BUY ${SIZE} @ ${PRICE}`);

  const resp: any = await (client as any).createAndPostOrder(
    { tokenID: TOKEN_ID, price: PRICE, side: Side.BUY, size: SIZE },
    { tickSize: meta.tickSize, negRisk: meta.negRisk },
    OrderType.GTC
  );

  /*
    El método createAndPostOrder crea y envía una orden al CLOB de Polymarket.
    Es un método del objeto client (ClobClient) que hemos creado antes.
    Parámetros:
    1️⃣ Objeto con los detalles de la orden:
      - tokenID: El ID del token/mercado.
      - price: El precio al que queremos comprar/vender.
      - side: El lado de la orden (BUY o SELL).
      - size: El tamaño/cantidad de la orden.
    2️⃣ Objeto con metadata del mercado:
      - tickSize: El tamaño mínimo del tick (incremento de precio).
      - negRisk: Booleano que indica si el mercado tiene riesgo negativo.
    3️⃣ Tipo de orden:
      - OrderType.GTC: Orden "Good Till Cancelled" (válida hasta que se cancele).
      También existen otros parámetros, como hacer la orden take o maker, pero aquí no los usamos.

    Es un método de conveniencia ("wrapper") que hace 2 cosas en secuencia:
      - createOrder() - Construir y firmar la orden
          const order = await this.createOrder(userOrder, options);
      - postOrder()   - Enviar la orden firmada al CLOB
          return this.postOrder(order, orderType, deferExec, postOnly);
    
    1) createOrder:
    - userOrder es un objeto con los datos de la orden que quieres crear:
      interface UserOrder {
        tokenID: string;        // ID del token del mercado
        price: number;          // Precio (0.01 - 0.99)
        side: Side;             // Side. BUY o Side.SELL
        size: number;           // Cantidad de tokens
        feeRateBps?:  number;    // Fee opcional (auto-calculado si se omite)
        nonce?: number;         // Nonce opcional (auto-generado si se omite)
        expiration?: number;    // Unix timestamp de expiración (para GTD)
      }
    - options es para pasar opciones Si no las pasamos, el SDK consulta automáticamente a CLOB (menos eficiente)
        interface CreateOrderOptions {
          tickSize:  string;    // "0.01" o "0.001"
          negRisk: boolean;    // true/false
        }
     
     2) postOrder:   
     - order es el objeto firmado que devuelve createOrder
     - orderType es el tipo de orden (GTC, IOC, FOK)
     - deferExec: Por defecto es false. Si es false, la orden se ejecuta inmediatamente. Si es true, se difiere la ejecución (no usado aquí)
     - postOnly: Por defecto es false. Si es false puede actuar como taker (matching inmediato) Si es true, solo maker (si hay matching inmediato se rechaza)


      createAndPostOrder	GTC, GTD	Órdenes límite
      createAndPostMarketOrder	FOK, FAK	Órdenes de mercado

      
  */

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
