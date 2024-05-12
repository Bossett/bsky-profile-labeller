import firehoseWatcher from '@/firehoseWatcher.js'
import labelEmitter from '@/labelEmitter.js'
import scheduler from '@/scheduler.js'

const app: (() => Promise<void>)[] = [
  async () => firehoseWatcher(),
  async () => labelEmitter(),
  async () => scheduler(),
]

const promises = app.map((func) => func())

try {
  await Promise.all(promises)
} catch (e) {
  console.log(e)
  process.exit(1)
}
