import { agent, reauth, agentDid } from '@/lib/bskyAgent.js'
import { ToolsOzoneModerationEmitEvent } from '@atproto/api'
import logger from '@/lib/logger.js'
import env from '@/lib/env.js'

import { pdsLimit } from '@/lib/rateLimit.js'

export default async function emitAccountReport({
  label,
  action,
  did,
  comment,
}: {
  label: string
  action: 'create' | 'remove'
  did: string
  comment: string | null | undefined
}): Promise<boolean> {
  if (env.DANGEROUSLY_EXPOSE_SECRETS) {
    logger.debug(`DANGEROUSLY_EXPOSE_SECRETS is set not emitting ${label}`)
    return true
  }

  const eventInput: ToolsOzoneModerationEmitEvent.InputSchema = {
    event: {
      $type: 'tools.ozone.moderation.defs#modEventLabel',
      createLabelVals: action === 'create' ? [label] : [],
      negateLabelVals: action === 'remove' ? [label] : [],
      comment: `${comment}`,
    },
    subject: {
      $type: 'com.atproto.admin.defs#repoRef',
      did: did,
    },
    createdBy: agentDid,
  }

  try {
    await pdsLimit(() =>
      agent
        .withProxy('atproto_labeler', agentDid)
        .api.tools.ozone.moderation.emitEvent(eventInput),
    )
  } catch (e) {
    logger.warn(`${e} from emitAccountReport attempting re-auth`)
    try {
      await reauth(agent)
    } catch (e) {
      throw e
    }
    return false
  }
  return true
}
