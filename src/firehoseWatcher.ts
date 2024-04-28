import FirehoseIterable from './lib/firehoseIterable.js'
import logger from '@/lib/logger.js'
import wait from '@/lib/wait.js'
import limit from '@/lib/rateLimit.js'
import formatDuration from '@/lib/formatDuration.js'

import db, { schema, eq, isNull, and } from '@/db/db.js'
import insertOrUpdateHandle from '@/lib/insertOrUpdateHandle.js'

export default async function firehoseWatcher() {
  let seq: number =
    (
      await db.query.subscription_status.findFirst({
        columns: { last_sequence: true },
      })
    )?.last_sequence || 0

  let old_seq: number = seq

  const watched_dids = new Set<string>(
    (
      await db.query.new_handles.findMany({
        where: isNull(schema.new_handles.unixtimeoffirstpost),
        columns: { did: true },
      })
    ).map((row) => row.did),
  )

  let lag = 0
  const interval_ms = 180000

  const interval = async () => {
    await wait(15000)
    do {
      const speed = (seq - old_seq) / (interval_ms / 1000)
      logger.info(
        `watching ${watched_dids.size.toLocaleString()} at seq: ${seq} with lag ${formatDuration(
          lag,
        )} (${speed.toFixed(2)}ops/s)`,
      )
      old_seq = seq
      await db
        .insert(schema.subscription_status)
        .values({
          id: 1,
          last_sequence: seq,
        })
        .onConflictDoUpdate({
          target: schema.subscription_status.id,
          set: {
            last_sequence: seq,
          },
        })
    } while (await wait(interval_ms))
  }

  interval()

  do {
    try {
      const firehose = await new FirehoseIterable().create({
        seq: seq,
        timeout: 60000,
      })

      for await (const commit of firehose) {
        if (Number.isSafeInteger(commit.meta['seq'])) {
          seq = commit.meta['seq']
          lag = Date.now() - new Date(commit.meta['time']).getTime()
        }

        const did = commit.repo || ''

        if (did === '') continue

        const isWatched = watched_dids.has(did)

        if (
          commit.meta['$type'] === 'com.atproto.sync.subscribeRepos#identity'
        ) {
          if (did.startsWith('did:plc:')) {
            const res = (await (
              await limit(() => fetch(`https://plc.directory/${did}/log/audit`))
            ).json()) as {
              did: string
              createdAt: string
              operation: { alsoKnownAs: string[] }
            }[]

            const handle = res
              ?.at(-1)
              ?.operation?.alsoKnownAs[0]?.split('at://')[1]

            const prev_handle = res
              ?.at(-2)
              ?.operation?.alsoKnownAs[0]?.split('at://')[1]

            const unixtimeofchange = Math.floor(
              new Date(`${res?.at(-1)?.createdAt}`).getTime() / 1000,
            )

            if (handle !== undefined) {
              if (
                Math.abs(
                  new Date(commit.meta['time']).getTime() / 1000 -
                    unixtimeofchange,
                ) <= 60
              ) {
                if (prev_handle === undefined || prev_handle !== handle) {
                  await insertOrUpdateHandle(did, handle, unixtimeofchange)
                  watched_dids.add(did)
                }
              }
            }
          }
        }

        if (
          commit.meta['$type'] ===
            'com.atproto.sync.subscribeRepos#tombstone ' &&
          isWatched
        ) {
          await db.transaction(async (tx) => {
            await tx
              .delete(schema.new_handles)
              .where(eq(schema.new_handles.did, did))

            await tx.insert(schema.label_actions).values({
              label: 'newhandle',
              action: 'remove',
              did: did,
              comment: `Tombstone: ${did}`,
            })

            watched_dids.delete(did)
          })
        }

        if (
          commit.meta['$type'] === 'com.atproto.sync.subscribeRepos#commit' &&
          commit.record['$type'] === 'app.bsky.feed.post' &&
          isWatched
        ) {
          const unixtimeoffirstpost = Math.floor(
            new Date(commit.meta['time']).getTime() / 1000,
          )
          await db.transaction(async (tx) => {
            await tx
              .update(schema.new_handles)
              .set({ unixtimeoffirstpost: unixtimeoffirstpost })
              .where(eq(schema.new_handles.did, did))

            await tx.insert(schema.label_actions).values({
              label: 'newhandle',
              action: 'create',
              did: did,
              comment: `New handle: ${did} first post (${commit.atURL})`,
            })

            watched_dids.delete(did)
          })
        }
      }
    } catch (e) {
      logger.warn(`${e} in firehoseWatcher`)
    }
  } while (await wait(10000))
}
