import { BskyAgent } from '@atproto/api'

const _agent = new BskyAgent({ service: process.env.LABELLER_SERVICE! })

await _agent.login({
  identifier: process.env.LABELLER_HANDLE!,
  password: process.env.LABELLER_PASSWORD!,
})

export const agent = _agent
