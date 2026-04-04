import { SlashCommandBuilder, ChatInputCommandInteraction, TextChannel } from 'discord.js';
import type { Command } from '../../../models/Command.js';
import { CommandModule, CommandRole } from '../../../models/Command.js';

const reportbug: Command = {
    name: 'reportbug',
    description: 'Report a bug to the BustinBot dev team',
    module: CommandModule.Core,
    allowedRoles: [CommandRole.Everyone],
    usage: '/reportbug <message>',
    examples: [
        '/reportbug The "bustin" command did not reply to me.'
    ],

    slashData: new SlashCommandBuilder()
        .setName('reportbug')
        .setDescription('Report a bug to the BustinBot dev team')
        .addStringOption(option =>
            option.setName('message')
                .setDescription('Include all relevant details about the bug here.')
                .setRequired(true)
        ) as SlashCommandBuilder,

    async execute({ interaction }: { interaction?: ChatInputCommandInteraction }) {
        if (!interaction) return;
        await interaction.deferReply({ flags: 1 << 6 });

        const messageText = interaction.options.getString('message');
        const devServerId = '1289517693313220699';
        const bugReportChannelName = 'bug-reports';

        try {
            const devGuild = await interaction.client.guilds.fetch(devServerId);
            let bugReportChannel = devGuild.channels.cache.find(
                (channel) => channel.isTextBased() && 'name' in channel && channel.name === bugReportChannelName
            );

            if (!bugReportChannel) {
                const channels = await devGuild.channels.fetch();
                bugReportChannel = channels.find(
                    (channel) => channel?.isTextBased() && 'name' in channel && channel.name === bugReportChannelName
                ) ?? undefined;
            }

            if (!bugReportChannel || !bugReportChannel.isTextBased()) {
                await interaction.editReply({ content: 'Bug report channel not found.', flags: 1 << 6 });
                return;
            }

            // Bug report functionality is simple and self-contained - were this to be made more robust, highly recommend defining Bug as a type and storing in DB
            const bugId = `BUG-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
            const timestamp = new Date().toISOString();
            const channelName = interaction.channel && 'name' in interaction.channel
                ? `#${interaction.channel.name}`
                : 'Unknown channel';
            const channelId = interaction.channel?.id ?? 'unknown';
            const reportContent = [
                '🐞 **New Bug Report** 🐞',
                `**Bug ID:** \`${bugId}\``,
                `**Timestamp:** ${timestamp}`,
                `**Reporter:** ${interaction.user.tag} (*${interaction.user.id}*)`,
                `**Server:** ${interaction.guild?.name} (*${interaction.guild?.id}*)`,
                `**Channel:** ${channelName} (*${channelId}*)`,
                `**Message:** ${messageText ?? ''}`
            ].join('\n');

            await (bugReportChannel as TextChannel).send({ content: reportContent });
            await interaction.editReply({ content: 'Bug report sent. Thank you!', flags: 1 << 6 });
        } catch (error) {
            console.error('Error sending message:', error);
            await interaction.editReply({ content: 'Failed to send message.', flags: 1 << 6 });
        }
    }
}

export default reportbug;
