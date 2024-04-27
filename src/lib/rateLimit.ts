import { pRateLimit } from 'p-ratelimit'

const limit = pRateLimit({
  interval: 300, // 1000 ms == 1 second
  rate: 3000, // 30 API calls per interval
  concurrency: 1, // no more than 10 running at once
  maxDelay: 2000, // an API call delayed > 2 sec is rejected
})

export default limit
