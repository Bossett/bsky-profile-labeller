import wait from '@/helpers/wait.js'
import logger from '@/helpers/logger.js'

import emitAccountReport from '@/emitAccountReport.js'

import { agentDid } from '@/lib/bskyAgent.js'
import { ToolsOzoneModerationEmitEvent } from '@atproto/api'

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

    if (events.length === 0) continue

    const eventLog: { [key: string]: number } = {}
    let totalEvents = 0

    const completedEvents = new Set<
      typeof schema.label_actions.$inferSelect.id
    >()

    const groupedEvents = events.reduce((accumulatedEvents, event) => {
      if (!accumulatedEvents[event.did]) {
        const eventInput: ToolsOzoneModerationEmitEvent.InputSchema = {
          event: {
            $type: 'tools.ozone.moderation.defs#modEventLabel',
            createLabelVals: [] as string[],
            negateLabelVals: [] as string[],
            comment: '',
          },
          subject: {
            $type: 'com.atproto.admin.defs#repoRef',
            did: event.did,
          },
          createdBy: agentDid,
        }
        const eventIds: number[] = []

        accumulatedEvents[event.did] = {
          eventInput: eventInput,
          eventIds: eventIds,
        }
      }

      if (event.action === 'create')
        accumulatedEvents[event.did].eventInput.event.createLabelVals.push(
          event.label,
        )
      if (event.action === 'remove')
        accumulatedEvents[event.did].eventInput.event.negateLabelVals.push(
          event.label,
        )

      eventLog[event.label]
        ? eventLog[event.label]++
        : (eventLog[event.label] = 1)

      accumulatedEvents[event.did].eventInput.event.comment += `${
        event.comment || ''
      }\n`

      accumulatedEvents[event.did].eventIds.push(event.id)

      totalEvents++

      return accumulatedEvents
    }, {})

    const eventPromises: Promise<void>[] = []

    for (const didForEvent of Object.keys(groupedEvents)) {
      const fn = async () => {
        const did = `${didForEvent}`
        const negateLabelVals = Array.from(
          new Set([...groupedEvents[did].eventInput.event.negateLabelVals]),
        )
        const createLabelVals = Array.from(
          new Set([
            ...groupedEvents[did].eventInput.event.createLabelVals.filter(
              (val: string) => {
                return !negateLabelVals.includes(val)
              },
            ),
          ]),
        )

        groupedEvents[did].eventInput.event.createLabelVals = createLabelVals

        groupedEvents[did].eventInput.event.negateLabelVals = negateLabelVals

        if (await emitAccountReport(groupedEvents[did].eventInput)) {
          groupedEvents[did].eventIds.forEach((id: number) => {
            completedEvents.add(id)
          })
          purgeCacheForDid(did)
        }
        return
      }
      eventPromises.push(fn())
    }

    await Promise.all(eventPromises)

    logger.debug(
      `grouped events: ${totalEvents} events into ${
        Object.keys(groupedEvents).length
      } groups`,
    )

    if (completedEvents.size > 0) {
      logger.debug(`deleting ${completedEvents.size} completed events`)
      await db
        .delete(schema.label_actions)
        .where(inArray(schema.label_actions.id, Array.from(completedEvents)))
      logger.info(
        `emitted ${completedEvents.size} labels in ${
          Object.keys(groupedEvents).length
        } events:`,
      )
      for (const event of Object.keys(eventLog)) {
        logger.info(`- ${event}: ${eventLog[event]}`)
      }
    }
  } while (await wait(5000))
}
