import env from '@/env/env.js'
import * as schema from '@/db/schema.js'

/*
import { Pool, neonConfig } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-serverless'

import ws from 'ws'

neonConfig.webSocketConstructor = ws

const pool = new Pool({ connectionString: env.NEON_DATABASE_URL })
const db = drizzle(pool, { schema: schema })
*/

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

const queryClient = postgres(env.POSTGRES_DATABASE_URL)
const db = drizzle(queryClient, { schema: schema })

export default db

export * as schema from '@/db/schema.js'
export {
  eq,
  lte,
  isNull,
  isNotNull,
  and,
  inArray,
  notInArray,
  sql,
} from 'drizzle-orm'
