import { agent, reauth, agentDid } from '@/lib/bskyAgent.js'
import { ToolsOzoneModerationEmitEvent } from '@atproto/api'
import logger from '@/helpers/logger.js'
import env from '@/env/env.js'

import { pdsLimit } from '@/env/rateLimit.js'

export default async function emitAccountReport(
  eventInput: ToolsOzoneModerationEmitEvent.InputSchema,
  isRetry = false,
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
    await pdsLimit(() =>
      agent
        .withProxy('atproto_labeler', agentDid)
        .api.tools.ozone.moderation.emitEvent(eventInput),
    )
  } catch (e) {
    if (
      e.message === 'queue maxDelay timeout exceeded' ||
      `${e}` === 'Error: TypeError: fetch failed'
    )
      return false

    if (isRetry) {
      logger.warn(`${e.message} from emitAccountReport failed after re-auth`)
      return false
    }

    try {
      await reauth(agent)
    } catch (e) {
      logger.warn(
        `${e.message} from emitAccountReport failed attempting re-auth`,
      )
      throw e
    }
    return emitAccountReport(eventInput, true)
  }
  return true
}
