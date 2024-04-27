import firehoseWatcher from '@/firehoseWatcher.js'
import labelEmitter from '@/labelEmitter.js'
import scheduler from '@/scheduler.js'

const app: (() => Promise<void>)[] = [
  async () => {
    await firehoseWatcher()
  },
  async () => labelEmitter(),
  async () => scheduler(),
]

await Promise.all(app.map((func) => func()))
