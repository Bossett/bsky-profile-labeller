import FirehoseIterable from './lib/firehoseIterable.js'
import logger from '@/lib/logger.js'
import wait from '@/lib/wait.js'
import limit from '@/lib/rateLimit.js'

import db, { schema, eq } from '@/db/db.js'

async function insertOrUpdateHandle(
  did: string,
  handle: string,
  unixtimeofchange: number,
) {
  await db
    .insert(schema.new_handles)
    .values({
      did: did,
      handle: handle,
      unixtimeofchange: unixtimeofchange,
    })
    .onConflictDoUpdate({
      target: schema.new_handles.did,
      set: {
        handle: handle,
        unixtimeofchange: unixtimeofchange,
        unixtimeoffirstpost: null,
      },
    })

  const time = new Date(unixtimeofchange * 1000)
  logger.info(`handle change ${handle} from ${did} at ${time}`)
}

export default async function firehoseWatcher() {
  const watching = await db.query.new_handles.findMany({
    with: { unixtimeoffirstpost: null },
  })

  let seq: number =
    (await db.query.subscription_status.findFirst())?.last_sequence || -1

  setInterval(async () => {
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
  }, 300000)

  do {
    try {
      const firehose = await new FirehoseIterable().create({ seq: seq })

      const watching_dids: Set<string> = new Set()
      watching.map((x) => watching_dids.add(x.did))

      for await (const commit of firehose) {
        if (Number.isSafeInteger(commit.meta['seq'])) {
          seq = commit.meta['seq']
        }

        if (
          commit.meta['$type'] === 'com.atproto.sync.subscribeRepos#identity'
        ) {
          const did = commit.repo || ''
          if (did.startsWith('did:plc:')) {
            const res = (await (
              await limit(() => fetch(`https://plc.directory/${did}/log/audit`))
            ).json()) as {
              did: string
              createdAt: string
              operation: { alsoKnownAs: string[] }
            }[]

            const handle = res[0].operation.alsoKnownAs[0].split('at://')[1]

            const unixtimeofchange = Math.floor(
              new Date(res[0].createdAt).getTime() / 1000,
            )

            if (unixtimeofchange > Date.now() / 1000 - 300) {
              await insertOrUpdateHandle(did, handle, unixtimeofchange)
            }

            watching_dids.add(did)
          }
        }

        if (commit.meta['$type'] === 'com.atproto.sync.subscribeRepos#handle') {
          const did = commit.meta['did']
          const handle = commit.meta['handle']

          const unixtimeofchange = Math.floor(
            new Date(commit.meta['time']).getTime() / 1000,
          )

          await insertOrUpdateHandle(did, handle, unixtimeofchange)

          watching_dids.add(did)
        }

        if (
          commit.meta['$type'] === 'com.atproto.sync.subscribeRepos#commit' &&
          commit.record['$type'] === 'app.bsky.feed.post'
        ) {
          if (watching_dids.has(commit.meta['repo'])) {
            logger.info(`${commit.meta['repo']} first post (${commit.atURL})`)
            const unixtimeoffirstpost = Math.floor(
              new Date(commit.meta['time']).getTime() / 1000,
            )
            await db
              .update(schema.new_handles)
              .set({ unixtimeoffirstpost: unixtimeoffirstpost })
              .where(eq(schema.new_handles.did, commit.meta['repo']))

            await db.insert(schema.label_actions).values({
              label: 'newhandle',
              action: 'create',
              did: commit.meta['repo'],
              comment: `New handle: ${commit.meta['repo']} first post (${commit.atURL})`,
            })

            watching_dids.delete(commit.meta['repo'])
          }
        }
      }
    } catch (e) {
      logger.warn(`${e} in firehoseWatcher`)
    }
  } while (await wait(10000))
}
