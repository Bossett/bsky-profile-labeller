import { BskyAgent } from '@atproto/api'
import env from '@/lib/env.js'

const _agent = new BskyAgent({ service: env.LABELLER_SERVICE })

const _reauth = async (agent: BskyAgent) => {
  try {
    agent.login({
      identifier: env.LABELLER_HANDLE,
      password: env.LABELLER_PASSWORD,
    })
  } catch (e) {
    return false
  }
  return true
}

if (!(await _reauth(_agent))) throw 'Agent Authentication Failed'

export const agentDid: string = (
  await _agent.com.atproto.identity.resolveHandle({
    handle: env.LABELLER_HANDLE,
  })
).data.did

BskyAgent.configure({
  appLabelers: [agentDid],
})

export const agent: BskyAgent = _agent
export const reauth = _reauth
