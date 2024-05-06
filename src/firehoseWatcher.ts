import FirehoseIterable from './lib/firehoseIterable.js'
import logger from '@/lib/logger.js'
import wait from '@/lib/wait.js'
import { enqueueTask, getQueueLength, forceProcess } from '@/lib/rateLimit.js'
import formatDuration from '@/lib/formatDuration.js'

import { cacheStatistics } from '@/lib/getUserDetails.js'

import env from '@/lib/env.js'
import db, { schema } from '@/db/db.js'
import { processCommit } from '@/lib/processCommit.js'

export default async function firehoseWatcher() {
  let seq: number =
    (
      await db.query.subscription_status.findFirst({
        columns: { last_sequence: true },
      })
    )?.last_sequence || 0

  let old_seq: number = seq

  let lag = 0
  let lastLag = 0
  const interval_ms = env.limits.DB_WRITE_INTERVAL_MS
  const stalled_at = env.limits.MIN_FIREHOSE_OPS

  let wantsPause = false
  let hasPaused = false

  const firstRun = Date.now()

  let willRestartOnUnpause = false

  let itemsProcessed = 0

  const interval = async () => {
    await wait(15000)
    do {
      wantsPause = true
      while (hasPaused === false) {
        await wait(1000)
      }

      const deltaLag = lastLag - lag
      let timeToRealtimeStr: string
      let isSlowingDown: boolean

      isSlowingDown = false
      timeToRealtimeStr = 'initialising'

      const speed = itemsProcessed / (interval_ms / 1000)
      itemsProcessed = 0

      if (deltaLag > 0) {
        const timeToRealtime = lag / (deltaLag / interval_ms)
        if (timeToRealtime > interval_ms && lastLag !== 0) {
          timeToRealtimeStr = `${formatDuration(timeToRealtime)} to catch up`
        }
        isSlowingDown = false
      } else if (lastLag !== 0) {
        timeToRealtimeStr = `not catching up`
        isSlowingDown = true
      }

      if (lag < 60000) {
        isSlowingDown = false
        timeToRealtimeStr = `real time`
      }

      lastLag = lag

      const cacheStats = cacheStatistics()

      const logLines = [
        `at seq: ${seq} with lag ${formatDuration(lag)}`,
        `${timeToRealtimeStr} at ${speed.toFixed(
          2,
        )}ops/s, running ${formatDuration(Date.now() - firstRun)}`,
        `details cache: ${cacheStats.items()} items ${cacheStats
          .hitRate()
          .toFixed(2)}% hit (${cacheStats.recentExpired()} expired)`,
      ]

      for (const line of logLines) {
        logger.info(line)
      }

      cacheStats.reset()

      old_seq = seq
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
      if (global.gc) {
        logger.debug(`running gc...`)
        global.gc()
      }
      logger.debug(`unpaused, resuming...`)

      if (speed < stalled_at && isSlowingDown) {
        logger.error(`firehose stalled at ${speed} ops/s`)
        willRestartOnUnpause = true
      }

      wantsPause = false
    } while (await wait(interval_ms))
  }

  interval()

  do {
    willRestartOnUnpause = false

    try {
      const firehose = await new FirehoseIterable().create({
        seq: seq,
        timeout: env.limits.MAX_FIREHOSE_DELAY,
      })

      for await (const commit of firehose) {
        if (Number.isSafeInteger(commit.meta['seq'])) {
          seq = commit.meta['seq']
          lag = Date.now() - new Date(commit.meta['time']).getTime()
        }

        if (wantsPause && !hasPaused) {
          let waitCycles = 0
          while (await wait(1000)) {
            if (getQueueLength() === 0) {
              hasPaused = true
              logger.debug(`paused waiting for sequence update`)
              break
            } else {
              const alertEvery = Math.floor(
                env.limits.PAUSE_TIMEOUT_MS / 1000 / 5,
              )
              const alertThreshold = Math.floor(
                (env.limits.PAUSE_TIMEOUT_MS / 1000) * 0.7,
              )
              if (
                waitCycles++ % alertEvery === 0 &&
                waitCycles < alertThreshold
              ) {
                logger.debug(
                  `pausing, waiting for ${getQueueLength()} ops to finish...`,
                )
                forceProcess()
              }
              if (
                waitCycles++ % alertEvery === 0 &&
                waitCycles >= alertThreshold
              ) {
                logger.warn(
                  `waiting too long for ${getQueueLength()} ops to finish`,
                )
              }
              if (waitCycles > env.limits.PAUSE_TIMEOUT_MS / 1000) {
                logger.error(
                  `too many retry cycles waiting for ` +
                    `${getQueueLength()} ops to finish`,
                )
                throw new Error('TooManyPendingOps')
              }
            }
          }
          waitCycles = 0
        }
        while (hasPaused && wantsPause) {
          await wait(1000)
        }

        if (willRestartOnUnpause) break

        hasPaused = false

        await enqueueTask(async () => {
          await processCommit(commit)
          itemsProcessed++
        })
      }
    } catch (e) {
      logger.warn(`${e} in firehoseWatcher`)
      if (env.DANGEROUSLY_EXPOSE_SECRETS) throw e
    }
  } while (await wait(10000))
}
