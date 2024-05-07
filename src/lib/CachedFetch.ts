import env from '@/lib/env.js'
import logger from '@/lib/logger.js'

type pendingResults = {
  url: string
  completedDate?: number
  data?: any
  errorReason?: string
  failed: boolean
}

class CachedFetch {
  protected results = new Map<string, pendingResults>()
  protected maxSize: number = 10000
  protected maxAge: number = 3000
  protected limiter:
    | ((fn: () => Promise<any>, retries?: number) => Promise<Response>)
    | undefined

  constructor({
    maxAge,
    maxSize,
    limiter,
  }: {
    maxAge?: number
    maxSize?: number
    limiter?: typeof this.limiter
  }) {
    this.maxAge = maxAge || 3000
    this.maxSize = maxSize || 10000
    this.limiter = limiter
  }

  private seededRandom(seed: number) {
    const a = 1664525
    const c = 1013904223
    const m = 2 ** 32 // 2 to the power of 32
    seed = (a * seed + c) % m
    return seed / m
  }

  private trackLimit() {
    if (this.results.size > this.maxSize * 2) {
      const initialSize = this.results.size
      const resultsArray = Array.from(this.results.entries())

      resultsArray.sort((a, b) => {
        const dateA = a[1].completedDate || 0
        const dateB = b[1].completedDate || 0
        return dateB - dateA
      })

      const topResults = resultsArray.slice(0, env.limits.USER_DETAILS_MAX_SIZE)

      this.results.clear()

      for (const [key, value] of topResults) {
        if (!this.isExpiredResult(value)) this.results.set(key, value)
      }
      return initialSize - this.results.size
    }
    return 0
  }

  protected isExpiredResult(result: pendingResults) {
    if (result.completedDate === undefined) return false

    if (
      result.completedDate <
      Date.now() -
        (this.maxAge + Math.floor(this.seededRandom(result.completedDate)))
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
  protected lastScavengeCount = 0

  public cacheStatistics() {
    const hitRate = () =>
      100 * (this.globalCacheHit / (this.globalCacheHit + this.globalCacheMiss))
    return {
      cacheHit: this.globalCacheHit,
      cacheMiss: this.globalCacheMiss,
      hitRate: isNaN(hitRate()) ? () => 0 : hitRate,
      items: () => this.results.size,
      recentExpired: () => this.lastScavengeCount,
      reset: () => {
        this.globalCacheHit = 0
        this.globalCacheMiss = 0
        this.scavengeExpired()
      },
    }
  }

  public scavengeExpired() {
    this.lastScavengeCount = this.trackLimit()

    for (const [url, result] of this.results) {
      if (this.isExpiredResult(result)) {
        this.results.delete(url)
        this.lastScavengeCount++
      }
    }
  }

  public purgeCacheForKey(key: string, time?: number) {
    if (!key) return
    if (!time) time = Date.now()

    const res = this.results.get(key)
    if (!res) return

    if ((res.completedDate ? res.completedDate : 0) < time) {
      this.results.set(key, {
        ...(this.results.get(key) as pendingResults),
        completedDate: 0,
      })
      logger.debug(`cache purged for ${key}`)
      return true
    } else {
      return false
    }
  }

  public async getJson(url: string): Promise<any | { error: string }> {
    let cacheHit = true

    let result = this.results.get(url)

    if (result && this.isExpiredResult(result)) {
      this.results.delete(url)
      result = undefined
    }

    if (result && this.isFailedResult(result)) {
      if (cacheHit) this.globalCacheHit++
      return {
        error:
          (`${this.results.get(url)?.errorReason}` || 'unknown') +
          `${cacheHit ? ' (cached)' : ''}`,
      }
    }

    if (result) {
      const data = result.data
      if (data) {
        if (cacheHit) this.globalCacheHit++
        return data as any
      }
    } else {
      this.globalCacheMiss++

      try {
        let res: Response
        if (this.limiter) res = await this.limiter(() => fetch(url))
        else res = await fetch(url)
        const json = await res.json()

        this.results.set(url, {
          url: url,
          failed: false,
          data: json as any,
          completedDate: Date.now(),
          errorReason: undefined,
        })
        return json as any
      } catch (e) {
        if (env.DANGEROUSLY_EXPOSE_SECRETS) throw e
        return { error: `failed to fetch (${e.message})` }
      }
    }

    return { error: 'unknown error' }
  }
}

export default CachedFetch
