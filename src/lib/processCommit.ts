import { getNewLabel } from '@/lib/getNewLabel.js'
import { getProfileLabel } from '@/lib/getProfileLabel.js'
import getUserDetails from '@/lib/getUserDetails.js'
import { getExpiringLabels } from '@/lib/getExpiringLabels.js'

import { insertOperations, operationType } from '@/lib/insertOperations.js'
import { AppBskyActorDefs } from '@atproto/api'

import { agent, reauth } from '@/lib/bskyAgent.js'

import logger from '@/lib/logger.js'

import env from '@/lib/env.js'

export async function processCommit(commit: {
  record?: any
  atURL: any
  collection?: string | undefined
  rkey?: string | undefined
  repo: any
  action?: string
  meta?: any
}): Promise<void> {
  const did: string = `${commit.repo}` || ''
  const seq: number = commit.meta['seq']

  if (did === '') return
  if (!Number.isSafeInteger(seq)) throw new Error(`Invalid sequence`)

  let debugString = ``

  const getDebugString = () => debugString

  const labelOperations: { create: string[]; remove: string[] } = {
    create: [],
    remove: [],
  }

  const timeout = setTimeout(() => {
    logger.debug(`${seq}: taking too long ${getDebugString()}`)
  }, env.limits.MAX_PROCESSING_TIME_MS / 2)

  debugString = `getting userDetails for ${did}`
  const tmpData: AppBskyActorDefs.ProfileViewDetailed | { error: string } =
    await getUserDetails(did)

  if (tmpData.error) {
    logger.debug(`${seq}: error ${tmpData.error} retreiving ${did}`)
    clearTimeout(timeout)
    return
  }

  const profileData = tmpData as AppBskyActorDefs.ProfileViewDetailed

  const currentLabels = profileData.labels
    ? profileData.labels.filter((label) => {
        label.src === agent.session?.did && label.neg !== true
      })
    : []

  const regex = /at:\/\/(did:[^:]+:[^\/]+)\/app\.bsky\.feed\.post\/([^\/]+)/
  const match = commit.atURL.match(regex)
  if (!match) {
    logger.debug(`${seq}: invalid commit URL ${commit.atURL}`)
    clearTimeout(timeout)
    return
  }
  const [, commit_did, commit_rkey] = match

  const handleExpiryThreshold = Date.now() - env.NEWHANDLE_EXPIRY * 1000

  debugString = `getting newLabels`
  const newLabels = await getNewLabel({
    did: commit_did,
    rkey: commit_rkey,
    watchedFrom: handleExpiryThreshold,
  })

  debugString = `getting profileLabels`
  const profileLabels = await getProfileLabel(profileData, currentLabels)

  debugString = `getting expiringLabels`

  if (!agent.session?.did) reauth(agent)
  const labellerDid = `${agent.session?.did}`

  const expiringLabels = await getExpiringLabels({
    labels: currentLabels,
    labeller: labellerDid,
    watchedFrom: handleExpiryThreshold,
    handlesToExpire: ['newhandle', 'newaccount'],
  })

  labelOperations.create = [
    ...labelOperations.create,
    ...(newLabels.create ? newLabels.create : []),
    ...(profileLabels.create ? profileLabels.create : []),
    ...(expiringLabels.create ? expiringLabels.create : []),
  ]

  labelOperations.remove = [
    ...labelOperations.remove,
    ...(newLabels.remove ? newLabels.remove : []),
    ...(profileLabels.remove ? profileLabels.remove : []),
    ...(expiringLabels.remove ? expiringLabels.remove : []),
  ]

  const handlesToReapply = ['newhandle']
  labelOperations.create = labelOperations.create.filter((label) => {
    if (
      currentLabels.map((curr) => curr.val).includes(label) &&
      !handlesToReapply.includes(label)
    ) {
      // only create labels that are not already on the account UNLESS they are in handlesToReapply
      logger.debug(`not re-labelling ${did} with ${label}`)
      return false
    } else {
      return true
    }
  })

  labelOperations.remove = labelOperations.remove.filter((label) => {
    return currentLabels.map((curr) => curr.val).includes(label)
    // only remove labels that are already on the account
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

  clearTimeout(timeout)
  return
}
