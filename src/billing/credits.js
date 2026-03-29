import 'dotenv/config'
import { getRateWithRefresh } from './rates.js'

const CREDIT_USD_VALUE = Number(process.env.CREDIT_USD_VALUE ?? 0.001)

export async function cryptoToMicroCredits(currency, amount) {
  const rate = await getRateWithRefresh(currency)
  const usd  = amount * rate
  return Math.floor(usd / CREDIT_USD_VALUE) * 1000
}
