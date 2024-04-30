import { z } from 'zod'
import logger from '@/lib/logger.js'

const envSchema = z.object({
  LABELLER_HANDLE: z.string(),
  LABELLER_PASSWORD: z.string(),
  LABELLER_SERVICE: z.string().url(),
  NEON_DATABASE_URL: z.string().url(),
  NEWHANDLE_EXPIRY: z.coerce.number().default(2592000),
  DANGEROUSLY_EXPOSE_SECRETS: z
    .string()
    .toLowerCase()
    .transform((x) => x === 'true')
    .pipe(z.boolean())
    .default('false'),
})

const env = envSchema.parse(process.env)

if (env.DANGEROUSLY_EXPOSE_SECRETS) {
  logger.level = 'debug'
  for (const key of Object.keys(env)) {
    logger.debug(`${key}: ${env[key]}`)
  }
}

export default env
