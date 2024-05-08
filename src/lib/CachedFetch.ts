import env from '@/env/env.js'
import logger from '@/helpers/logger.js'

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
    if (this.results.size < this.maxSize * 2) return 0
    const initialSize = this.results.size
    const resultsArray = Array.from(this.results.entries()).filter(
      (item) => !item[1].failed,
    )

    const pendingResults = resultsArray.filter((item) => !item[1].completedDate)

    if (pendingResults.length < this.maxSize) {
      resultsArray.sort((a, b) => {
        const dateA = a[1].completedDate || 0
        const dateB = b[1].completedDate || 0
        return dateB - dateA
      })
    }
    const sliceAt = Math.max(this.maxSize - pendingResults.length, 0)
    const topResults = [
      ...pendingResults.slice(0, this.maxSize),
      ...resultsArray.slice(0, sliceAt),
    ]

    this.results.clear()

    for (const [key, value] of topResults) {
      if (!this.isExpiredResult(value)) this.results.set(key, value)
    }
    return initialSize - this.results.size
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

  public purgeCacheForKey(key: string, time?: number): boolean {
    if (!key) return false
    if (!time) time = Date.now()

    const res = this.results.get(key)
    if (!res) return false
    if (!res.completedDate) return false

    if ((res.completedDate ? res.completedDate : 0) < time) {
      this.results.set(key, {
        ...(this.results.get(key) as pendingResults),
        completedDate: 0,
      })

      logger.debug(
        `cache purged for ${key} before ${new Date(time).toISOString()}`,
      )
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
        this.results.set(url, {
          url: url,
          failed: false,
          data: data,
          completedDate: result.completedDate,
          errorReason: undefined,
          lastUsed: Date.now(),
        })
        return data as any
      }
    } else {
      this.globalCacheMiss++

      try {
        let res: Response
        if (this.limiter) res = await this.limiter(() => fetch(url))
        else res = await fetch(url)
        if ([400, 500, 404].includes(res.status)) {
          const errText = `${res.status}: ${res.statusText}`
          this.results.set(url, {
            url: url,
            failed: true,
            errorReason: `${errText}`,
            completedDate: Date.now(),
            lastUsed: Date.now(),
          })
          return { error: `failed to fetch (${errText})` }
        } else {
          const json = await res.json()

          this.results.set(url, {
            url: url,
            failed: false,
            data: json as any,
            completedDate: Date.now(),
            errorReason: undefined,
            lastUsed: Date.now(),
          })
          return json as any
        }
      } catch (e) {
        return { error: `failed to fetch (${e.message})` }
      }
    }

    return { error: 'unknown error' }
  }
}

export default CachedFetch
