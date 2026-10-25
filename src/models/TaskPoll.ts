import type { Poll } from "./Poll.js";
import type { Task, TaskCategory } from "./Task.js";

export type TaskPoll = Omit<Poll<Task>, "category"> & { category: TaskCategory };
