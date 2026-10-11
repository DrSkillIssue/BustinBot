import { GatewayIntentBits, Partials, type ClientOptions } from 'discord.js';

// The events the bot receives from Discord. DMs arrive in channels discord.js hasn't cached, so the Channel partial
// lets them through.
export const clientOptions: ClientOptions = {
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Channel],
};
