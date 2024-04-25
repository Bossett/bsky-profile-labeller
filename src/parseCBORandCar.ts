import logger from './logger.js'

import * as cborx from 'cbor-x'
import { CID } from 'multiformats'
import { readCarWithRoot, cborToLexRecord, BlockMap } from '@atproto/repo'
import {
  Commit,
  RepoOp,
} from '@atproto/api/dist/client/types/com/atproto/sync/subscribeRepos'

cborx.addExtension({
  // https://github.com/bluesky-social/atproto/blob/318736816c65e86a554e09cb9dc2e095dff636c4/packages/common/src/ipld-multi.ts
  // add extension for decoding CIDs
  // decoding code taken from @ipld/dag-cbor
  // does not support encoding cids
  Class: CID,
  tag: 42,
  encode: () => {
    throw new Error('cannot encode cids')
  },
  decode: (bytes: Uint8Array): CID => {
    if (bytes[0] !== 0) {
      throw new Error('Invalid CID for CBOR tag 42; expected leading 0x00')
    }
    return CID.decode(bytes.subarray(1)) // ignore leading 0x00
  },
})

export async function parseCBORandCar(commit: Commit) {
  let car: {
    root: CID
    blocks: BlockMap
  } | null = null

  try {
    car = await readCarWithRoot(commit.blocks)
  } catch {
    // do nothing, null is ok
  }

  const opsArray: {
    record: any
    atURL: string | undefined
    collection: string | undefined
    rkey: string | undefined
    repo: string | undefined
    action: string
  }[] = []

  const processedCommit: any = structuredClone(commit)
  delete processedCommit.blocks
  delete processedCommit.ops

  processedCommit['prev'] = commit.prev?.toString()
  processedCommit['commit'] = commit.commit?.toString()
  processedCommit['blobs'] = commit.blobs?.map((blob) => blob.toString())

  const repo = (() => {
    if (processedCommit.did !== undefined) return `${processedCommit.did}`
    if (processedCommit.repo !== undefined) return `${processedCommit.repo}`
    return undefined
  })()

  const type = `${processedCommit.$type}`

  if (Symbol.iterator in Object(commit.ops) && commit.ops.length > 0) {
    for (const op of commit.ops) {
      let record: string = '{}'

      const cbor = op.cid !== null ? car?.blocks.get(op.cid) : null

      if (cbor) {
        try {
          record = JSON.stringify(cborToLexRecord(cbor))
        } catch (e) {
          logger.warn(`failed to decode record ${processedCommit.seq}`)
        }
      }

      opsArray.push({
        record: JSON.parse(record),
        atURL: `at://${processedCommit.repo}/${op.path}`,
        collection: `${op.path.split('/').at(0)}`,
        rkey: `${op.path.split('/').at(-1)}`,
        repo: repo,
        action: op.action,
      })
    }
  } else {
    let record = '{}'
    if (car) {
      record = JSON.stringify({ root: car.root.toString(), blocks: car.blocks })
    }
    opsArray.push({
      record: JSON.parse(record),
      atURL: undefined,
      collection: undefined,
      rkey: undefined,
      repo: repo,
      action: 'no_ops',
    })
  }

  const processedFrames = opsArray.map((op) => {
    return { ...{ meta: structuredClone(processedCommit) }, ...op }
  })

  return processedFrames
}
