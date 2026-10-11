import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseHoist = vi.hoisted(() => {
    const incrementMock = vi.fn((amount: number) => ({ __type: 'increment', amount }));
    const serverTimestampMock = vi.fn(() => 'serverTimestamp');
    const timestampNowMock = vi.fn((): { toMillis: () => number } => ({ toMillis: () => 0 }));
    const timestampFromMillisMock = vi.fn((ms: number) => ({
        toMillis: () => ms,
        toDate: () => new Date(ms),
    }));

    return {
        incrementMock,
        serverTimestampMock,
        timestampNowMock,
        timestampFromMillisMock,
    };
});

vi.mock('firebase-admin/firestore', () => {
    const { incrementMock, serverTimestampMock, timestampNowMock, timestampFromMillisMock } = firebaseHoist;
    return {
        FieldValue: {
            increment: incrementMock,
            serverTimestamp: serverTimestampMock,
        },
        Timestamp: {
            now: timestampNowMock,
            fromMillis: timestampFromMillisMock,
        },
        CollectionReference: class {},
    };
});

const { incrementMock, serverTimestampMock, timestampNowMock, timestampFromMillisMock } = firebaseHoist;

import type { Firestore } from 'firebase-admin/firestore';
import { GuildScopedRepository } from '../CoreRepo.js';

type FirestoreDoc<T = any> = {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    id?: string;
};

type FirestoreCollection = {
    doc: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    where?: ReturnType<typeof vi.fn>;
    orderBy?: ReturnType<typeof vi.fn>;
    limit?: ReturnType<typeof vi.fn>;
};

// Stub Firestore passed straight into the repositories
const mockDb = { collection: vi.fn(), batch: vi.fn() };
const db = mockDb as unknown as Firestore;

function createDocSnapshot(data: any, exists = true) {
    return {
        exists,
        data: () => data,
        id: data?.id ?? 'doc-id',
        ref: { id: data?.id ?? 'doc-id' },
    };
}

function createQuerySnapshot(docs: any[]) {
    return {
        docs,
        empty: docs.length === 0,
        size: docs.length,
        forEach: (cb: (doc: any) => void) => docs.forEach(cb),
    };
}

function stubCollection(overrides: Partial<FirestoreCollection> = {}) {
    const collection: FirestoreCollection = {
        doc: vi.fn(),
        get: vi.fn(),
        where: vi.fn().mockImplementation(() => collection),
        orderBy: vi.fn().mockImplementation(() => collection),
        limit: vi.fn().mockImplementation(() => collection),
        ...overrides,
    };
    mockDb.collection.mockReturnValue(collection as any);
    return collection;
}

function stubDoc(data: any, exists = true): FirestoreDoc {
    const doc: FirestoreDoc = {
        get: vi.fn().mockResolvedValue(createDocSnapshot(data, exists)),
        set: vi.fn().mockResolvedValue(undefined),
        update: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        id: data?.id ?? 'doc-id',
    };
    return doc;
}

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    mockDb.collection.mockReset();
    mockDb.batch?.mockReset?.();
});

describe('GuildScopedRepository base behaviour', () => {
    class TestRepo extends GuildScopedRepository<{ id: string; value: number }> {
        constructor() {
            super(db, 'guild-123', 'testCollection');
        }
    }

    it('performs CRUD operations through the underlying collection', async () => {
        const doc = stubDoc({ id: 'abc', value: 1 });
        const collection = stubCollection({
            doc: vi.fn().mockReturnValue(doc),
            get: vi.fn().mockResolvedValue(createQuerySnapshot([createDocSnapshot({ id: 'abc', value: 1 })])),
        });

        const repo = new TestRepo();

        await expect(repo.getAll()).resolves.toEqual([{ id: 'abc', value: 1 }]);
        expect(collection.get).toHaveBeenCalled();

        await expect(repo.getById('abc')).resolves.toEqual({ id: 'abc', value: 1 });
        expect(collection.doc).toHaveBeenCalledWith('abc');

        await repo.create('abc', { id: 'abc', value: 2 });
        expect(doc.set).toHaveBeenCalledWith({ id: 'abc', value: 2 });

        await repo.update('abc', { value: 3 });
        expect(doc.update).toHaveBeenCalledWith({ value: 3 });

        await repo.delete('abc');
        expect(doc.delete).toHaveBeenCalled();
    });
});
