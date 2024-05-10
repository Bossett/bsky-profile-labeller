import { AppBskyActorDefs } from '@atproto/api'
import { pdsLimit } from '@/env/rateLimit.js'
import { agent } from '@/lib/bskyAgent.js'
import env from '@/env/env.js'
import wait from '@/helpers/wait.js'
import CachedFetch from '@/lib/CachedFetch.js'

class UserDetailsFetch extends CachedFetch {
  protected async executeBatch() {
    const maxRequestChunk = this.maxBatch
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
      Date.now() - this.lastBatchRun > env.limits.MAX_BATCH_WAIT_TIME_MS

    if (allActors.length < maxRequestChunk && !retryExpired) {
      await wait(10)
      return true
    }

    const sliceAt = retryExpired
      ? allActors.length
      : Math.max(0, allActors.length - (allActors.length % maxRequestChunk))

    const actors = allActors.slice(0, sliceAt)

    const foundActors = new Set<string>()

    try {
      const resPromises: Promise<any>[] = []

      for (let i = 0; i < actors.length; i += maxRequestChunk) {
        const actorsChunk = actors.slice(i, i + maxRequestChunk)
        resPromises.push(
          getProfiles(actorsChunk)
            .then((profiles) => {
              const profilesMap = profiles.data.profiles.reduce(
                (map, profile) => ({ ...map, [profile.did]: profile }),
                {},
              )
              for (const did of actorsChunk) {
                if (profilesMap[did]) {
                  this.results.set(did, {
                    data: profilesMap[did],
                    completedDate: Date.now(),
                    url: did,
                    failed: false,
                    lastUsed: Date.now(),
                  })
                  foundActors.add(did)
                }
              }
            })
            .catch((e) => {
              for (const did of actorsChunk) {
                const idxToRemove = actors.indexOf(did)
                actors.splice(idxToRemove, 1)
              }
            }),
        )
      }

      await Promise.allSettled(resPromises)
    } catch (e) {
      return true
    }

    for (const did of actors) {
      if (!foundActors.has(did)) {
        this.results.set(did, {
          url: did,
          failed: true,
          errorReason: 'not found',
          completedDate: Date.now(),
          lastUsed: Date.now(),
        })
      }
    }

    this.lastBatchRun = Date.now()

    return true
  }
}

const userDetailsFetch = new UserDetailsFetch({
  maxAge: env.limits.USER_DETAILS_MAX_AGE_MS,
  maxSize: env.limits.USER_DETAILS_MAX_SIZE,
  maxBatch: 25,
})

async function getUserDetails(
  did: string,
): Promise<AppBskyActorDefs.ProfileViewDetailed | { error: string }> {
  return userDetailsFetch.getJson(did)
}

export function cacheStatistics() {
  return userDetailsFetch.cacheStatistics()
}

export function purgeCacheForDid(did: string, time?: number) {
  return userDetailsFetch.purgeCacheForKey(did, time)
}

export default getUserDetails
