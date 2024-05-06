import { agent, reauth, agentDid } from '@/lib/bskyAgent.js'
import { ToolsOzoneModerationEmitEvent } from '@atproto/api'
import logger from '@/lib/logger.js'
import env from '@/lib/env.js'

import { reportLimit } from '@/lib/rateLimit.js'

export default async function emitAccountReport(
  eventInput: ToolsOzoneModerationEmitEvent.InputSchema,
): Promise<boolean> {
  if (env.DANGEROUSLY_EXPOSE_SECRETS) {
    logger.debug(
      `DANGEROUSLY_EXPOSE_SECRETS is set not emitting:\n ${JSON.stringify(
        eventInput,
      )}`,
    )
    return true
  }

  try {
    await reportLimit(() =>
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
