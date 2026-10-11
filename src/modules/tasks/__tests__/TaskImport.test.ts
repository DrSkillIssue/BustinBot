import { describe, expect, it, vi } from 'vitest';
import { importTasks, parseTasksCsv } from '../TaskImport.js';
import { TaskCategory, TaskType, type Task } from '../../../models/Task.js';

const CSV = [
    'ID,Task Name,Category,Type,Skill,Bronze Amount,Silver Amount,Gold Amount,Weight,Short Name,Wilderness Required?,XP per Action,Min XP for Bronze,Min XP for Silver,Min XP for Gold',
    'SKL001,Gain {amount} Sailing XP,Skilling,XP,Sailing,"150,000","400,000","800,000",60,Sailing,FALSE,35,"10,000","20,000","40,000"',
    'PVM001,Kill {amount} Zulrah,PvM,KC,,10,25,50,,Zulrah,TRUE,,,,',
    ',Row without an ID,PvM,KC,,1,2,3,,,FALSE,,,,',
    '',
].join('\n');

describe('parseTasksCsv', () => {
    it('maps normalised headers onto tasks and keeps skilling-only fields for skilling tasks', () => {
        const [skilling, pvm] = parseTasksCsv(CSV);

        expect(skilling).toEqual({
            id: 'SKL001',
            taskName: 'Gain {amount} Sailing XP',
            category: TaskCategory.Skilling,
            type: TaskType.XP,
            skill: 'Sailing',
            amtBronze: 150000,
            amtSilver: 400000,
            amtGold: 800000,
            weight: 60,
            shortName: 'Sailing',
            wildernessReq: false,
            xpPerAction: 35,
            minXPBronze: 10000,
            minXPSilver: 20000,
            minXPGold: 40000,
        });

        expect(pvm).toEqual({
            id: 'PVM001',
            taskName: 'Kill {amount} Zulrah',
            category: TaskCategory.PvM,
            type: TaskType.KC,
            amtBronze: 10,
            amtSilver: 25,
            amtGold: 50,
            weight: 50,
            shortName: 'Zulrah',
            wildernessReq: true,
        });
    });

    it('skips rows without an ID and never emits undefined fields', () => {
        const tasks = parseTasksCsv(CSV);

        expect(tasks.map((task) => task.id)).toEqual(['SKL001', 'PVM001']);
        for (const task of tasks) {
            expect(Object.values(task)).not.toContain(undefined);
        }
    });
});

describe('importTasks', () => {
    const task = (id: string): Task => ({
        id,
        taskName: id,
        category: TaskCategory.PvM,
        type: TaskType.KC,
        amtBronze: 1,
        amtSilver: 2,
        amtGold: 3,
    });

    it('stores only tasks whose IDs are not already saved', async () => {
        const repo = {
            getAllTasks: vi.fn().mockResolvedValue([task('PVM001')]),
            seedTasks: vi.fn().mockResolvedValue(undefined),
        };

        const result = await importTasks(repo, [task('PVM001'), task('PVM002'), task('PVM003')]);

        expect(repo.seedTasks).toHaveBeenCalledWith([task('PVM002'), task('PVM003')]);
        expect(result).toEqual({ newCount: 2, skipped: 1, total: 3 });
    });

    it('writes nothing when every task already exists', async () => {
        const repo = {
            getAllTasks: vi.fn().mockResolvedValue([task('PVM001')]),
            seedTasks: vi.fn(),
        };

        const result = await importTasks(repo, [task('PVM001')]);

        expect(repo.seedTasks).not.toHaveBeenCalled();
        expect(result).toEqual({ newCount: 0, skipped: 1, total: 1 });
    });
});
