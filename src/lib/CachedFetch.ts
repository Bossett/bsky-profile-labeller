import wait from '@/helpers/wait.js'
import logger from '@/helpers/logger.js'

import env from '@/env/env.js'

import zlib from 'node:zlib'

type pendingResults = {
  url: string
  completedDate?: number
  data?: Buffer | undefined
  errorReason?: string
  failed: boolean
  lastUsed: number
  timesUsed?: number
}

class CachedFetch {
  protected results = new Map<string, pendingResults>()
  protected maxSize: number = 10000
  protected maxAge: number = 3000
  protected maxBatch: number = 25

  private cycleTimeout: number = env.limits.BATCH_CYCLE_TIMEOUT_MS || 3000
  private timeoutFailures: number = 0

  protected limiter:
    | ((fn: () => Promise<any>, retries?: number) => Promise<Response>)
    | undefined

  constructor({
    maxAge,
    maxSize,
    limiter,
    maxBatch,
  }: {
    maxAge?: number
    maxSize?: number
    limiter?: typeof this.limiter
    maxBatch?: number
  }) {
    this.maxAge = maxAge || 30000
    this.maxSize = maxSize || 10000
    this.limiter = limiter
    this.maxBatch = maxBatch || 25
  }

  protected compressData(data: any) {
    return zlib.deflateSync(JSON.stringify(data))
  }

  protected expandData(data: any) {
    return JSON.parse(zlib.inflateSync(data).toString())
  }

  private lock: Promise<void> | null = null
  private unlock: (() => void) | null = null

  protected async acquireLock(): Promise<boolean> {
    if (this.lock) {
      return false
    }
    this.lock = new Promise((resolve) => {
      this.unlock = resolve
    })
    return true
  }

  protected releaseLock(): void {
    if (this.unlock) {
      this.unlock()
      this.unlock = null
    }
    this.lock = null
  }

  private seededRandom(seed: number) {
    const a = 1664525
    const c = 1013904223
    const m = 2 ** 32 // 2 to the power of 32
    seed = (a * seed + c) % m
    return seed / m
  }

  private trackLimit() {
    if (this.results.size <= this.maxSize) return 0

    const targetFree = 0.33
    const targetSize = Math.floor((1 - targetFree) * this.maxSize)

    const initialSize = this.results.size

    for (const [key, result] of this.results) {
      if (this.isExpiredResult(result)) {
        this.results.delete(key)
      }
    }

    logger.debug(`cache ${initialSize} -> ${this.results.size} expire`)

    const getAdjustedDate = (result: pendingResults) => {
      // assumption is that all expired by completed date cleared ^

      const now = Date.now()

      if (!result.completedDate || this.getPromiseMap.has(result.url))
        // is pending, expire in the future
        return now + 1000

      if (result.timesUsed)
        // expire most-used items last
        return result.lastUsed + (result.timesUsed - 1) * 5 * 50 * 1000

      return result.lastUsed
    }

    if (this.results.size > targetSize) {
      const entries = Array.from(this.results.entries())
      entries.sort((a, b) => {
        const dateA = getAdjustedDate(a[1])
        const dateB = getAdjustedDate(b[1])
        return dateB - dateA
      })
      this.results = new Map(entries.slice(0, targetSize))
      entries.length = 0 // explicitly remove
    }

    logger.debug(`cache ${initialSize} -> ${this.results.size} over max`)

    return initialSize - this.results.size
  }

  private isExpiredResult(result: pendingResults) {
    if (!result) return false
    if (!result.completedDate) return false

    const expTime =
      result.completedDate +
      0.75 * this.maxAge +
      0.5 * Math.floor(this.maxAge * this.seededRandom(result.completedDate))
    // expiry between 0.75 and 1.25 of maxAge fuzzed a bit to avoid mass expiry

    return Date.now() >= expTime
  }

  protected isFailedResult(result: pendingResults) {
    if (this.isExpiredResult(result)) return false
    return result.failed
  }

  private globalCacheHit = 0
  private globalCacheMiss = 0
  private globalCacheExpired = 0

  public cacheStatistics() {
    const hitRate = () =>
      100 * (this.globalCacheHit / (this.globalCacheHit + this.globalCacheMiss))
    return {
      cacheHit: this.globalCacheHit,
      cacheMiss: this.globalCacheMiss,
      timeoutFailures: this.timeoutFailures,
      hitRate: isNaN(hitRate()) ? () => 0 : hitRate,
      items: () => this.results.size,
      recentExpired: () => this.globalCacheExpired,
      reset: () => {
        this.globalCacheHit = 0
        this.globalCacheMiss = 0
        this.globalCacheExpired = 0
        this.timeoutFailures = 0
      },
    }
  }

