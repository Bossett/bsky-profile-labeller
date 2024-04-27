import { pRateLimit } from 'p-ratelimit'

const limit = pRateLimit({
  interval: 300 * 1000,
  rate: 3000,
  concurrency: 5,
  maxDelay: 2000,
})

export default limit
