import { AppBskyActorDefs } from '@atproto/api'
import { publicLimit } from '@/env/rateLimit.js'
import { agentDid } from '@/lib/bskyAgent.js'
import env from '@/env/env.js'
import wait from '@/helpers/wait.js'
import CachedFetch from '@/lib/CachedFetch.js'

class UserDetailsFetch extends CachedFetch {
  protected async executeBatch() {
    const maxRequestChunk = this.maxBatch

    const getProfiles = (actors: string[]) => {
      const actorsQueryString = actors.join('&actors=')
      return publicLimit(async () => {
        try {
          const res = await fetch(
            `${env.PUBLIC_SERVICE}/xrpc/app.bsky.actor.getProfiles?actors=` +
              actorsQueryString,
            {
              headers: {
                'atproto-accept-labelers': agentDid,
              },
            },
          )
          return await res.json()
        } catch (e) {
          return { profiles: [] }
        }
      }) as Promise<{ profiles: [AppBskyActorDefs.ProfileViewDetailed] }>
    }

    const batchDids = Array.from(this.results.keys()).sort()

    const actors: string[] = batchDids.filter((did) => {
      const result = this.results.get(did)
      if (!result) return false
      if (this.isFailedResult(result)) return false
      if (result.completedDate === undefined) return true
    })

    const foundActors = new Set<string>()

    try {
      const resPromises: Promise<any>[] = []

      for (let i = 0; i < actors.length; i += maxRequestChunk) {
        const actorsChunk = actors.slice(i, i + maxRequestChunk)
        resPromises.push(
          getProfiles(actorsChunk)
            .then((profiles) => {
              const profilesMap = profiles.profiles.reduce(
                (map, profile) => ({ ...map, [profile.did]: profile }),
                {},
              )
              for (const did of actorsChunk) {
                if (profilesMap[did]) {
                  this.results.set(did, {
                    data: this.compressData(profilesMap[did]),
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
                this.results.set(did, {
                  data: undefined,
                  completedDate: undefined,
                  url: did,
                  failed: false,
                  lastUsed: Date.now(),
                })
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
