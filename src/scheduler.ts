import wait from '@/lib/wait'
import db, { schema, eq, lte } from '@/db/db.js'

export default async function scheduler() {
  const expireAfter = Number.parseInt(process.env.NEWHANDLE_EXPIRY || '2592000')

  do {
    const expiringlabels = await db.query.new_handles.findMany({
      where: lte(
        schema.new_handles.unixtimeoffirstpost,
        Math.floor(Date.now() / 1000) - expireAfter,
      ),
    })
    expiringlabels.map(async (expiringlabel) => {
      await db.insert(schema.label_actions).values({
        label: 'newhandle',
        action: 'remove',
        did: expiringlabel.did,
        comment: `Expiring: ${expiringlabel.did})`,
      })

      await db
        .delete(schema.new_handles)
        .where(eq(schema.new_handles.id, expiringlabel.id))
    })
  } while (await wait(60000))
}
