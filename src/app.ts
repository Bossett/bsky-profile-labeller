import FirehoseIterable from './firehoseIterable.js'
import logger from './logger.js'

const firehose = await new FirehoseIterable().create({})
const watching_dids: Set<string> = new Set()

for await (const commit of firehose) {
  switch (commit.meta['$type']) {
    case 'com.atproto.sync.subscribeRepos#handle':
      const did = commit.meta['did']
      const handle = commit.meta['handle']
      const time = new Date().toISOString()
      logger.info(`handle change ${handle} from ${did} at ${time}`)
      watching_dids.add(did)
      break
    case 'com.atproto.sync.subscribeRepos#commit':
      if (commit.record['$type'] === 'app.bsky.feed.post') {
        if (watching_dids.has(commit.meta['repo'])) {
          logger.info(
            `${commit.meta['repo']} first post (${commit.atURL}), emit label`,
          )
          watching_dids.delete(commit.meta['repo'])
        }
      }
  }
}
