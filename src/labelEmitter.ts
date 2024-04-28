import wait from '@/lib/wait.js'
import logger from '@/lib/logger.js'

import emitAccountReport from '@/emitAccountReport.js'

import db, { schema, lte, eq } from '@/db/db.js'

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
    events.map(async (event) => {
      logger.info(
        `emitting ${event.action} '${event.label}' for ${event.did}, comment: "${event.comment}"`,
      )
      if (await emitAccountReport(event)) {
        await db
          .delete(schema.label_actions)
          .where(eq(schema.label_actions.id, event.id))
      }
    })
  } while (await wait(5000))
}
