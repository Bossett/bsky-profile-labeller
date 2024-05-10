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
      e.message === 'Error: TypeError: fetch failed'
    )
      return false
    logger.warn(`${e} from emitAccountReport attempting re-auth`)
    if (isRetry) return false

    try {
      await reauth(agent)
    } catch (e) {
      throw e
    }

    if (!isRetry) return emitAccountReport(eventInput, true)
    return false
  }
  return true
}
