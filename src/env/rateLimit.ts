import { pRateLimit } from 'p-ratelimit'
import logger from '@/helpers/logger.js'
import wait from '@/helpers/wait.js'
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

const _retrylimit = pRateLimit({
  interval: env.limits.PUBLIC_LIMIT_RATE_INTERVAL_MS,
  rate: env.limits.PUBLIC_LIMIT_MAX_RATE,
  concurrency: env.limits.PUBLIC_LIMIT_MAX_CONCURRENT,
  maxDelay: env.limits.PUBLIC_LIMIT_MAX_DELAY_MS,
})

export const authLimit = pRateLimit({
  interval: env.limits.AUTH_LIMIT_RATE_INTERVAL_MS,
  rate: env.limits.AUTH_LIMIT_MAX_RATE,
  concurrency: env.limits.AUTH_LIMIT_MAX_CONCURRENT,
  maxDelay: env.limits.AUTH_LIMIT_MAX_DELAY_MS,
})

export const retryLimit = async <T>(
  fn: () => Promise<T>,
  retries = env.limits.MAX_RETRIES,
): Promise<T> => {
  try {
    return await _retrylimit(fn)
  } catch (e) {
    if (retries > 0) {
      if (e.message === 'queue maxDelay timeout exceeded') throw e
      await wait(env.limits.MAX_WAIT_RETRY_MS)
      return await retryLimit(fn, retries - 1)
    } else {
      logger.debug(`fetch failed (max retries reached)`)
      throw e
    }
  }
}
