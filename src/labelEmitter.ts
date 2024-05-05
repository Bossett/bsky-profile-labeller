import wait from '@/lib/wait.js'
import logger from '@/lib/logger.js'

import emitAccountReport from '@/emitAccountReport.js'

import db, { schema, lte, inArray } from '@/db/db.js'
import { purgeCacheForDid } from './lib/getUserDetails.js'

export default async function labelEmitter() {
  do {
    const events = await db.query.label_actions.findMany({
      where: lte(
        schema.label_actions.unixtimescheduled,
        Math.floor(Date.now() / 1000),
      ),
      columns: {
        label: true,
        did: true,
        comment: true,
        id: true,
        action: true,
      },
    })
    const eventLog: { [key: string]: number } = {}
    let totalEvents = 0

    const completedEvents: (typeof schema.label_actions.$inferSelect.id)[] = []

    const debugLines: string[] = []

    const promises = events.map(async (event) => {
      debugLines.push(`${event.action} ${event.did} '${event.label}'`)
      if (await emitAccountReport(event)) {
        completedEvents.push(event.id)
        purgeCacheForDid(event.did)
        eventLog[event.label]
          ? eventLog[event.label]++
          : (eventLog[event.label] = 1)
        totalEvents++
      }
    })

    for (const line of debugLines) {
      logger.debug(line)
    }

    await Promise.all(promises)

    if (completedEvents.length > 0) {
      logger.debug(`deleting ${completedEvents.length} completed events`)
      await db
        .delete(schema.label_actions)
        .where(inArray(schema.label_actions.id, completedEvents))
      logger.info(`emitted ${totalEvents} events:`)
      for (const event of Object.keys(eventLog)) {
        logger.info(`  ${event}: ${eventLog[event]}`)
      }
    }
  } while (await wait(5000))
}
