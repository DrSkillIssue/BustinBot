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
import { KeywordRepository } from '../KeywordRepo.js';

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

describe('KeywordRepository', () => {
    const guildId = 'guild-keywords';

    function setupKeywordCollection(docs: any[] = []) {
        const docStore = new Map<string, ReturnType<typeof stubDoc>>();
        const collection = stubCollection({
            doc: vi.fn((id: string) => {
                if (!docStore.has(id)) {
                    const existing = docs.find((d) => d.id === id);
                    docStore.set(id, stubDoc(existing ?? { id }, Boolean(existing)));
                }
                return docStore.get(id)!;
            }),
            get: vi.fn().mockResolvedValue(createQuerySnapshot(docs.map((d) => createDocSnapshot(d)))),
        });
        return collection;
    }

    it('adds and retrieves keywords', async () => {
        const keywords = [{ id: 'hello_world', word: 'Hello World' }];
        const collection = setupKeywordCollection(keywords);
        const repo = new KeywordRepository(db, guildId);

        await expect(repo.getAllKeywords()).resolves.toEqual(keywords);
        expect(collection.get).toHaveBeenCalled();

        await repo.addKeyword('New Keyword!');
        expect(collection.doc).toHaveBeenCalledWith('new_keyword');
        const createdDoc = collection.doc.mock.results.at(-1)?.value;
        expect(createdDoc).toBeTruthy();
        expect(createdDoc.set).toHaveBeenCalledWith(expect.objectContaining({
            id: 'new_keyword',
            word: 'New Keyword!',
            timesUsed: 0,
        }));
    });

    it('marks keyword usage and handles missing docs', async () => {
        const existing = {
            id: 'rare',
            word: 'Rare',
            timesUsed: 2,
            usageHistory: ['old'],
            lastUsedAt: { toMillis: () => 100 },
        };
        const doc = stubDoc(existing, true);
        const missingDoc = stubDoc({}, false);

        const collection = stubCollection({
            doc: vi.fn((id: string) => (id === 'rare' ? doc : missingDoc)),
        });

        const repo = new KeywordRepository(db, guildId);

        timestampNowMock.mockReturnValueOnce({ toMillis: () => 200 });
        await repo.markKeywordUsed('rare', 'event-1');
        expect(doc.update).toHaveBeenCalledWith(expect.objectContaining({
            timesUsed: 3,
            lastUsedEventId: 'event-1',
            usageHistory: ['event-1', 'old'],
        }));

        await repo.markKeywordUsed('missing', 'event-2');
        expect(missingDoc.update).not.toHaveBeenCalled();
    });

    it('picks random eligible keyword excluding recent ones', async () => {
        const keywords = Array.from({ length: 5 }, (_, i) => ({
            id: `kw-${i}`,
            word: `Word ${i}`,
            lastUsedAt: { toMillis: () => 100 - i },
        }));
        const repo = new KeywordRepository(db, guildId);
        vi.spyOn(repo, 'getAllKeywords').mockResolvedValue(keywords as any);

        vi.spyOn(Math, 'random').mockReturnValue(0);
        await expect(repo.getRandomKeyword(2)).resolves.toEqual(expect.objectContaining({ id: 'kw-2' }));
        (Math.random as any).mockRestore();
    });

    it('resets usage via batch updates', async () => {
        const docs = [createDocSnapshot({ id: 'kw-1' }), createDocSnapshot({ id: 'kw-2' })];
        const collection = setupKeywordCollection([]);
        collection.get.mockResolvedValueOnce(createQuerySnapshot(docs));

        const batchUpdate = vi.fn();
        const batchCommit = vi.fn().mockResolvedValue(undefined);
        mockDb.batch.mockReturnValue({ update: batchUpdate, commit: batchCommit } as any);

        const repo = new KeywordRepository(db, guildId);
        await repo.resetAllUsage();

        expect(batchUpdate).toHaveBeenCalledTimes(2);
        expect(batchCommit).toHaveBeenCalled();
    });
});
