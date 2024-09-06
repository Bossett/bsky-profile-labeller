import { BskyAgent } from '@atproto/api'
import env from '@/env/env.js'

const _agent = new BskyAgent({ service: env.LABELLER_SERVICE })

await _agent.login({
  identifier: env.LABELLER_HANDLE,
  password: env.LABELLER_PASSWORD,
})

export const agentDid: string = `${
  (
    await _agent.com.atproto.identity.resolveHandle({
      handle: env.LABELLER_HANDLE,
    })
  ).data.did
}`

BskyAgent.configure({
  appLabelers: [agentDid],
})

export const agent: BskyAgent = _agent
