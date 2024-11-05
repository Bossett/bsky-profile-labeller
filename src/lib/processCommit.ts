import { getNewLabel } from '@/lib/getNewLabel.js'
import { getProfileLabel } from '@/lib/getProfileLabel.js'
import getUserDetails, {
  purgeCacheForDid as purgeDetailsCache,
} from '@/lib/getUserDetails.js'
import { purgeCacheForDid as purgePlcDirectoryCache } from '@/lib/getPlcRecord.js'
import { getExpiringLabels } from '@/lib/getExpiringLabels.js'
import {
  OperationsResult,
  insertOperations,
  operationType,
} from '@/lib/insertOperations.js'
import { AppBskyActorDefs } from '@atproto/api'
import { agentDid } from '@/lib/bskyAgent.js'
import logger from '@/helpers/logger.js'
import env from '@/env/env.js'
import wait from '@/helpers/wait.js'
import Denque from 'denque'
import { insertListItemOperation } from '@/lib/insertListItemOperation.js'

const debug: Boolean = env.DANGEROUSLY_EXPOSE_SECRETS

type Commit = {
  record?: any
  atURL: any
  collection?: string | undefined
  rkey?: string | undefined
  repo: any
  action?: string
  meta?: any
}

const regexDid = /(did:[^:]+:[^\/]+)/

export function validateCommit(commit: Commit): { seq?: number; did?: string } {
  if (
    !(
      commit.record['$type'] &&
      ['app.bsky.feed.post'].includes(commit.record['$type'])
    )
  ) {
    return {}
  }

  const did: string = `${commit.repo}` || ''
  const seq: number = commit.meta['seq']

  if (did === '') return {}
  if (!Number.isSafeInteger(seq)) return {}

  const matchDid = did.match(regexDid)
  if (!matchDid) {
    if (debug) logger.debug(`${seq}: invalid did at ${commit.repo}`)
    return {}
  }
  return { seq: seq, did: did }
}

