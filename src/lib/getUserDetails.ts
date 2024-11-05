import { AppBskyActorDefs, ComAtprotoLabelDefs } from '@atproto/api'
import { publicLimit } from '@/env/rateLimit.js'
import { agentDid } from '@/lib/bskyAgent.js'
import env from '@/env/env.js'
import CachedFetch from '@/lib/CachedFetch.js'
import logger from '@/helpers/logger.js'

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

      const processProfiles = async (actorsChunk: string[]) => {
        try {
          const profiles = await getProfiles(actorsChunk)
          const profilesMap = profiles.profiles.reduce(
            (map, profile) => ({ ...map, [profile.did]: profile }),
            {},
          )

          const gettingLabelsFromOzone = env.GET_LABELS_FROM_OZONE

          let labelsMap: { [key: string]: ComAtprotoLabelDefs.Label[] } = {}

          if (gettingLabelsFromOzone) {
            const labelsFetch = await fetch(
              `${
                env.OZONE_URL
              }/xrpc/com.atproto.label.queryLabels?uriPatterns=${actorsChunk.join(
                '&uriPatterns=',
              )}`,
            )

            const labelsJson: { labels: ComAtprotoLabelDefs.Label[] } =
              (await labelsFetch.json()) as {
                labels: ComAtprotoLabelDefs.Label[]
              }

            labelsMap = labelsJson.labels.reduce((map, label) => {
              if (!map[label.uri]) {
                map[label.uri] = []
              }
              if (!label.neg) map[label.uri].push(label)
              return map
            }, {})
          }

          for (const did of actorsChunk) {
            if (profilesMap[did]) {
              if (
                gettingLabelsFromOzone &&
                labelsMap[did] &&
                Array.isArray(labelsMap[did]) &&
                labelsMap[did].length > 0
              ) {
                if (Array.isArray(profilesMap[did].labels)) {
                }

                profilesMap[did].labels = labelsMap[did]
                logger.debug(
                  `${did} from ozone ${JSON.stringify(labelsMap[did])}`,
                )
              }

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
        } catch (e) {
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
        }
      }

      for (let i = 0; i < actors.length; i += maxRequestChunk) {
        const actorsChunk = actors.slice(i, i + maxRequestChunk)

        // Push the promise returned by processProfiles to resPromises
        resPromises.push(processProfiles(actorsChunk))
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
