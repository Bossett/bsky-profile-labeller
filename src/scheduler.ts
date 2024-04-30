import wait from '@/lib/wait.js'
import db, { schema, eq, lte } from '@/db/db.js'
import env from '@/lib/env.js'

export default async function scheduler() {
  const expireAfter = env.NEWHANDLE_EXPIRY
  do {
    const expiringlabels = await db.query.new_handles.findMany({
      where: lte(
        schema.new_handles.unixtimeoffirstpost,
        Math.floor(Date.now() / 1000) - expireAfter,
      ),
      columns: { did: true, id: true, label: true },
    })
    expiringlabels.map(async (expiringlabel) => {
      await db.insert(schema.label_actions).values({
        label: expiringlabel.label,
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
