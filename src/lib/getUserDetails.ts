import { AppBskyActorDefs } from '@atproto/api'
import { pdsLimit } from '@/lib/rateLimit.js'
import { agent } from '@/lib/bskyAgent.js'
import env from '@/lib/env.js'
import wait from '@/lib/wait.js'
import CachedFetch from '@/lib/CachedFetch.js'

import Denque from 'denque'
import logger from './logger'

class UserDetailsFetch extends CachedFetch {
  private batchExecuting = false
  private lastBatchRun = Date.now()

  private async executeBatch() {
    if (this.batchExecuting) {
      await wait(1)
      return true
    }

    this.batchExecuting = true

    const maxRequestChunk = 25
    const getProfiles = (actors: string[]) =>
      pdsLimit(() => agent.app.bsky.actor.getProfiles({ actors: actors }))

    const batchDids = Array.from(this.results.keys()).sort()

    const allActors: string[] = batchDids.filter((did) => {
      const result = this.results.get(did)
      if (!result) return false
      if (this.isFailedResult(result)) return false
      if (result.completedDate === undefined) return true
    })

    const retryExpired =
      Date.now() - this.lastBatchRun > env.limits.MAX_WAIT_RETRY_MS

    if (allActors.length < maxRequestChunk && !retryExpired) {
      this.batchExecuting = false
      await wait(1)
      return true
    }

    const sliceAt = allActors.length - (allActors.length % maxRequestChunk)

    const actors = allActors.slice(
      0,
      sliceAt > 0
        ? retryExpired
          ? allActors.length
          : sliceAt
        : allActors.length,
    )

    const foundActors = new Set<string>()

    try {
      const resPromises: Promise<any>[] = []

      for (let i = 0; i < actors.length; i += maxRequestChunk) {
        const actorsChunk = actors.slice(i, i + maxRequestChunk)
        resPromises.push(getProfiles(actorsChunk))
      }

      const profileResults = (await Promise.all(resPromises)).reduce(
        (acc, item) => ({
          data: {
            profiles: [...acc.data.profiles, ...item.data.profiles],
          },
        }),
        { data: { profiles: [] } },
      )

      const profiles = profileResults.data.profiles.reduce(
        (map, profile) => ({ ...map, [profile.did]: profile }),
        {},
      )

      for (const did of actors) {
        if (profiles[did]) {
          this.results.set(did, {
            data: profiles[did],
            completedDate: Date.now(),
            url: did,
            failed: false,
          })
          foundActors.add(did)
        }
      }
    } catch (e) {
      if (env.DANGEROUSLY_EXPOSE_SECRETS) throw e
      this.batchExecuting = false
      return
    }

    for (const did of actors) {
      if (!foundActors.has(did)) {
        this.results.set(did, {
          url: did,
          failed: true,
          errorReason: 'not found',
          completedDate: Date.now(),
        })
      }
    }

    this.lastBatchRun = Date.now()

    this.batchExecuting = false
    return true
  }

  public async getJson(
    url: string,
  ): Promise<AppBskyActorDefs.ProfileViewDetailed | { error: string }> {
    let cacheHit = true
    const did = url
    do {
      const result = this.results.get(did)

      if (result && this.isExpiredResult(result)) {
        this.results.delete(did)
        continue
      }

      if (result && this.isFailedResult(result)) {
        if (cacheHit) this.globalCacheHit++
        return {
          error:
            (`${this.results.get(did)?.errorReason}` || 'unknown') +
            `${cacheHit ? ' (cached)' : ''}`,
        }
      }

      if (result) {
        const data = result.data
        if (data?.did) {
          if (cacheHit) this.globalCacheHit++
          return data as AppBskyActorDefs.ProfileViewDetailed
        }
      } else {
        this.globalCacheMiss++
        this.results.set(did, {
          url: did,
          failed: false,
          data: undefined,
          completedDate: undefined,
          errorReason: undefined,
        })
      }

      await this.executeBatch()
    } while (await wait(1))

    return { error: 'unknown error' }
  }
}

async function getUserDetails(
  did: string,
): Promise<AppBskyActorDefs.ProfileViewDetailed | { error: string }> {
  return await userDetailsFetch.getJson(did)
}

const userDetailsFetch = new UserDetailsFetch({
  maxAge: env.limits.USER_DETAILS_MIN_AGE_MS,
  maxSize: env.limits.USER_DETAILS_MAX_SIZE,
})

export function cacheStatistics() {
  return userDetailsFetch.cacheStatistics()
}

export function purgeCacheForDid(did: string, time?: number) {
  return userDetailsFetch.purgeCacheForKey(did, time)
}

export default getUserDetails
