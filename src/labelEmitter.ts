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
      // orderBy: schema.label_actions.unixtimescheduled,
      columns: {
        label: true,
        did: true,
        comment: true,
        id: true,
        action: true,
        unixtimescheduled: true,
      },
      limit: 1000,
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
        const timestamp: number = Date.now()

        accumulatedEvents[event.did] = {
          eventInput: eventInput,
          eventIds: eventIds,
          timestamp: timestamp,
        }
      }

      const inNegate: number = (
        accumulatedEvents[event.did].eventInput.event
          .negateLabelVals as string[]
      ).findIndex((item) => item === event.label)
      const inCreate: number = (
        accumulatedEvents[event.did].eventInput.event
          .createLabelVals as string[]
      ).findIndex((item) => item === event.label)

      if (event.action === 'create') {
        if (inNegate !== -1) {
          accumulatedEvents[event.did].eventInput.event.negateLabelVals.splice(
            inNegate,
            1,
          )
        }
        if (inCreate === -1) {
          accumulatedEvents[event.did].eventInput.event.createLabelVals.push(
            event.label,
          )
        }
      }
      if (event.action === 'remove') {
        if (inCreate !== -1) {
          accumulatedEvents[event.did].eventInput.event.createLabelVals.splice(
            inCreate,
            1,
          )
        }
        if (inNegate === -1) {
          accumulatedEvents[event.did].eventInput.event.negateLabelVals.push(
            event.label,
          )
        }
      }

      eventLog[event.label]
        ? eventLog[event.label]++
        : (eventLog[event.label] = 1)

      const joinedComments = [
        ...(accumulatedEvents[event.did].eventInput.event.comment
          ? [accumulatedEvents[event.did].eventInput.event.comment]
          : []),
        ...(event.comment ? [event.comment] : []),
      ].join(', ')

      accumulatedEvents[event.did].eventInput.event.comment = joinedComments

      accumulatedEvents[event.did].timestamp = event.unixtimescheduled
        ? event.unixtimescheduled * 1000
        : Date.now()

      accumulatedEvents[event.did].eventIds.push(event.id)

      totalEvents++

      return accumulatedEvents
    }, {})

    const eventPromises: Promise<void>[] = []

    for (const didForEvent of Object.keys(groupedEvents)) {
      const fn = async () => {
        const did = `${didForEvent}`

        groupedEvents[did].eventInput.event.comment = `${
          groupedEvents[did].eventInput.event.comment
        } seen at: ${new Date(
          groupedEvents[did].timestamp,
        ).toISOString()}`.trim()

        if (await emitAccountReport(groupedEvents[did].eventInput)) {
          groupedEvents[did].eventIds.forEach((id: number) => {
            completedEvents.add(id)
          })
          purgeCacheForDid(did, groupedEvents[did].timestamp + 1000)
        }
        return
      }
      eventPromises.push(fn())
    }

    await Promise.allSettled(eventPromises)

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

      let outputString = `emitted ${completedEvents.size} labels in ${
        Object.keys(groupedEvents).length
      } events:`
      const labelsOut: string[] = []

      for (const event of Object.keys(eventLog)) {
        labelsOut.push(`${eventLog[event]} x ${event}`)
      }

      logger.info(`${outputString} ${labelsOut.join(', ')}`)
    }
  } while (await wait(1000))
}
