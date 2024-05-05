import wait from '@/lib/wait.js'
import logger from '@/lib/logger.js'

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
  logger.error(e)
  process.exit(1)
}
