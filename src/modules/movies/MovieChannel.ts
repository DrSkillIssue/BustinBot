import type { Client, TextChannel } from 'discord.js';
import type { ServiceContainer } from '../../core/services/ServiceContainer.js';
import { isTextChannel } from '../../utils/ChannelUtils.js';

export async function resolveMovieChannel(client: Client, services: ServiceContainer): Promise<TextChannel | null> {
    const guildConfig = await services.guilds.get(services.guildId);
    const channelId = guildConfig?.channels?.movieNight;
    const channel = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;
    if (!channel || !isTextChannel(channel)) {
        console.warn(`[MovieChannel] Movie night channel ${channelId || '(not set)'} not found for guild ${services.guildId}.`);
        return null;
    }
    return channel;
}
