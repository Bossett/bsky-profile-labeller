import { getNewLabel } from '@/lib/getNewLabel.js'
import { getProfileLabel } from '@/lib/getProfileLabel.js'
import getUserDetails, {
  purgeCacheForDid as purgeDetailsCache,
} from '@/lib/getUserDetails.js'
import { purgeCacheForDid as purgeAuthorFeedCache } from '@/lib/getAuthorFeed.js'
import { getExpiringLabels } from '@/lib/getExpiringLabels.js'
import {
  OperationsResult,
  insertOperations,
  operationType,
} from '@/lib/insertOperations.js'
import { AppBskyActorDefs } from '@atproto/api'
import { agentDid } from '@/lib/bskyAgent.js'
import logger from '@/lib/logger.js'
import env from '@/lib/env.js'
import wait from '@/lib/wait.js'

type Commit = {
  record?: any
  atURL: any
  collection?: string | undefined
  rkey?: string | undefined
  repo: any
  action?: string
  meta?: any
}

export function validateCommit(commit: Commit): { seq?: number; did?: string } {
  if (
    !(
      (commit.record['$type'] &&
        ['app.bsky.feed.post', 'app.bsky.actor.profile'].includes(
          commit.record['$type'],
        )) ||
      ['com.atproto.sync.subscribeRepos#identity'].includes(
        commit.meta['$type'],
      )
    )
  ) {
    return {}
  }

  const did: string = `${commit.repo}` || ''
  const seq: number = commit.meta['seq']

  if (did === '') return {}
  if (!Number.isSafeInteger(seq)) return {}

  const regexDid = /(did:[^:]+:[^\/]+)/
  const matchDid = did.match(regexDid)
  if (!matchDid) {
    logger.debug(`${seq}: invalid did at ${commit.repo}`)
    return {}
  }
  return { seq: seq, did: did }
}

export async function _processCommit(commit: Commit): Promise<void> {
  const { seq, did } = validateCommit(commit)
  if (!(seq && did)) return

  let isStalled = false

  let debugString = ``
  const getDebugString = () => debugString
  const setStalled = () => {
    isStalled = true
    currentStalled++
  }

  const timeout = setTimeout(() => {
    logger.debug(`${seq}: taking too long ${getDebugString()}, setting stalled`)

    setStalled()
  }, env.limits.MAX_PROCESSING_TIME_MS / 2)

  if (commit.record['$type'] === 'app.bsky.actor.profile') {
    logger.debug(`got profile change, purging ${did}`)
    purgeDetailsCache(did)
  }
  if (commit.record['$type'] === 'app.bsky.feed.post') {
    if (purgeAuthorFeedCache(did, new Date(commit.record.createdAt)))
      logger.debug(`got post change, purging ${did}`)
  }

  debugString = `getting userDetails for ${did}`
  const tmpData: AppBskyActorDefs.ProfileViewDetailed | { error: string } =
    await getUserDetails(did)

  if (tmpData.error) {
    logger.debug(`${seq}: error ${tmpData.error} retreiving ${did}`)
    clearTimeout(timeout)
    return
  }

  const profileData = tmpData as AppBskyActorDefs.ProfileViewDetailed
  const labelOperations: OperationsResult = {
    create: [],
    remove: [],
  }
  const allLabelOperations: OperationsResult[] = []

  const currentLabels = profileData.labels
    ? profileData.labels.filter((label) => {
        return label.src === agentDid && !label.neg
      })
    : []

  const handleExpiryThreshold = Date.now() - env.NEWHANDLE_EXPIRY * 1000

  switch (commit.record['$type']) {
    case 'app.bsky.feed.post':
      const regex = /at:\/\/(did:[^:]+:[^\/]+)\/app\.bsky\.feed\.post\/([^\/]+)/
      const match = commit.atURL.match(regex)
      if (!match) {
        logger.debug(`${seq}: invalid commit URL ${commit.atURL}`)
        clearTimeout(timeout)
        return
      }
      const [, commit_did, commit_rkey] = match

      debugString = `getting newLabels`
      allLabelOperations.push(
        await getNewLabel({
          did: commit_did,
          rkey: commit_rkey,
          watchedFrom: handleExpiryThreshold,
        }),
      )
      break
    case 'app.bsky.feed.like':
      break
    case 'app.bsky.feed.repost':
      break
    case 'app.bsky.graph.follow':
      break
    case 'app.bsky.actor.profile':
      break

    default:
      clearTimeout(timeout)
      return
  }

  debugString = `getting profileLabels`
  allLabelOperations.push(await getProfileLabel(profileData, currentLabels))

  debugString = `getting expiringLabels`
  allLabelOperations.push(
    await getExpiringLabels({
      labels: currentLabels,
      labeller: agentDid,
      watchedFrom: handleExpiryThreshold,
      handlesToExpire: ['newhandle', 'newaccount'],
    }),
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

  const handlesToReapply = ['newhandle']

  labelOperations.create = labelOperations.create.filter((label) => {
    if (!currentLabels.map((curr) => curr.val).includes(label)) {
      // only create labels that are not already on the account
      // UNLESS they are in handlesToReapply
      return false
    } else {
      logger.debug(`not re-labelling ${did} with ${label}`)
      if (handlesToReapply.includes(label)) return true
      return false
    }
  })

  labelOperations.remove = labelOperations.remove.filter((label) => {
    if (currentLabels.map((curr) => curr.val).includes(label)) {
      // only remove labels that are already on the account
      return true
    } else {
      return false
    }
  })

  const operations: operationType[] = []

  if (labelOperations.remove.length > 0) {
    for (const newLabel of labelOperations.remove) {
      logger.debug(`${seq}: unlabel ${did} ${newLabel}`)
      operations.push({
        label: newLabel,
        action: 'remove',
        did: did,
        comment: `removing ${newLabel} from ${did}`,
      })
    }
  }
  if (labelOperations.create.length > 0) {
    for (const newLabel of labelOperations.create) {
      logger.debug(`${seq}: label ${did} ${newLabel}`)
      operations.push({
        label: newLabel,
        action: 'create',
        did: did,
        comment: `creating ${newLabel} for ${did}`,
      })
    }
  }

  debugString = `inserting operations`

  if (labelOperations.create.length > 0 || labelOperations.remove.length > 0) {
    await insertOperations(operations)
  }

  if (isStalled) currentStalled--

  clearTimeout(timeout)
  return
}

const maxConcurrent = env.limits.MAX_CONCURRENT_PROCESSCOMMITS
let currentProcesses = 0
let currentStalled = 0

export async function processCommit(commit: Commit): Promise<void> {
  while (
    currentProcesses >=
    maxConcurrent - Math.min(currentStalled, maxConcurrent / 5)
  ) {
    await wait(10)
  }
  currentProcesses++
  _processCommit(commit).finally(() => currentProcesses--)
}
