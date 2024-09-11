import wait from '@/helpers/wait.js'
import logger from '@/helpers/logger.js'
import emitAccountReport from '@/emitAccountReport.js'
import { agentDid } from '@/lib/bskyAgent.js'
import { ToolsOzoneModerationEmitEvent } from '@atproto/api'
import db, { schema, lte, inArray, sql } from '@/db/db.js'
import { purgeCacheForDid } from './lib/getUserDetails.js'
import env from '@/env/env.js'

type Event = {
  id: number
  label: string
  action: 'create' | 'remove'
  did: string
  comment: string | null
  unixtimescheduled: number | null
}

const waitTime = Math.max(
  Math.ceil(
    env.limits.PDS_LIMIT_MAX_CONCURRENT /
      (env.limits.PDS_LIMIT_MAX_RATE / env.limits.PDS_LIMIT_RATE_INTERVAL_MS) /
      1000,
  ) *
    1000 -
    1000,
  0,
)

async function cleanUpRedundantEvents() {
  const redundantEvents = await db.execute(sql`
    DO $$
    DECLARE
        deleted_count INTEGER;
    BEGIN
        -- Materialize the rows to delete into a temporary table
      CREATE TEMP TABLE temp_rows_to_delete AS
      WITH max_rows AS (
        SELECT MAX(id) AS max_id
        FROM label_actions
        GROUP BY did, label, action
      )
      SELECT la.id
      FROM label_actions la
      LEFT JOIN max_rows mr
      ON la.id = mr.max_id
      WHERE mr.max_id IS NULL;

        LOOP
            DELETE FROM label_actions
            WHERE id IN (
                SELECT id FROM temp_rows_to_delete
                ORDER BY id
                LIMIT 10000  -- Batch size
            );

            -- Remove deleted rows from the temporary table
            DELETE FROM temp_rows_to_delete
            WHERE id IN (
                SELECT id
                FROM temp_rows_to_delete
                ORDER BY id
                LIMIT 10000
            );

            GET DIAGNOSTICS deleted_count = ROW_COUNT;
            EXIT WHEN deleted_count = 0;  -- Exit loop when no more rows are deleted
        END LOOP;

        -- Clean up the temp table after operation
        DROP TABLE temp_rows_to_delete;

    END $$;`)
}

export default async function labelEmitter() {
  do {
    const promArray: Promise<any>[] = [wait(waitTime)]
    await cleanUpRedundantEvents()
    const events = await db.query.label_actions.findMany({
      where: lte(
        schema.label_actions.unixtimescheduled,
        Math.floor(Date.now() / 1000),
      ),
      orderBy: schema.label_actions.id,
      columns: {
        label: true,
        did: true,
        comment: true,
        id: true,
        action: true,
        unixtimescheduled: true,
      },
      limit: 2 * Math.floor(env.limits.PDS_LIMIT_MAX_CONCURRENT),
    })
    if (events.length > 0) {
      const [completedEvents, groupedEvents, eventLog] = await processEvents(
        events,
      )
      promArray.push(logAndCleanup(completedEvents, groupedEvents, eventLog))
    }

    await Promise.allSettled(promArray)
    promArray.length = 0
  } while (true)
}

async function processEvents(events: Event[]): Promise<
  [
    Set<number>,
    {
      [key: string]: any
    },
    {
      [key: string]: number
    },
  ]
> {
  const eventLog: { [key: string]: number } = {}
  const completedEvents = new Set<number>()
  const groupedEvents = groupEvents(
    events,
    eventLog,
    env.limits.PDS_LIMIT_MAX_CONCURRENT,
  )

  await Promise.allSettled(
    Object.keys(groupedEvents).map((did) =>
      handleEvent(did, groupedEvents, completedEvents),
    ),
  )

  return [completedEvents, groupedEvents, eventLog]
}

function groupEvents(
  events: Event[],
  eventLog: { [key: string]: number },
  limit: number,
) {
  let count = 0
  return events.reduce((acc, event) => {
    if (!acc[event.did]) {
      if (count >= limit) return acc
      acc[event.did] = createEventInput(event)
      count++
    }
    updateEventInput(acc[event.did], event)
    eventLog[event.label] = (eventLog[event.label] || 0) + 1
    return acc
  }, {} as { [key: string]: any })
}

function createEventInput(event: Event) {
  return {
    eventInput: {
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
    },
    eventIds: [event.id],
    timestamp: event.unixtimescheduled
      ? event.unixtimescheduled * 1000
      : Date.now(),
  }
}

function updateEventInput(eventInput: any, event: Event) {
  const { createLabelVals, negateLabelVals } = eventInput.eventInput.event
  const inNegate = negateLabelVals.indexOf(event.label)
  const inCreate = createLabelVals.indexOf(event.label)

  if (event.action === 'create') {
    if (inNegate !== -1) negateLabelVals.splice(inNegate, 1)
    if (inCreate === -1) createLabelVals.push(event.label)
  } else {
    if (inCreate !== -1) createLabelVals.splice(inCreate, 1)
    if (inNegate === -1) negateLabelVals.push(event.label)
  }

  eventInput.eventInput.event.comment = [
    eventInput.eventInput.event.comment,
    event.comment,
  ]
    .filter(Boolean)
    .join(', ')
  eventInput.timestamp = event.unixtimescheduled
    ? event.unixtimescheduled * 1000
    : Date.now()
  eventInput.eventIds.push(event.id)
}

async function handleEvent(
  did: string,
  groupedEvents: any,
  completedEvents: Set<number>,
) {
  const event = groupedEvents[did]
  event.eventInput.event.comment = `${
    event.eventInput.event.comment
  } seen at: ${new Date(event.timestamp).toISOString()}`.trim()

  if (await emitAccountReport(event.eventInput)) {
    event.eventIds.forEach((id: number) => completedEvents.add(id))
    purgeCacheForDid(did, event.timestamp + 1000)
  }
}

async function logAndCleanup(
  completedEvents: Set<number>,
  groupedEvents: any,
  eventLog: { [key: string]: number },
) {
  logger.debug(
    `grouped events: ${completedEvents.size} events into ${
      Object.keys(groupedEvents).length
    } groups`,
  )

  if (completedEvents.size > 0) {
    await db
      .delete(schema.label_actions)
      .where(inArray(schema.label_actions.id, Array.from(completedEvents)))
    logger.debug(`deleted ${completedEvents.size} completed events`)

    const outputString = `emitted ${completedEvents.size} labels in ${
      Object.keys(groupedEvents).length
    } events:`
    const labelsOut = Object.keys(eventLog).map(
      (event) => `${eventLog[event]} x ${event}`,
    )
    logger.info(`${outputString} ${labelsOut.join(', ')}`)
  }
}
