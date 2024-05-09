import wait from '@/helpers/wait.js'
import logger from '@/helpers/logger.js'

import env from '@/env/env.js'

import Denque from 'denque'

type pendingResults = {
  url: string
  completedDate?: number
  data?: any
  errorReason?: string
  failed: boolean
  lastUsed: number
}

class CachedFetch {
  protected results = new Map<string, pendingResults>()
  protected maxSize: number = 10000
  protected maxAge: number = 3000
  protected maxBatch: number = 25

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
    if (this.results.size < this.maxSize * 2) return 0

    const initialSize = this.results.size
    const resultsArray = Array.from(this.results.entries()).filter((item) => {
      if (item[1].failed) return false
      if (this.isExpiredResult(item[1])) return false
      return true
    })

    const pendingResults = resultsArray.filter((item) => !item[1].completedDate)

    if (pendingResults.length < this.maxSize) {
      resultsArray.sort((a, b) => {
        const dateA = a[1].lastUsed
        const dateB = b[1].lastUsed
        return dateB - dateA
      })
    }
    const sliceAt = Math.max(this.maxSize - pendingResults.length, 0)
    const topResults = [
      ...pendingResults.slice(0, this.maxSize),
      ...resultsArray.slice(0, sliceAt),
    ]

    this.results = new Map(topResults)

    logger.debug(`final size ${this.results.size}`)

    return initialSize - this.results.size
  }

  protected isExpiredResult(result: pendingResults) {
    if (result.completedDate === undefined) return false

    if (
      result.completedDate <
      Date.now() -
        (this.maxAge +
          Math.floor(this.maxAge * this.seededRandom(result.completedDate)))
    ) {
      return true
    } else return false
  }

  protected isFailedResult(result: pendingResults) {
    if (this.isExpiredResult(result)) return false
    return result.failed
  }

  protected globalCacheHit = 0
  protected globalCacheMiss = 0
  protected globalCacheExpired = 0

  public cacheStatistics() {
    const hitRate = () =>
      100 * (this.globalCacheHit / (this.globalCacheHit + this.globalCacheMiss))
    return {
      cacheHit: this.globalCacheHit,
      cacheMiss: this.globalCacheMiss,
      hitRate: isNaN(hitRate()) ? () => 0 : hitRate,
      items: () => this.results.size,
      recentExpired: () => this.globalCacheExpired,
      reset: () => {
        this.globalCacheHit = 0
        this.globalCacheMiss = 0
        this.globalCacheExpired = 0
        this.scavengeExpired()
      },
    }
  }

  public scavengeExpired() {
    this.globalCacheExpired += this.trackLimit()
    if (this.globalCacheExpired > 0) return

    for (const [url, result] of this.results) {
      if (this.isExpiredResult(result)) {
        this.results.delete(url)
        this.globalCacheExpired++
      }
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

  protected batchExecuting: boolean = false
  protected lastBatchRun: number = Date.now()
  protected currentRunningQueries = new Set<string>()

  protected async executeBatch(): Promise<boolean> {
    const batchQueries = Array.from(this.results.keys())

    const allQueries = batchQueries.filter((url) => {
      const result = this.results.get(url)
      if (!result) return false
      if (result.completedDate === undefined) return true
      return false
    })

    const batchQueue = new Denque<string>()

    const getUrl = async (url: string) => {
      return (
        await (this.limiter ? this.limiter(() => fetch(url)) : fetch(url))
      ).json()
    }

    for (const query of allQueries) {
      batchQueue.push(query)
    }

    while (!batchQueue.isEmpty()) {
      const query = batchQueue.shift()

      if (query) {
        if (!this.currentRunningQueries.has(query)) {
          this.currentRunningQueries.add(query)

          getUrl(query)
            .then((data) => {
              this.results.set(query, {
                url: query,
                failed: false,
                data: data,
                completedDate: Date.now(),
                errorReason: undefined,
                lastUsed: Date.now(),
              })
              this.currentRunningQueries.delete(query)
            })
            .catch((e) => {
              this.results.set(query, {
                url: query,
                failed: true,
                data: undefined,
                completedDate: Date.now(),
                errorReason: e.message,
                lastUsed: Date.now(),
              })
              this.currentRunningQueries.delete(query)
            })
            .finally(() => {
              this.currentRunningQueries.delete(query)
            })
        }
      } else break
      while (this.currentRunningQueries.size >= this.maxBatch) {
        await wait(10)
      }
    }

    while (this.currentRunningQueries.size > 0) {
      await wait(10)
    }

    this.lastBatchRun = Date.now()

    return true
  }

  private async _executeBatch() {
    let res: boolean = true
    if (!(await this.acquireLock())) {
      await wait(10)
      return res
    }
    try {
      res = await this.executeBatch()
    } finally {
      this.releaseLock()
    }
    return res
  }

  public async getJson(url: string): Promise<any | { error: string }> {
    let cacheHit = true

    let timeoutExceed = false
    let cycleCount = 0

    do {
      if (cycleCount > 300) timeoutExceed = true
      cycleCount++

      if (!this.results.has(url)) {
        cacheHit = false
        this.globalCacheMiss++
        this.results.set(url, {
          url: url,
          failed: false,
          data: undefined,
          completedDate: undefined,
          errorReason: undefined,
          lastUsed: Date.now(),
        })
        continue
      }

      const result = this.results.get(url)
      if (!result) continue

      if (this.isExpiredResult(result)) {
        this.purgeCacheForKey(url)
        this.results.set(url, {
          url: url,
          failed: false,
          data: undefined,
          completedDate: undefined,
          errorReason: undefined,
          lastUsed: Date.now(),
        })
        continue
      }

      if (this.isFailedResult(result)) {
        if (cacheHit) this.globalCacheHit++

        return {
          error:
            (`${result.errorReason}` || 'unknown') +
            `${cacheHit ? ' (cached)' : ''}`,
        }
      }

      if (result) {
        const data = result.data
        if (data) {
          this.results.set(url, {
            url: url,
            failed: false,
            data: data,
            completedDate: result.completedDate,
            errorReason: undefined,
            lastUsed: Date.now(),
          })
          if (cacheHit) this.globalCacheHit++

          return data as any
        } else {
          this.results.set(url, {
            url: url,
            failed: result.failed,
            data: result.data,
            completedDate: result.completedDate,
            errorReason: result.errorReason,
            lastUsed: Date.now(),
          })
        }
      }
    } while (
      (await this._executeBatch()) &&
      !timeoutExceed &&
      this.results.has(url)
    )

    if (timeoutExceed) logger.debug(`timeout for ${url}`)
    return { error: 'timeout' }
  }
}

export default CachedFetch
