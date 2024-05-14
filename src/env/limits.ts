const limits = {
  // ***** RATE LIMITERS *****
  // the rate limiter for agent login attempts
  AUTH_LIMIT_MAX_CONCURRENT: 10,
  AUTH_LIMIT_MAX_DELAY_MS: 3000,
  AUTH_LIMIT_MAX_RATE: 20,
  AUTH_LIMIT_RATE_INTERVAL_MS: 300 * 1000,
  // rate limiter for authed request
  PDS_LIMIT_MAX_CONCURRENT: 128,
  PDS_LIMIT_MAX_DELAY_MS: 3000,
  PDS_LIMIT_MAX_RATE: 1_500,
  PDS_LIMIT_RATE_INTERVAL_MS: 5 * 60 * 1000,
  // rate limiter for delete request
  DELETE_LIMIT_MAX_CONCURRENT: 16,
  DELETE_LIMIT_MAX_DELAY_MS: 3000,
  DELETE_LIMIT_MAX_RATE: 2500,
  DELETE_LIMIT_RATE_INTERVAL_MS: 60 * 60 * 1000,
  // rate limit for plc.directory
  PLC_LIMIT_MAX_CONCURRENT: 256,
  PLC_LIMIT_MAX_DELAY_MS: undefined,
  PLC_LIMIT_MAX_RATE: undefined,
  PLC_LIMIT_RATE_INTERVAL_MS: undefined,
  // rate limit for public API
  PUBLIC_LIMIT_MAX_CONCURRENT: 96,
  PUBLIC_LIMIT_MAX_DELAY_MS: undefined,
  PUBLIC_LIMIT_MAX_RATE: undefined,
  PUBLIC_LIMIT_RATE_INTERVAL_MS: undefined,

  MAX_RETRIES: 1, // retries for HTTP calls and attempts to process commits
  MAX_WAIT_RETRY_MS: 1000, // some HTTP calls are retried, this sets the max wait between retries
  // ***** APPLICATION CONFIG *****
  AUTHOR_FEED_MAX_RESULTS: 30, // sets the limit parameter requesting an author's posts - 30 is what bsky.app uses so the cache should be fresher
  DB_WRITE_INTERVAL_MS: 15 * 60 * 1000, // time between pauses to update firehose sequence and scavenge cache - higher is generally better but you will have to reprocess this much on restart
  MAX_CONCURRENT_PROCESSCOMMITS: 96, // this influences # of http requests, so lower can be faster
  MAX_FIREHOSE_DELAY: 3 * 60 * 1000, // how long between events before considering the firehose stalled
  MIN_FIREHOSE_OPS: 30, // the minimum number of operations per interval before considering the firehose stalled
  MAX_PENDING_INSERTS_WAIT_MS: 30 * 1000, // the maximum amount of time between inserting pending label events
  MAX_PENDING_INSERTS: 64, // the maximum number of label pending events before writing to the db
  MAX_PROCESSING_TIME_MS: 2 * 60 * 1000, // the maximum time any given commit can take to process
  REGULAR_POST_STDEV_MS: 6 * 1000, // the standard deviation required for a post to be considered periodic (rapidposts)
  USER_DETAILS_MAX_AGE_MS: 60 * 60 * 1000, // how long do cached user details live - higher is better, but can sometimes lead to stale results (cache is purged when events are emitted, so this is generally safe)
  USER_DETAILS_MAX_SIZE: 20000,
  AUTHOR_FEED_MAX_AGE_MS: 60 * 60 * 1000, // as above for author feed, resets on post
  AUTHOR_FEED_MAX_SIZE: 20000,
  PLC_DIRECTORY_MAX_AGE_MS: 60 * 60 * 1000,
  PLC_DIRECTORY_MAX_SIZE: 20000,
  POST_CACHE_MAX_AGE_MS: 60 * 60 * 1000,
  POST_CACHE_MAX_SIZE: 20000,
  MIN_BATCH_WAIT_TIME_MS: 100,
  BATCH_CYCLE_TIMEOUT_MS: 3 * 60 * 1000,
  MIN_SCHEDULE_INTERVAL: 5 * 60 * 1000,
}

const validateLimits = {
  '1. Database writer interval must be greater than maximum processing time':
    limits.DB_WRITE_INTERVAL_MS > limits.MAX_PROCESSING_TIME_MS,
}

for (const rule of Object.keys(validateLimits)) {
  if (!validateLimits[rule]) {
    throw new Error(`Validation failed: ${rule}`)
  }
}

export default limits
