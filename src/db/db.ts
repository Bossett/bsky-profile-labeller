import { Pool, neonConfig } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-serverless'

import ws from 'ws'
neonConfig.webSocketConstructor = ws

import * as schema from '@/db/schema.js'

const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL! })
const db = drizzle(pool, { schema: schema })

export default db
export * as schema from './schema.js'
export { eq, lte } from 'drizzle-orm'
