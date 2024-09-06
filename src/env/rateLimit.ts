import { pRateLimit } from 'p-ratelimit'
import env from '@/env/env.js'

export const plcLimit = pRateLimit({
  interval: env.limits.PLC_LIMIT_RATE_INTERVAL_MS,
  rate: env.limits.PLC_LIMIT_MAX_RATE,
  concurrency: env.limits.PLC_LIMIT_MAX_CONCURRENT,
  maxDelay: env.limits.PLC_LIMIT_MAX_DELAY_MS,
})

export const pdsLimit = pRateLimit({
  interval: env.limits.PDS_LIMIT_RATE_INTERVAL_MS,
  rate: env.limits.PDS_LIMIT_MAX_RATE,
  concurrency: env.limits.PDS_LIMIT_MAX_CONCURRENT,
  maxDelay: env.limits.PDS_LIMIT_MAX_DELAY_MS,
})

export const deleteLimit = pRateLimit({
  interval: env.limits.DELETE_LIMIT_RATE_INTERVAL_MS,
  rate: env.limits.DELETE_LIMIT_MAX_RATE,
  concurrency: env.limits.DELETE_LIMIT_MAX_CONCURRENT,
  maxDelay: env.limits.DELETE_LIMIT_MAX_DELAY_MS,
})

export const publicLimit = pRateLimit({
  interval: env.limits.PUBLIC_LIMIT_RATE_INTERVAL_MS,
  rate: env.limits.PUBLIC_LIMIT_MAX_RATE,
  concurrency: env.limits.PUBLIC_LIMIT_MAX_CONCURRENT,
  maxDelay: env.limits.PUBLIC_LIMIT_MAX_DELAY_MS,
})
