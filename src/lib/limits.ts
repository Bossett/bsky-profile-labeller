const limits = {
  AUTHOR_FEED_MAX_RESULTS: 100,
  DB_WRITE_INTERVAL_MS: 5 * 60 * 1000,
  MAX_CONCURRENT_PROCESSCOMMITS: 64,
  MAX_FIREHOSE_DELAY: 3 * 60 * 1000,
  MAX_PENDING_INSERTS_WAIT_MS: 2 * 60 * 1000,
  MAX_PENDING_INSERTS: 1000,
  MAX_PROCESSING_TIME_MS: 20 * 1000,
  MAX_RETRIES: 3,
  MAX_WAIT_RETRY_MS: 3 * 1000,
  MOIZED_FETCH_MAX_AGE_MS: 30 * 1000,
  NEW_LABEL_MAX_CACHE_AGE_MS: 180 * 1000,
  PAUSE_TIMEOUT_MS: 3 * 60 * 1000,
  PDS_LIMIT_MAX_CONCURRENT: 16,
  PDS_LIMIT_MAX_DELAY_MS: 30 * 1000,
  PDS_LIMIT_MAX_RATE: 2_500,
  PDS_LIMIT_RATE_INTERVAL_MS: 300 * 1000,
  PLC_LIMIT_MAX_CONCURRENT: 48,
  PLC_LIMIT_MAX_DELAY_MS: 30 * 1000,
  PLC_LIMIT_MAX_RATE: 25_000,
  PLC_LIMIT_RATE_INTERVAL_MS: 300 * 1000,
  PUBLIC_LIMIT_MAX_CONCURRENT: 48,
  PUBLIC_LIMIT_MAX_DELAY_MS: 60 * 1000,
  PUBLIC_LIMIT_MAX_RATE: 30_000,
  PUBLIC_LIMIT_RATE_INTERVAL_MS: 300 * 1000,
  REGULAR_POST_STDEV_MS: 3 * 1000,
  USER_DETAILS_MAX_AGE_MS: 30 * 60 * 1000,
  AUTH_LIMIT_RATE_INTERVAL_MS: 300 * 1000,
  AUTH_LIMIT_MAX_RATE: 30,
  AUTH_LIMIT_MAX_CONCURRENT: 1,
  AUTH_LIMIT_MAX_DELAY_MS: 60 * 1000,
}

const validateLimits = {
  'Pause timeout must be greater than maximum processing time':
    limits.PAUSE_TIMEOUT_MS > limits.MAX_PROCESSING_TIME_MS,
  'Database writer interval must be grater than maximum processing time':
    limits.DB_WRITE_INTERVAL_MS > limits.MAX_PROCESSING_TIME_MS,
  'Pause timeout must be greater than database writer interval':
    limits.PAUSE_TIMEOUT_MS < limits.DB_WRITE_INTERVAL_MS,
}

for (const rule of Object.keys(validateLimits)) {
  if (!validateLimits[rule]) {
    throw new Error(`Validation failed: ${rule}`)
  }
}

export default limits