export function _processCommit(commit: Commit): Promise<void> {
  return new Promise(async (resolve, reject) => {
    let failTimeout: NodeJS.Timeout | undefined = undefined

    try {
      const { seq, did } = validateCommit(commit)
      if (!(seq && did)) {
        clearTimeout(failTimeout)
        reject()
        return
      }

      switch (commit.record['$type']) {
        case 'app.bsky.feed.repost':
        case 'app.bsky.graph.follow':
        case 'app.bsky.feed.like':
          clearTimeout(failTimeout)
          return

        default:
          break
      }

      failTimeout = setTimeout(() => {
        if (debug) logger.debug(`${seq}: took too long, failing...`)
        reject(new Error(`ProcessCommitTimeout`))
      }, env.limits.MAX_PROCESSING_TIME_MS)

      const time: number = commit.meta['time']
        ? new Date(commit.meta['time']).getTime()
        : 0

      const purges = async () => {
        if (
          commit.meta['$type'] == 'com.atproto.sync.subscribeRepos#identity'
        ) {
          if (purgePlcDirectoryCache(did, time)) {
            if (debug)
              logger.debug(
                `got identity change, refreshing plc cache of ${did}`,
              )
          }
        }
        if (commit.record['$type'] === 'app.bsky.actor.profile') {
          if (purgeDetailsCache(did, time)) {
            if (debug)
              logger.debug(
                `got profile change, refreshing profile cache of ${did}`,
              )
          }
        }
      }
      purges()

      const tmpData: AppBskyActorDefs.ProfileViewDetailed | { error: string } =
        await getUserDetails(did)

      if (tmpData.error) {
        if (debug)
          logger.debug(`${seq}: error ${tmpData.error} retreiving ${did}`)

        clearTimeout(failTimeout)
        reject()
        return
      }

      const profileData = tmpData as AppBskyActorDefs.ProfileViewDetailed
      const allLabelOperations: OperationsResult[] = []

      const currentLabels = profileData.labels
        ? profileData.labels.filter((label) => {
            return label.src === agentDid && !label.neg
          })
        : []

      const handleExpiryThreshold = Date.now() - env.NEWHANDLE_EXPIRY * 1000

      const promArray: Promise<OperationsResult>[] = []

      switch (commit.record['$type']) {
        case 'app.bsky.feed.post':
          const regex =
            /at:\/\/(did:[^:]+:[^\/]+)\/app\.bsky\.feed\.post\/([^\/]+)/
          const match = commit.atURL.match(regex)
          if (!match) {
            if (debug)
              logger.debug(`${seq}: invalid commit URL ${commit.atURL}`)

            clearTimeout(failTimeout)
            reject()
            return
          }
          const [, commit_did, commit_rkey] = match

          promArray.push(
            getNewLabel({
              did: commit_did,
              rkey: commit_rkey,
              watchedFrom: handleExpiryThreshold,
            }).catch((e) => {
              const op: OperationsResult = {
                create: [],
                remove: [],
              }
              return op
            }),
          )
          break

        default:
          clearTimeout(failTimeout)
          return
      }

      promArray.push(
        getProfileLabel(profileData, currentLabels).catch((e) => {
          const op: OperationsResult = {
            create: [],
            remove: [],
          }
          return op
        }),
      )

      promArray.push(
        getExpiringLabels({
          labels: currentLabels,
          labeller: agentDid,
          watchedFrom: handleExpiryThreshold,
          handlesToExpire: ['changedhandle'],
        }).catch((e) => {
          const op: OperationsResult = {
            create: [],
            remove: [],
          }
          return op
        }),
      )

      let opsResults: any[]

      opsResults = (await Promise.allSettled(promArray)).flatMap((item) =>
        item.status === 'fulfilled' ? [item.value] : [],
      )

      const labelOperations = opsResults.reduce(
        (ops, op) => {
          ops.create = [...ops.create, ...op.create]
          ops.remove = [...ops.remove, ...op.remove]
          return ops
        },
        {
          create: [],
          remove: [],
        },
      )

      allLabelOperations.forEach((operations) => {
        labelOperations.create = [
          ...labelOperations.create,
          ...(operations.create ? operations.create : []),
        ]

        labelOperations.remove = [
          ...labelOperations.remove,
          ...(operations.remove ? operations.remove : []),
        ]
      })

      insertListItemOperation(did, labelOperations)

      // anything in this list 'refreshed' when it re-triggers
      const handlesToReapply = ['changedhandle']

      labelOperations.create = labelOperations.create.filter(
        (label: string) => {
          if (
            currentLabels.map((curr) => curr.val).includes(label) &&
            currentLabels.some((curr) => curr.val === label && !curr.neg)
          ) {
            // If the label is already on the account, only keep it if it's in handlesToReapply
            return handlesToReapply.includes(label)
          } else {
            // If the label is not on the account, keep it
            return true
          }
        },
      )

      labelOperations.remove = labelOperations.remove.filter(
        (label: string) => {
          if (
            currentLabels.map((curr) => curr.val).includes(label) &&
            currentLabels.some((curr) => curr.val === label && !curr.neg)
          ) {
            // only remove labels that are already on the account
            return true
          } else {
            return false
          }
        },
      )

      const operations: operationType[] = []

      if (labelOperations.remove.length > 0) {
        for (const newLabel of labelOperations.remove) {
          if (debug) logger.debug(`${seq}: unlabel ${did} ${newLabel}`)
          operations.push({
            label: newLabel,
            action: 'remove',
            did: did,
            comment: `${seq}: -${newLabel}`,
          })
        }
      }
      if (labelOperations.create.length > 0) {
        for (const newLabel of labelOperations.create) {
          if (debug) logger.debug(`${seq}: label ${did} ${newLabel}`)
          operations.push({
            label: newLabel,
            action: 'create',
            did: did,
            comment: `${seq}: +${newLabel}`,
            unixtimescheduled: Math.floor(time / 1000),
          })
        }
      }

      if (
        labelOperations.create.length > 0 ||
        labelOperations.remove.length > 0
      ) {
        insertOperations(operations)
      }

      clearTimeout(failTimeout)
      resolve()
      return
    } catch (e) {
      clearTimeout(failTimeout)
      reject(e)
    } finally {
      clearTimeout(failTimeout)
      resolve()
    }
  })
}

const maxActiveTasks = env.limits.MAX_CONCURRENT_PROCESSCOMMITS

class Semaphore {
  private tasks: (() => void)[] = []
  private counter: number

  constructor(maxConcurrent: number) {
    this.counter = maxConcurrent
  }

  async acquire() {
    if (this.counter > 0) {
      this.counter--
      return
    }
    await new Promise<void>((resolve) => this.tasks.push(resolve))
  }

  release() {
    this.counter++
    if (this.tasks.length > 0) {
      const nextTask = this.tasks.shift()
      if (nextTask) nextTask()
    }
  }
}

const semaphore = new Semaphore(maxActiveTasks)

export async function processCommit(commit: Commit): Promise<boolean> {
  const isValidCommit = validateCommit(commit)
  if (!(isValidCommit.did && isValidCommit.seq)) return false

  await semaphore.acquire().then(() => {
    _processCommit(commit)
      .catch((err) => {
        //
      })
      .finally(() => {
        semaphore.release()
      })
  })

  return isValidCommit.did ? true : false
}
