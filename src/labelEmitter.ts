import wait from '@/helpers/wait.js'
import logger from '@/helpers/logger.js'

import emitAccountReport from '@/emitAccountReport.js'

import { agentDid } from '@/lib/bskyAgent.js'
import { ToolsOzoneModerationEmitEvent } from '@atproto/api'

import db, { schema, lte, inArray } from '@/db/db.js'
import { purgeCacheForDid } from './lib/getUserDetails.js'
import env from '@/env/env.js'

export default async function labelEmitter() {
  do {
    try {
      const events = await db.query.label_actions.findMany({
        where: lte(
          schema.label_actions.unixtimescheduled,
          Math.floor(Date.now() / 1000),
        ),
        // orderBy: schema.label_actions.unixtimescheduled,
        columns: {
          label: true,
          did: true,
          comment: true,
          id: true,
          action: true,
          unixtimescheduled: true,
        },
        limit: 640,
      })

      if (events.length === 0) continue

      const eventLog: { [key: string]: number } = {}
      let totalEvents = 0

      const completedEvents = new Set<
        typeof schema.label_actions.$inferSelect.id
      >()

      const groupedEvents = events.reduce((accumulatedEvents, event) => {
        if (!accumulatedEvents.has(event.did)) {
          const eventInput: ToolsOzoneModerationEmitEvent.InputSchema = {
            event: {
              $type: 'tools.ozone.moderation.defs#modEventLabel',
              createLabelVals: new Set<string>(),
              negateLabelVals: new Set<string>(),
              comment: '',
            },
            subject: {
              $type: 'com.atproto.admin.defs#repoRef',
              did: event.did,
            },
            createdBy: agentDid,
          }
          accumulatedEvents.set(event.did, {
            eventInput: eventInput,
            eventIds: [],
            timestamp: Date.now(),
          })
        }

        const currentEvent = accumulatedEvents.get(event.did)

        if (event.action === 'create') {
          currentEvent.eventInput.event.negateLabelVals.delete(event.label)
          currentEvent.eventInput.event.createLabelVals.add(event.label)
        }
        if (event.action === 'remove') {
          currentEvent.eventInput.event.createLabelVals.delete(event.label)
          currentEvent.eventInput.event.negateLabelVals.add(event.label)
        }

        eventLog[event.label]
          ? eventLog[event.label]++
          : (eventLog[event.label] = 1)

        const joinedComments = [
          currentEvent.eventInput.event.comment,
          event.comment,
        ]
          .filter(Boolean)
          .join(', ')

        currentEvent.eventInput.event.comment = joinedComments
        currentEvent.timestamp = event.unixtimescheduled
          ? event.unixtimescheduled * 1000
          : Date.now()
        currentEvent.eventIds.push(event.id)

        totalEvents++

        return accumulatedEvents
      }, new Map())

      for (const [, value] of groupedEvents) {
        value.eventInput.event.createLabelVals = Array.from(
          value.eventInput.event.createLabelVals,
        )
        value.eventInput.event.negateLabelVals = Array.from(
          value.eventInput.event.negateLabelVals,
        )
      }

      const eventPromises: Promise<void>[] = []

      for (const didForEvent of [...groupedEvents.keys()]) {
        const fn = async () => {
          const did = `${didForEvent}`

          const groupedEvent = groupedEvents.get(did)

          groupedEvent.eventInput.event.comment = `${
            groupedEvent.eventInput.event.comment
          } seen at: ${new Date(groupedEvent.timestamp).toISOString()}`.trim()

          if (await emitAccountReport(groupedEvent.eventInput)) {
            groupedEvent.eventIds.forEach((id: number) => {
              completedEvents.add(id)
            })
            purgeCacheForDid(did, groupedEvent.timestamp + 1000)
          }
          return
        }
        eventPromises.push(fn())
      }

      await Promise.allSettled(eventPromises)

      logger.debug(
        `grouped events: ${totalEvents} events into ${
          [...groupedEvents.keys()].length
        } groups`,
      )

      if (completedEvents.size > 0) {
        logger.debug(`deleting ${completedEvents.size} completed events`)
        await db
          .delete(schema.label_actions)
          .where(inArray(schema.label_actions.id, Array.from(completedEvents)))

        let outputString = `emitted ${completedEvents.size} labels in ${
          [...groupedEvents.keys()].length
        } events:`
        const labelsOut: string[] = []

        for (const event of Object.keys(eventLog)) {
          labelsOut.push(`${eventLog[event]} x ${event}`)
        }

        logger.info(`${outputString} ${labelsOut.join(', ')}`)
      }
    } catch (e) {
      logger.error(`labelEmitter error: ${e}`)
    }
  } while (await wait(1000))
}
