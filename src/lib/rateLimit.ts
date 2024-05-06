import { pRateLimit } from 'p-ratelimit'
import logger from '@/lib/logger.js'
import wait from '@/lib/wait.js'
import env from '@/lib/env.js'

const taskQueue: (() => Promise<any>)[] = []
let activeTasks = 0
const maxConcurrentTasks = env.limits.MAX_CONCURRENT_PROCESSCOMMITS
const waitingResolvers: (() => void)[] = []

async function processQueue() {
  if (activeTasks < maxConcurrentTasks && taskQueue.length > 0) {
    const task = taskQueue.shift()
    if (task) {
      activeTasks++

      task().finally(() => {
        activeTasks--
        if (waitingResolvers.length > 0) {
          const resolve = waitingResolvers.shift()
          if (resolve) {
            resolve()
          }
        }
        processQueue()
      })
    }
  }
}

export function getQueueLength() {
  return taskQueue.length + activeTasks
}

export async function forceProcess() {
  return await processQueue()
}

export async function enqueueTask(task: () => Promise<any>) {
  if (activeTasks >= maxConcurrentTasks) {
    await new Promise<void>((resolve) => {
      waitingResolvers.push(resolve)
    })
  }
  taskQueue.push(task)
  processQueue()
}

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

export const reportLimit = pRateLimit({
  interval: env.limits.REPORT_LIMIT_RATE_INTERVAL_MS,
  rate: env.limits.REPORT_LIMIT_MAX_RATE,
  concurrency: env.limits.REPORT_LIMIT_MAX_CONCURRENT,
  maxDelay: env.limits.REPORT_LIMIT_MAX_DELAY_MS,
})

export const retryLimit = async <T>(
  fn: () => Promise<T>,
  retries = env.limits.MAX_RETRIES,
): Promise<T> => {
  try {
    return await _retrylimit(fn)
  } catch (e) {
    if (retries > 0) {
      logger.debug(
        `${e.message}, retrying in ${Math.floor(
          env.limits.MAX_WAIT_RETRY_MS / 1000,
        )}s...`,
      )
      await wait(env.limits.MAX_WAIT_RETRY_MS)
      return await retryLimit(fn, retries - 1)
    } else {
      logger.debug(`failing rate limited call (max retries reached)`)
      throw e
    }
  }
}
