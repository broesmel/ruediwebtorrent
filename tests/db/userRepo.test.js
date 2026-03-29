import { vi, describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'crypto'

vi.mock('../../src/db/db.js', async () => {
  const { MemoryLevel } = await import('memory-level')
  return { default: new MemoryLevel({ valueEncoding: 'utf8' }) }
})

import db from '../../src/db/db.js'
import {
  createUser,
  getUserById,
  getUserByPubkey,
  updateUser,
  listAllUsers,
} from '../../src/db/repositories/userRepo.js'

// 64-char hex strings representing two test public keys
const PUBKEY_A = 'a'.repeat(64)
const PUBKEY_B = 'b'.repeat(64)

beforeEach(async () => {
  await db.clear()
})

describe('createUser', () => {
  it('derives userId as sha256(pubkeyHex)', async () => {
    const user = await createUser({ pubkey: PUBKEY_A })
    const expectedId = createHash('sha256').update(PUBKEY_A).digest('hex')
    expect(user.id).toBe(expectedId)
  })

  it('stores pubkey, isAdmin false, null gracePeriodEndsAt', async () => {
    const user = await createUser({ pubkey: PUBKEY_A })
    expect(user.pubkey).toBe(PUBKEY_A)
    expect(user.isAdmin).toBe(false)
    expect(user.gracePeriodEndsAt).toBeNull()
    expect(typeof user.createdAt).toBe('number')
  })

  it('different pubkeys produce different userIds', async () => {
    const u1 = await createUser({ pubkey: PUBKEY_A })
    const u2 = await createUser({ pubkey: PUBKEY_B })
    expect(u1.id).not.toBe(u2.id)
  })
})

describe('getUserById', () => {
  it('returns the user', async () => {
    const created = await createUser({ pubkey: PUBKEY_A })
    const found = await getUserById(created.id)
    expect(found).toMatchObject({ id: created.id, pubkey: PUBKEY_A })
  })

  it('returns null for unknown id', async () => {
    expect(await getUserById('nonexistent')).toBeNull()
  })
})

describe('getUserByPubkey', () => {
  it('returns the user via pubkey index', async () => {
    await createUser({ pubkey: PUBKEY_A })
    const found = await getUserByPubkey(PUBKEY_A)
    expect(found).not.toBeNull()
    expect(found.pubkey).toBe(PUBKEY_A)
  })

  it('returns null for unknown pubkey', async () => {
    expect(await getUserByPubkey(PUBKEY_B)).toBeNull()
  })
})

describe('updateUser', () => {
  it('merges updates into existing user, preserving other fields', async () => {
    const user = await createUser({ pubkey: PUBKEY_A })
    const updated = await updateUser(user.id, { gracePeriodEndsAt: 12345 })
    expect(updated.gracePeriodEndsAt).toBe(12345)
    expect(updated.pubkey).toBe(PUBKEY_A)
  })

  it('throws for unknown user', async () => {
    await expect(updateUser('nonexistent', {})).rejects.toThrow()
  })
})

describe('listAllUsers', () => {
  it('returns all users without pubkey-index entries', async () => {
    await createUser({ pubkey: PUBKEY_A })
    await createUser({ pubkey: PUBKEY_B })
    const users = await listAllUsers()
    expect(users).toHaveLength(2)
    expect(users.every(u => typeof u.pubkey === 'string')).toBe(true)
    expect(users.every(u => typeof u.id === 'string')).toBe(true)
  })

  it('returns empty array when no users exist', async () => {
    expect(await listAllUsers()).toHaveLength(0)
  })
})
