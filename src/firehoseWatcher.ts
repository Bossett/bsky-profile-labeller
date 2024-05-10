import FirehoseIterable from './lib/firehoseIterable/firehoseIterable.js'
import logger from '@/helpers/logger.js'
import wait from '@/helpers/wait.js'

import formatDuration from '@/helpers/formatDuration.js'

import { cacheStatistics as userDetailsCacheStats } from '@/lib/getUserDetails.js'
import { cacheStatistics as authorFeedDetailsCacheStats } from '@/lib/getAuthorFeed.js'
import { cacheStatistics as plcDirectoryCacheStats } from '@/lib/getPlcRecord.js'
import { cacheStatistics as postBatchCacheStats } from '@/lib/getPost.js'

import env from '@/env/env.js'
import db, { schema } from '@/db/db.js'
import { processCommit } from '@/lib/processCommit.js'

export default async function firehoseWatcher() {
  let seq: number =
    (
      await db.query.subscription_status.findFirst({
        columns: { last_sequence: true },
      })
    )?.last_sequence || 0

  let lag = 0
  let lastLag = 0
  let deltaLag = 0
  const interval_ms = env.limits.DB_WRITE_INTERVAL_MS
  const stalled_at = env.limits.MIN_FIREHOSE_OPS

  const firstRun = Date.now()

  let willRestartOnUnpause = false

  let itemsProcessed = 0
  let itemsSkipped = 0

  const interval = async () => {
    let cycleInterval = env.DANGEROUSLY_EXPOSE_SECRETS
      ? 30000
      : interval_ms - (Date.now() % interval_ms)
    let cycleCount = 0
    while (await wait(cycleInterval)) {
      const speed = (itemsProcessed + itemsSkipped) / (cycleInterval / 1000)

      cycleCount++
      deltaLag =
        cycleCount <= 3
          ? 0
          : (deltaLag * (cycleCount - 1) + (lag - lastLag)) / cycleCount

      let timeToRealtimeStr: string
      let isSlowingDown: boolean

      isSlowingDown = false
      timeToRealtimeStr = 'initialising'

      const skippedItems = itemsSkipped
      const totalItems = itemsProcessed + itemsSkipped

      if (deltaLag < 0) {
        const timeToRealtime = lag / (deltaLag / cycleInterval)
        if (lastLag !== 0) {
          timeToRealtimeStr = `${formatDuration(timeToRealtime)} to catch up`
        }
        isSlowingDown = false
      } else {
        if (cycleCount > 3) {
          timeToRealtimeStr = `not catching up`
          isSlowingDown = true
        }
      }

      if (lag < 60000) {
        isSlowingDown = false
        timeToRealtimeStr = `real time`
      }

      lastLag = lag

      const detailsCacheStats = userDetailsCacheStats()
      const authorFeedCacheStats = authorFeedDetailsCacheStats()
      const plcCacheStats = plcDirectoryCacheStats()
      const postCacheStats = postBatchCacheStats()

      const logLines = [
        `${speed.toFixed(2)} ops/s, at seq: ${seq}`,
        `${timeToRealtimeStr} with lag ${formatDuration(
          lag,
        )} (running ${formatDuration(Date.now() - firstRun)})`,
        `${totalItems} items: ${itemsProcessed} processed, ${skippedItems} skipped `,
        `details cache: ${detailsCacheStats.items()} items ${detailsCacheStats
          .hitRate()
          .toFixed(2)}% hit (${detailsCacheStats.recentExpired()} expired)`,
        `author feed cache: ${authorFeedCacheStats.items()} items ${authorFeedCacheStats
          .hitRate()
          .toFixed(2)}% hit (${authorFeedCacheStats.recentExpired()} expired)`,
        `plc directory cache: ${plcCacheStats.items()} items ${plcCacheStats
          .hitRate()
          .toFixed(2)}% hit (${plcCacheStats.recentExpired()} expired)`,
        `post cache: ${postCacheStats.items()} items ${postCacheStats
          .hitRate()
          .toFixed(2)}% hit (${postCacheStats.recentExpired()} expired)`,
      ]

      for (const line of logLines) {
        logger.info(line)
      }

      detailsCacheStats.reset()
      authorFeedCacheStats.reset()
      plcCacheStats.reset()
      postCacheStats.reset()

      await db
        .insert(schema.subscription_status)
        .values({
          id: 1,
          last_sequence: seq,
        })
        .onConflictDoUpdate({
          target: schema.subscription_status.id,
          set: {
            last_sequence: seq,
          },
        })

      if (speed < stalled_at && isSlowingDown) {
        logger.error(`firehose stalled at ${speed} ops/s`)

        willRestartOnUnpause = true
        isSlowingDown = false
      }

      itemsSkipped = 0
      itemsProcessed = 0

      cycleInterval = env.DANGEROUSLY_EXPOSE_SECRETS
        ? 30000
        : interval_ms - (Date.now() % interval_ms)
    }
  }

  interval()

  do {
    willRestartOnUnpause = false

    try {
      const firehose = await new FirehoseIterable().create({
        seq: seq,
        timeout: env.limits.MAX_FIREHOSE_DELAY,
        maxPending: 5000,
      })

      for await (const commit of firehose) {
        if (!Number.isSafeInteger(commit.meta['seq'])) continue

        const commitTime = new Date(commit.meta['time']).getTime()
        lag =
          lag !== 0
            ? (lag + (Date.now() - commitTime)) / 2
            : Date.now() - commitTime

        if (willRestartOnUnpause) {
          throw new Error('FirehoseNotCatchingUp')
        }

        if (await processCommit(commit)) itemsProcessed++
        else itemsSkipped++

        seq = commit.meta['seq']
      }
    } catch (e) {
      logger.warn(`${e} in firehoseWatcher`)
      throw e
    }
  } while (await wait(10000))
}
