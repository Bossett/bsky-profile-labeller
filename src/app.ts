import firehoseWatcher from '@/firehoseWatcher.js'
import labelEmitter from '@/labelEmitter.js'
import scheduler from '@/scheduler.js'

const app: (() => Promise<void>)[] = [
  async () => firehoseWatcher(),
  async () => labelEmitter(),
  async () => scheduler(),
]

let lastRun = Date.now()

const promises = app.map((func) => func())

try {
  lastRun = Date.now()
  await Promise.all(promises)
} catch (e) {
  console.log(e)
  process.exit(1)
}
