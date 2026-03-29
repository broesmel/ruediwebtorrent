import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('../../src/db/db.js', async () => {
  const { MemoryLevel } = await import('memory-level')
  return { default: new MemoryLevel({ valueEncoding: 'utf8' }) }
})

import db from '../../src/db/db.js'
import {
  createUser,
  getUserById,
  getUserByEmail,
  updateUser,
  getNextUserId,
} from '../../src/db/repositories/userRepo.js'

beforeEach(async () => {
  await db.clear()
})

describe('getNextUserId', () => {
  it('starts at 1', async () => {
    expect(await getNextUserId()).toBe(1)
  })

  it('increments on each call', async () => {
    expect(await getNextUserId()).toBe(1)
    expect(await getNextUserId()).toBe(2)
    expect(await getNextUserId()).toBe(3)
  })
})

describe('createUser', () => {
  it('returns user with auto-incremented id', async () => {
    const user = await createUser({ email: 'a@test.com', passwordHash: 'hash1' })
    expect(user.id).toBe(1)
    expect(user.email).toBe('a@test.com')
    expect(user.isAdmin).toBe(false)
    expect(user.gracePeriodEndsAt).toBeNull()
  })

  it('assigns sequential ids to multiple users', async () => {
    const u1 = await createUser({ email: 'a@test.com', passwordHash: 'h' })
    const u2 = await createUser({ email: 'b@test.com', passwordHash: 'h' })
    expect(u1.id).toBe(1)
    expect(u2.id).toBe(2)
  })
})

describe('getUserById', () => {
  it('returns the user', async () => {
    const created = await createUser({ email: 'x@test.com', passwordHash: 'h' })
    const found = await getUserById(created.id)
    expect(found).toMatchObject({ id: created.id, email: 'x@test.com' })
  })

  it('returns null for unknown id', async () => {
    expect(await getUserById(999)).toBeNull()
  })
})

describe('getUserByEmail', () => {
  it('returns the user via email index', async () => {
    await createUser({ email: 'look@test.com', passwordHash: 'h' })
    const found = await getUserByEmail('look@test.com')
    expect(found).not.toBeNull()
    expect(found.email).toBe('look@test.com')
  })

  it('returns null for unknown email', async () => {
    expect(await getUserByEmail('no@test.com')).toBeNull()
  })
})

describe('updateUser', () => {
  it('merges updates into existing user', async () => {
    const user = await createUser({ email: 'u@test.com', passwordHash: 'h' })
    const updated = await updateUser(user.id, { gracePeriodEndsAt: 12345 })
    expect(updated.gracePeriodEndsAt).toBe(12345)
    expect(updated.email).toBe('u@test.com') // unchanged fields preserved
  })

  it('throws for unknown user', async () => {
    await expect(updateUser(999, {})).rejects.toThrow('999')
  })
})
