import axios from "axios";
async function obtenerTokens() {
    
    const URL_GAMMA = "https://gamma-api.polymarket.com/markets/slug/";
    const PREFIJO: string = "btc-updown-15m-";
    let now_ts: number = Math.floor(Date.now() / 1000); // Timestamp actual en segundos
    let market_ts: number = Math.floor(now_ts / 900) * 900; // Agrupar en bloques de 900 segundos (15 minutos)
    let slug_actual: string = `${PREFIJO}${market_ts}`;
    let URL: string = `${URL_GAMMA}${slug_actual}`
    let tokenYes: string;
    let tokenNo: string;

    const response = await axios.get(URL);
    let tokens = JSON.parse(response.data["clobTokenIds"]);
    console.log(response.data["conditionId"]);
    [tokenYes, tokenNo] = tokens;
    console.log(`el slug es ${slug_actual}, el tokenYes es ${tokenYes} y el tokenNo es ${tokenNo}`);
}
obtenerTokens();