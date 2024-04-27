import wait from '@/lib/wait'
import logger from '@/lib/logger'

import emitAccountReport from '@/emitAccountReport.js'

import db, { schema, lte, eq } from '@/db/db.js'

export default async function labelEmitter() {
  do {
    const events = await db.query.label_actions.findMany({
      where: lte(
        schema.label_actions.unixtimescheduled,
        Math.floor(Date.now() / 1000),
      ),
    })
    events.map(async (event) => {
      logger.info(
        `emitting ${event.action} '${event.label}' for ${event.did}: ${event.comment}`,
      )
      if (await emitAccountReport(event.label, event.did, event.comment)) {
        await db
          .delete(schema.label_actions)
          .where(eq(schema.label_actions.id, event.id))
      }
    })
  } while (await wait(5000))
}
