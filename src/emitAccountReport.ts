import { agent, agentDid } from '@/lib/bskyAgent.js'
import { ToolsOzoneModerationEmitEvent } from '@atproto/api'
import logger from '@/helpers/logger.js'
import env from '@/env/env.js'

import purgeCacheForDid from '@/lib/getUserDetails.js'

import { pdsLimit } from '@/env/rateLimit.js'

export default async function emitAccountReport(
  eventInput: ToolsOzoneModerationEmitEvent.InputSchema,
): Promise<boolean> {
  if (env.DANGEROUSLY_EXPOSE_SECRETS) {
    await pdsLimit(async () =>
      logger.debug(
        `DANGEROUSLY_EXPOSE_SECRETS is set not emitting:\n ${JSON.stringify(
          eventInput,
        )}`,
      ),
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
    logger.warn(`${e.message} from emitAccountReport failed`)
    logger.warn(`${e}`)
    return false
  }

  if (eventInput.subject.$type === 'com.atproto.admin.defs#repoRef') {
    await purgeCacheForDid(`${eventInput.subject.did}`)
    logger.debug(`Purged cache for ${eventInput.subject.did}`)
  }

  return true
}
