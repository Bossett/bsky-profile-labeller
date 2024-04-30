import { BskyAgent } from '@atproto/api'
import env from '@/lib/env.js'

const _agent = new BskyAgent({ service: env.LABELLER_SERVICE })

const _reauth = async (agent: BskyAgent) => {
  await agent.login({
    identifier: env.LABELLER_HANDLE,
    password: env.LABELLER_PASSWORD,
  })
}

await _reauth(_agent)

export const agent = _agent
export const reauth = _reauth
