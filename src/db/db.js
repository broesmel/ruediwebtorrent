import 'dotenv/config'
import { resolve } from 'path'
import { ClassicLevel } from 'classic-level'

const LEVEL_PATH = resolve(process.env.LEVEL_PATH ?? './data/db')

const db = new ClassicLevel(LEVEL_PATH, { valueEncoding: 'utf8' })

export default db
