import { describe, test, expect } from "vitest";

import { TaskInstructions } from '../TaskInstructions.js';
import { TaskType } from '../../../models/Task.js';

describe('TaskInstructions mapping', () => {
    test('provides instructions for every task type', () => {
        const types = Object.values(TaskType);
        for (const type of types) {
            expect(TaskInstructions[type as TaskType]).toBeTruthy();
            expect(typeof TaskInstructions[type as TaskType]).toBe('string');
        }
    });
});
