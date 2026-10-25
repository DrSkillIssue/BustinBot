import { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, LabelBuilder } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import type { Task } from "../../../models/Task.js";
import { truncate } from "../../../utils/TextUtils.js";
import { taskFormFields } from "../../tasks/TaskForm.js";

const taskChoice = (task: Task) => ({
    name: truncate(`${task.id} · ${task.taskName}`, 100),
    value: task.id,
});

const updatetask: Command = {
    name: "updatetask",
    description: "Update an existing task and its embed if currently active.",
    module: CommandModule.Task,
    allowedRoles: [CommandRole.TaskAdmin],

    slashData: new SlashCommandBuilder()
        .setName("updatetask")
        .setDescription("Update an existing task and its embed if currently active.")
        .addStringOption((opt) =>
            opt
                .setName("id")
                .setDescription("The task to update: type part of its name or ID")
                .setRequired(true)
                .setAutocomplete(true),
        ),

    async autocomplete({ interaction, services }) {
        const repo = services.repos.taskRepo;
        const query = interaction.options.getFocused().trim();
        await interaction.respond(
            query
                ? (await repo.getTaskSearch()).search(query, { limit: 25 }).map((result) => taskChoice(result.item))
                : (await repo.getAllTasks()).slice(0, 25).map(taskChoice),
        );
    },

    async execute({ interaction, services }) {
        if (!interaction) return;

        const taskId = interaction.options.getString("id", true);
        const repo = services.repos.taskRepo;

        const task = await repo.getTaskById(taskId);
        if (!task) {
            await interaction.reply({ content: `No task found with ID **${taskId}**.`, flags: 1 << 6 });
            return;
        }

        // Build modal
        const modal = new ModalBuilder()
            .setCustomId(`update_task_modal_${task.id}`)
            .setTitle(`Update task: ${task.shortName ?? task.id}`);

        const type = new LabelBuilder()
            .setLabel("Verification Type (XP, KC, Drop, etc.)")
            .setTextInputComponent(
                new TextInputBuilder().setCustomId("type").setStyle(TextInputStyle.Short).setValue(task.type),
            );
        modal.addLabelComponents(...taskFormFields(task), type);

        await interaction.showModal(modal);
    },
};

export default updatetask;
