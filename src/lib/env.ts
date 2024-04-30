import { z } from 'zod'

const envSchema = z.object({
  LABELLER_HANDLE: z.string(),
  LABELLER_PASSWORD: z.string(),
  LABELLER_SERVICE: z.string().url(),
  NEON_DATABASE_URL: z.string().url(),
  NEWHANDLE_EXPIRY: z.number().default(2592000),
})

const env = envSchema.parse(process.env)
export default env
