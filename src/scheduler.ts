import wait from '@/helpers/wait.js'
import db, { schema, eq, lte, isNotNull, and } from '@/db/db.js'
import env from '@/env/env.js'

export default async function scheduler() {
  do {
    const expiringlabels = await db.query.new_handles.findMany({
      where: and(
        isNotNull(schema.new_handles.unixtimeoffirstpost),
        lte(
          schema.new_handles.unixtimeoffirstpost,
          Math.floor(Date.now() / 1000) - env.NEWHANDLE_EXPIRY,
        ),
      ),
      columns: { did: true, id: true, label: true, unixtimeoffirstpost: true },
    })
    expiringlabels.map(async (expiringlabel) => {
      await db.insert(schema.label_actions).values({
        label: expiringlabel.label,
        action: 'remove',
        did: expiringlabel.did,
        comment: `Expiring: ${expiringlabel.did} (added ${new Date(
          expiringlabel.unixtimeoffirstpost! * 1000,
        ).toISOString()})`,
      })

      await db
        .delete(schema.new_handles)
        .where(eq(schema.new_handles.id, expiringlabel.id))
    })
  } while (await wait(60000))
}
