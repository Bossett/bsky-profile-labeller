const limits = {
  // ***** RATE LIMITERS *****
  // the rate limiter for agent login attempts
  AUTH_LIMIT_MAX_CONCURRENT: 1,
  AUTH_LIMIT_MAX_DELAY_MS: 60 * 1000,
  AUTH_LIMIT_MAX_RATE: 20,
  AUTH_LIMIT_RATE_INTERVAL_MS: 300 * 1000,

  // rate limiter for authed request
  PDS_LIMIT_MAX_CONCURRENT: 8,
  PDS_LIMIT_MAX_DELAY_MS: 30 * 1000,
  PDS_LIMIT_MAX_RATE: 2_500,
  PDS_LIMIT_RATE_INTERVAL_MS: 300 * 1000,

  // rate limit for plc.directory
  PLC_LIMIT_MAX_CONCURRENT: 48,
  PLC_LIMIT_MAX_DELAY_MS: 30 * 1000,
  PLC_LIMIT_MAX_RATE: 25_000,
  PLC_LIMIT_RATE_INTERVAL_MS: 300 * 1000,

  // rate limit for public API
  PUBLIC_LIMIT_MAX_CONCURRENT: 48,
  PUBLIC_LIMIT_MAX_DELAY_MS: 60 * 1000,
  PUBLIC_LIMIT_MAX_RATE: 30_000,
  PUBLIC_LIMIT_RATE_INTERVAL_MS: 300 * 1000,

  MAX_RETRIES: 3, // some HTTP calls are retried, this sets the max #
  MAX_WAIT_RETRY_MS: 3 * 1000, // some HTTP calls are retried, this sets the max wait between retries

  // ***** APPLICATION CONFIG *****
  AUTHOR_FEED_MAX_RESULTS: 100, // sets the limit parameter requesting an author's posts - 100 is the api limit
  DB_WRITE_INTERVAL_MS: 5 * 60 * 1000, // time between pauses to update firehose sequence and scavenge cache - higher is generally betterm but you will have to reprocess this much on restart
  MAX_CONCURRENT_PROCESSCOMMITS: 64, // this influences # of http requests, so lower can be faster
  MAX_FIREHOSE_DELAY: 3 * 60 * 1000, // how long between events before considering the firehose stalled
  MAX_PENDING_INSERTS_WAIT_MS: 2 * 60 * 1000, // the maximum amount of time between inserting pending label events
  MAX_PENDING_INSERTS: 100, // the maximum number of label pending events before writing to the db
  MAX_PROCESSING_TIME_MS: 20 * 1000, // the maximum time any given commit can take to process

  MOIZED_FETCH_MAX_AGE_MS: 30 * 1000, // how long to cache fetch results when using general fetch()
  PAUSE_TIMEOUT_MS: 3 * 60 * 1000, // how long can we pause operations waiting to write to the db
  REGULAR_POST_STDEV_MS: 6 * 1000, // the standard deviation required for a post to be considered periodic (rapidposts)
  USER_DETAILS_MAX_AGE_MS: 60 * 60 * 1000, // how long do cached user details live - higher is better, but can sometimes lead to stale results (cache is purged when events are emitted, so this is generally safe)
}

const validateLimits = {
  'Pause timeout must be greater than maximum processing time':
    limits.PAUSE_TIMEOUT_MS > limits.MAX_PROCESSING_TIME_MS,
  'Database writer interval must be grater than maximum processing time':
    limits.DB_WRITE_INTERVAL_MS > limits.MAX_PROCESSING_TIME_MS,
  'Pause timeout must be less than database writer interval':
    limits.PAUSE_TIMEOUT_MS < limits.DB_WRITE_INTERVAL_MS,
}

for (const rule of Object.keys(validateLimits)) {
  if (!validateLimits[rule]) {
    throw new Error(`Validation failed: ${rule}`)
  }
}

export default limits
