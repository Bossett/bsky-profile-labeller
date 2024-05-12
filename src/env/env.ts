import { z } from 'zod'
import logger from '@/helpers/logger.js'
import limits from '@/env/limits.js'

const envSchema = z.object({
  LABELLER_HANDLE: z.string(),
  LABELLER_PASSWORD: z.string(),
  LABELLER_SERVICE: z.string().url().default('https://bsky.social'),
  PUBLIC_SERVICE: z.string().url().default('https://public.api.bsky.app'),
  PLC_DIRECTORY: z.string().url().default('https://plc.directory'),
  NEON_DATABASE_URL: z.string().url(),
  NEWHANDLE_EXPIRY: z.coerce.number().default(2592000),
  DANGEROUSLY_EXPOSE_SECRETS: z
    .string()
    .toLowerCase()
    .transform((x) => x === 'true')
    .pipe(z.boolean())
    .default('false'),
})

const env = { ...envSchema.parse(process.env), limits: { ...limits } }

if (env.DANGEROUSLY_EXPOSE_SECRETS) {
  logger.level = 'debug'
  env.limits.DB_WRITE_INTERVAL_MS = 30 * 1000
  env.limits.MIN_FIREHOSE_OPS = 5
  const log: string = JSON.stringify(env, null, 2)
  for (const line of log.split('\n')) {
    logger.debug(line)
  }
}

export default env
