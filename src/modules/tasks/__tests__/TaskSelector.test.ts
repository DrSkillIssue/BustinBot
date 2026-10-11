import { afterEach, describe, expect, test, vi } from 'vitest';
import { pickWeightedRandom, selectTasksForCategory } from '../TaskSelector.js';
import { Skill, TaskCategory } from '../../../models/Task.js';
import { buildTask } from '../../../tests/fakes/builders.js';

// Math.random replaced by mulberry32 with a fixed seed, so large samples are random-looking but identical every run
function seedRandom(seed: number): void {
    let state = seed;
    vi.spyOn(Math, 'random').mockImplementation(() => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    });
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('pickWeightedRandom', () => {
    test('favours tasks in proportion to their weight', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        seedRandom(7);
        const tasks = [buildTask({ id: 'common', weight: 75 }), buildTask({ id: 'rare', weight: 25 })];

        const picks = Array.from({ length: 4000 }, () => pickWeightedRandom(tasks, 1)[0]?.id);

        expect(picks.filter((id) => id === 'common').length / picks.length).toBeCloseTo(0.75, 1);
    });

    test('never picks a task weighted zero while another task is left', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const tasks = [buildTask({ id: 'voted-out', weight: 0 }), buildTask({ id: 'normal', weight: 50 })];

        expect(pickWeightedRandom(tasks, 1).map((task) => task.id)).toEqual(['normal']);
        expect(pickWeightedRandom(tasks, 2).map((task) => task.id)).toEqual(['normal', 'voted-out']);
    });

    test('picks each task at most once', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        seedRandom(3);
        const tasks = Array.from({ length: 5 }, (_, index) => buildTask({ id: `PVM00${index}` }));

        const picked = pickWeightedRandom(tasks, 3).map((task) => task.id);

        expect(new Set(picked).size).toBe(3);
    });

    test('picks nothing from no tasks', () => {
        expect(pickWeightedRandom([], 3)).toEqual([]);
    });
});

describe('selectTasksForCategory', () => {
    const skilling = [
        buildTask({ id: 'WC1', category: TaskCategory.Skilling, skill: Skill.Woodcutting }),
        buildTask({ id: 'WC2', category: TaskCategory.Skilling, skill: Skill.Woodcutting }),
        buildTask({ id: 'FSH', category: TaskCategory.Skilling, skill: Skill.Fishing }),
        buildTask({ id: 'MIN', category: TaskCategory.Skilling, skill: Skill.Mining }),
        buildTask({ id: 'COO', category: TaskCategory.Skilling, skill: Skill.Cooking }),
    ];

    test('offers three PvM tasks from the PvM tasks only', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        seedRandom(11);
        const tasks = [...skilling, ...Array.from({ length: 5 }, (_, index) => buildTask({ id: `PVM00${index}`, category: TaskCategory.PvM }))];

        const selected = selectTasksForCategory(TaskCategory.PvM, tasks);

        expect(selected).toHaveLength(3);
        expect(selected.every((task) => task.category === TaskCategory.PvM)).toBe(true);
    });

    test('offers skilling tasks from three different skills', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        seedRandom(5);

        const skills = selectTasksForCategory(TaskCategory.Skilling, skilling).map((task) => task.skill);

        expect(skills).toHaveLength(3);
        expect(new Set(skills).size).toBe(3);
    });

    test('offers every skill equally often', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        seedRandom(42);
        const offered = new Map<string | undefined, number>();
        const polls = 4000;

        for (let poll = 0; poll < polls; poll++) {
            for (const task of selectTasksForCategory(TaskCategory.Skilling, skilling)) {
                offered.set(task.skill, (offered.get(task.skill) ?? 0) + 1);
            }
        }

        // Three of four skills are offered, so each should appear in three polls out of four
        for (const skill of [Skill.Woodcutting, Skill.Fishing, Skill.Mining, Skill.Cooking]) {
            expect((offered.get(skill) ?? 0) / polls).toBeCloseTo(0.75, 1);
        }
    });

    test('offers nothing for a category without tasks, saying so', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(selectTasksForCategory(TaskCategory.MinigameMisc, skilling)).toEqual([]);
        expect(warn).toHaveBeenCalledWith(`[TaskSelector] No tasks found for category ${TaskCategory.MinigameMisc}`);
    });
});
