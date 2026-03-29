import 'dotenv/config'
import db from '../db/db.js'
import { keys } from '../db/keys.js'

const RATE_GB_HOUR = Number(process.env.RATE_GB_HOUR ?? 5)

await db.put(keys.pricing('gb_hour'), String(RATE_GB_HOUR))
console.log(`[seed] pricing:gb_hour = ${RATE_GB_HOUR}`)

await db.close()
