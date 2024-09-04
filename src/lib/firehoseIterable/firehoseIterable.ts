import logger from '@/helpers/logger.js'
import wait from '@/helpers/wait.js'

import Denque from 'denque'

import { Commit } from '@atproto/api/dist/client/types/com/atproto/sync/subscribeRepos.js'
import { Subscription } from '@atproto/xrpc-server'

import { parseCBORandCar } from '@/lib/firehoseIterable/parseCBORandCar.js'
import { record } from 'zod'

export default class FirehoseIterable {
  private commitQueue: Denque<Commit> = new Denque()
  private lastCommitTime = 0
  private service: string
  private timeout: number
  private seq: number
  private maxPending: number
  private ignoreTypes: Set<string>

  async create({
    service,
    seq,
    timeout,
    maxPending,
    ignoreTypes,
  }: {
    service?: string
    seq?: number
    timeout?: number
    maxPending?: number
    ignoreTypes?: string[]
  } = {}) {
    this.service = service || 'ws://bsky.network'
    this.timeout = timeout || 10000
    this.maxPending = maxPending || 10000
    this.ignoreTypes = new Set(ignoreTypes || [])

    if (seq && Number.isSafeInteger(seq)) this.seq = seq
    else this.seq = 0

    logger.info(`firehose starting from seq: ${this.seq}`)

    const sub = new Subscription({
      service: this.service,
      method: `com.atproto.sync.subscribeRepos`,

      getParams: () => ({
        cursor: this.seq !== -1 ? this.seq : undefined,
      }),
      validate: (body: any) => body,
    })

    this.readFirehose(sub)

    return this
  }

  async readFirehose(sub: Subscription) {
    for await (const frame of sub) {
      const commit = frame as Commit
      if (Array.isArray(commit.ops) && commit.ops.length > 0) {
        const [collection] = commit.ops[0].path.split('/')

        if (!this.ignoreTypes.has(collection)) {
          this.commitQueue.push(commit)
        }
      }

      // prevent memory leak by keeping queue to ~5000
      // need to adjust to the best values to *just* keep the ws alive

      //const [maxWait, maxQueue, scaleFromPer] = [
      //  this.timeout - 1000,
      //  this.maxPending,
      //  0.5,
      //]
      //const scaleFrom = maxQueue * scaleFromPer
      //const waitTime = Math.floor(
      //  Math.min(
      //    Math.max(this.commitQueue.length - scaleFrom, 0) *
      //      (maxWait / (maxQueue - scaleFrom)),
      //    maxWait,
      //  ),
      //)
      //if (waitTime > 100) await wait(waitTime)
      //
      //while (waitTime >= maxWait && this.commitQueue.length >= maxQueue) {
      //  await wait(10)
      //}
    }
  }

  async *[Symbol.asyncIterator]() {
    const timeout = this.timeout
    const delay = Math.max(Math.floor(timeout / 10), 100)
    let shouldWait = true // wait on startup

    do {
      while (!this.commitQueue.isEmpty()) {
        const commit: Commit | undefined = this.commitQueue.shift()
        if (commit === undefined) continue

        const now = Date.now()

        if (!shouldWait && now - this.lastCommitTime > timeout) {
          logger.error(`no events received for ${Math.floor(timeout / 1000)}s`)
          throw new Error('TimeoutWaitingForFirehose')
        }

        this.lastCommitTime = now
        const parsedCommits = await parseCBORandCar(commit)

        for (const parsedCommit of parsedCommits) {
          if (parsedCommit?.meta?.name === 'OutdatedCursor') {
            logger.warn('got outdated cursor, waiting...')
            shouldWait = true
          } else {
            shouldWait = false
            yield parsedCommit
            if (Number.isSafeInteger(parsedCommit?.meta?.seq))
              this.seq = parsedCommit?.meta?.seq
          }
        }
      }
    } while (await wait(delay))
  }
}
