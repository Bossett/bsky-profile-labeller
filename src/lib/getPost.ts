import { AppBskyFeedDefs } from '@atproto/api'
import { publicLimit } from '@/env/rateLimit.js'
import env from '@/env/env.js'
import wait from '@/helpers/wait.js'
import CachedFetch from '@/lib/CachedFetch.js'

class PostFetch extends CachedFetch {
  protected async executeBatch() {
    const maxRequestChunk = 100

    const getPosts = (posts: string[]) => {
      const postQueryString = 'uris=' + posts.join('&uris=')
      return publicLimit(async () => {
        try {
          const res = await fetch(
            `${env.PUBLIC_SERVICE}/xrpc/app.bsky.feed.getPosts?` +
              postQueryString,
          )
          return await res.json()
        } catch (e) {
          return { posts: [] }
        }
      })
    }

    const batchDids = Array.from(this.results.keys()).sort()

    const allPosts: string[] = batchDids.filter((url) => {
      const result = this.results.get(url)
      if (!result) return false
      if (this.isFailedResult(result)) return false
      if (result.completedDate === undefined) return true
    })

    const retryExpired =
      Date.now() - this.lastBatchRun > env.limits.MAX_BATCH_WAIT_TIME_MS

    if (allPosts.length < maxRequestChunk && !retryExpired) {
      return true
    }

    const sliceAt = allPosts.length - (allPosts.length % maxRequestChunk)

    const postURLs = allPosts.slice(
      0,
      sliceAt > 0
        ? retryExpired
          ? allPosts.length
          : sliceAt
        : allPosts.length,
    )

    const foundPosts = new Set<string>()

    try {
      for (let i = 0; i < postURLs.length; i += maxRequestChunk) {
        const resPromises: Promise<any>[] = []
        const postsChunk = postURLs.slice(i, i + maxRequestChunk)
        resPromises.push(
          getPosts(postsChunk)
            .then((posts: { data: { posts: AppBskyFeedDefs.PostView[] } }) => {
              const postsMap = posts.data.posts.reduce(
                (map, post) => ({ ...map, [post.uri]: post }),
                {},
              )
              for (const url of postsChunk) {
                if (postsMap[url]) {
                  this.results.set(url, {
                    data: postsMap[url],
                    completedDate: Date.now(),
                    url: url,
                    failed: false,
                    lastUsed: Date.now(),
                  })
                  foundPosts.add(url)
                }
              }
            })
            .catch((e) => {
              for (const url of postsChunk) {
                const idxToRemove = postURLs.indexOf(url)
                postURLs.splice(idxToRemove, 1)
              }
            }),
        )
        await Promise.allSettled(resPromises)
      }
    } catch (e) {
      return true
    }

    for (const url of postURLs) {
      if (!foundPosts.has(url)) {
        this.results.set(url, {
          url: url,
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

const postFetch = new PostFetch({
  maxAge: env.limits.POST_CACHE_MAX_SIZE,
  maxSize: env.limits.POST_CACHE_MAX_AGE_MS,
})

async function getPost(
  did: string,
): Promise<AppBskyFeedDefs.PostView | { error: string }> {
  return await postFetch.getJson(did)
}

export function cacheStatistics() {
  return postFetch.cacheStatistics()
}

export function purgeCacheForPost(atUrl: string, time?: number) {
  return postFetch.purgeCacheForKey(atUrl, time)
}

export default getPost
