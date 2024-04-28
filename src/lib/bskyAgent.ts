import { BskyAgent } from '@atproto/api'

const _agent = new BskyAgent({ service: process.env.LABELLER_SERVICE! })

const _reauth = async (agent: BskyAgent) => {
  await agent.login({
    identifier: process.env.LABELLER_HANDLE!,
    password: process.env.LABELLER_PASSWORD!,
  })
}

await _reauth(_agent)

export const agent = _agent
export const reauth = _reauth