  public purgeCacheForKey(key: string, time?: number): boolean {
    if (!key) return false
    if (!time) time = Date.now()

    const res = this.results.get(key)
    if (!res) return false
    if (!res.completedDate) return false

    if (res.completedDate < time) {
      this.results.delete(key)
      this.globalCacheExpired++

      logger.debug(
        `cache purged for ${key} before ${new Date(time).toISOString()}`,
      )
      return true
    } else {
      return false
    }
  }

  protected lastBatchRun: number = Date.now()
  protected currentRunningQueries = new Set<string>()

  protected async executeBatch(): Promise<boolean> {
    const allUrls = Array.from(this.results)
      .filter((result) => !result[1].completedDate)
      .map((query) => query[0])

    const getUrl = async (url: string) => {
      const res = await (this.limiter
        ? this.limiter(() => fetch(url))
        : fetch(url))
      return res.json().catch((e) => {
        logger.warn(`error in cached fetch:\n${e}`)
        throw e
      })
    }

    const promArr: Promise<any>[] = []

    while (allUrls.length > 0) {
      if (this.currentRunningQueries.size <= this.maxBatch) {
        const url = allUrls.pop()
        if (!url) break

        this.currentRunningQueries.add(url)

        promArr.push(
          (async (url) => {
            await wait(Math.floor(100 * Math.random()))

            const itemToUpdate: pendingResults = {
              url: url,
              failed: false,
              data: undefined,
              completedDate: undefined,
              errorReason: undefined,
              lastUsed: Date.now(),
            }

            try {
              const data = await getUrl(url)
              itemToUpdate.failed = false
              itemToUpdate.data = this.compressData(data)
              itemToUpdate.completedDate = Date.now()
              itemToUpdate.errorReason = undefined
              itemToUpdate.lastUsed = Date.now()
            } catch (e) {
              if (e.message !== 'fetch failed') {
                itemToUpdate.failed = true
                itemToUpdate.data = undefined
                itemToUpdate.completedDate = Date.now()
                itemToUpdate.errorReason = e.message
                itemToUpdate.lastUsed = Date.now()
              }
            }

            this.results.set(url, itemToUpdate)
          })(url).finally(() => this.currentRunningQueries.delete(url)),
        )
      } else await wait(10)
    }

    await Promise.allSettled(promArr)
    promArr.length = 0

    return true
  }

  private minBatchWaitTime = env.limits.MIN_BATCH_WAIT_TIME_MS

  private async _executeBatch() {
    let res: boolean = true

    if (this.lastBatchRun > Date.now() - this.minBatchWaitTime) return res

    if (!(await this.acquireLock())) {
      return res
    }

    this.globalCacheExpired += this.trackLimit()

    try {
      res = await this.executeBatch()
      this.lastBatchRun = Date.now()
    } finally {
      this.releaseLock()
    }

    return res
  }

  private async _getJson(url: string): Promise<any | { error: string }> {
    const launchTime = Date.now()

    const result = this.results.get(url)

    if (!result || this.isExpiredResult(result)) {
      this.globalCacheMiss++
      this.results.set(url, {
        url: url,
        failed: false,
        data: undefined,
        completedDate: undefined,
        errorReason: undefined,
        lastUsed: Date.now(),
        timesUsed: 0,
      })
    } else {
      if (result.completedDate) {
        this.globalCacheHit++
        this.results.set(url, {
          url: url,
          failed: result.failed,
          data: result.data,
          completedDate: result.completedDate,
          errorReason: result.errorReason,
          lastUsed: Date.now(),
          timesUsed: result.timesUsed ? result.timesUsed + 1 : 1,
        })
        if (result.failed)
          return { error: `${result.errorReason} (from cache)` }
        else return this.expandData(result.data)
      }
    }

    while (await wait(10)) {
      if (Date.now() - launchTime > this.cycleTimeout) {
        logger.warn(`timeout for ${url}`)
        this.timeoutFailures++
        return { error: 'timeout' }
      }

      this._executeBatch()

      const result = this.results.get(url)

      if (!result) break

      if (result.completedDate) {
        if (!result.failed) return this.expandData(result.data)
        else {
          const errorReason = `${result.errorReason}${
            result.timesUsed && result.timesUsed > 0 ? ' (from cache)' : ''
          }`
          return { error: errorReason }
        }
      }
    }

    return { error: 'record expired during execution' }
  }

  private getPromiseMap = new Map<string, Promise<any>>()

  public async getJson(url: string) {
    const existingPromise = this.getPromiseMap.get(url)
    if (existingPromise) {
      return existingPromise
    } else {
      const newPromise = this._getJson(url)
        .then((result) => {
          this.getPromiseMap.delete(url)
          return result
        })
        .catch((e) => {
          this.getPromiseMap.delete(url)
        })
      this.getPromiseMap.set(url, newPromise)
      return newPromise
    }
  }
}

export default CachedFetch
