require('dotenv').config();
const { Client, GatewayIntentBits, Partials, ActivityType, EmbedBuilder, CommandInteraction, User } = require('discord.js');
const { set } = require('forever/lib/forever/cli');
const fs = require('fs');

process.on('error', (err) => {
    throw new Error(`Uncaught error: ${err.message}`);
});

const raw = fs.readFileSync('./config.json', 'utf8');
console.log('Config file raw content:', raw); // Debug print
const config = require('./config.json');
console.log("Configuration loaded:", config); // Debug print
console.log("Official Server ID:", config.official_server_id); // Debug print
console.log("Flagged Server IDs:", config.flagged_server_ids); // Debug print
console.log("Modlog Channel ID:", config.modlog_channel_id); // Debug print
console.log("Flagged User IDs:", config.flagged_user_ids); // Debug print
console.log("There are " + Object.keys(config.flagged_user_ids).length + " flagged user IDs."); // Debug print

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
    throw new ReferenceError('BOT_TOKEN is not set in .env file.');
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences
    ],
    partials: [
        Partials.Message,
        Partials.Channel
    ],
});

async function shutdown() {
    await client.Destroy();
}

process.on('SIGINT', shutdown);

const cff = require("./config.json");
const { exec } = require("child_process");

function run(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, (err, stdout, stderr) => {
            if (err) {return reject(stderr);}
            resolve(stdout.trim());
        });
    });
}

async function syncRepo() {
    if (!cff.GitHub) {return null;}
    try {
        console.log("Checking remote changes...");

        await run("git fetch");

        const local = await run("git rev-parse HEAD");
        const remote = await run("git rev-parse @{u}");

        if (local !== remote) {
            console.log("Remote updates found. Pulling...");
            await run("git pull");
            process.exit(0);
        } else {
            console.log("Repo already up to date.");
        }

        console.log("Checking local changes...");

        const status = await run("git status --porcelain");

        if (status) {
            console.log("Local changes detected. Committing and pushing...");

            await run("git add .");
            await run(`git commit -m "Auto commit from bot"`);
            await run("git push");

            console.log("Changes pushed to GitHub.");
        } else {
            console.log("No local changes.");
        }

    } catch (err) {
        console.error("Git sync error:", err);
    }
}

syncRepo();

setInterval(syncRepo, 1 * 60 * 1000); // every 1 minute

client.once('clientReady', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    const guilds = client.guilds.cache;
    const status = { name: `🔨 Banning ${Object.keys(config.flagged_user_ids).length} people from ${guilds.size} servers`, type: 4, visibility: 'online' };
    const { slashRegister } = require('./slash-deploy.js');
    await slashRegister();
    client.user.setPresence({
        activities: [{
            name: status.name,
            type: status.type ?? ActivityType.Playing
        }],
        status: status.visibility
    });
});

client.on('ready', () => {
    fetchFlaggedMembersAndBan();
    fetchIIServerAndBan();
});

client.on('guildMemberAdd', async () => {
    fetchFlaggedMembersAndBan();
});

async function fetchIIServerAndBan() {
    console.log("Looking up flagged server(s)...");
    try {
        for (const SERVER of config.flagged_server_ids) {
            try {
                // Send a GET request to the Discord API to get the server widget for ii's server and ban any members that are found in that server
                const response = await fetch(`https://discord.com/api/guilds/${SERVER}/widget.json`);
                if (!response.ok) {
                    if (response.status === 404) {
                        console.warn(`Skipping server with ID ${SERVER} because it has been banned or deleted.`);
                        continue;
                    } else if (response.status === 403) {
                        console.warn(`Skipping server with ID ${SERVER} because server widget is disabled.`);
                        continue;
                    } else {
                        throw new Error(`Failed to fetch server widget for server ID ${SERVER}. Status: ${response.status} ${response.statusText}`);
                    }
                }

                const data = await response.json();
                const members = data.members || [];
                console.log(`Found ${members.length} members in server widget for server ID ${SERVER}.`);

                for (const widgetMember of members) {
                    const user = widgetMember.username;
                    if (!user) {
                        console.log(`Could not fetch user with ID ${widgetMember.user.id}, skipping.`);
                        continue;
                    }
                    console.log("Scanning for " + user + " in all guilds... (" + widgetMember.id + "/" + members.length + ")");
                    const guilds = await client.guilds.cache.values();
                    for (const guild of guilds) {
                        try {
                            const membersList = await guild.members.fetch({ limit: 1000 });
                            const member = membersList.find(m => m.user.displayName === user);
                            if (member) {
                                if (member.user.bot) {
                                    console.log(`User ${member.user.tag} is a bot, skipping.`);
                                    continue;
                                }
                                if (!member.bannable) {
                                    console.log(`Cannot ban user ${member.user.tag}, insufficient permissions.`);
                                    const owner = await guild.fetchOwner();
                                    const ownerdm = await owner.createDM().catch(() => null);
                                    try {
                                        await ownerdm.send(`# <a:urgent:1450268982736191508> URGENT!! <a:urgent:1450268982736191508>\nHello there, \n\n**${member.user.tag}** was found in your server. I wanted to ban them but they're a moderator/admin. Please take action accordingly.\n\nThank you! :heart:`);
                                    }
                                    catch (err) {
                                        console.error('Error sending DM to server owner:', err?.rawError.message || err);
                                    }
                                }
                                const dmChannel = await member.createDM().catch(() => null);
                                if (dmChannel) {
                                    try {
                                        await dmChannel.send(`You have been banned from ${guild.name} due to being a member of a flagged server in our database. If you believe this is a mistake, please contact support.`);
                                        await console.log(`Sent DM to banned user ${member.user.tag}`);
                                    } catch (err) {
                                        console.error('Error sending DM to banned user:', err?.rawError.message || err);
                                    }

                                    console.log(`Found user ${member.user.tag} in ${member.guild.name} who is in the flagged server, proceeding to ban.`);
                                    await member.ban({ reason: 'Member of a flagged server in our database' });
                                    console.log(`Banned user ${member.user.tag} as they are in the flagged server with ID ${SERVER}`);
                                    const owner = await guild.fetchOwner();
                                    const ownerdm = owner.createDM().catch(() => null);
                                    try {
                                        await ownerdm.send(`Hello, \n\n**${member.user.tag}** has been banned from your server, **${guild.name}**, as they are a member of a flagged server in our database. If you believe this is a mistake, please contact support.`);
                                    } catch (err) {
                                        console.error('Error sending DM to server owner:', err?.rawError.message || err);
                                    }
                                    continue; // Exit after banning one user
                                }
                            }
                        } catch (err) {
                            console.error(`Error processing guild ${guild.name} for user ${user}:`, err);
                            continue; // Continue to the next guild if there's an error with this one
                        }
                    }
                }
            } catch (error) {
                console.error(`Error processing server ID ${SERVER}:`, error);
                continue; // Continue to the next server if there's an error with this one
            }
            continue;
        }
        console.log("Finished processing flagged servers.");
    } catch (error) {
        console.error('Error fetching server widget or banning users:', error);
    }
}

/**
 * Looks up a discord user by their ID using the Discord API. Only has:
 * - id
 * - username
 * - discriminator
 * - displayName
 * - avatarURL
 * - bot (boolean)
 * - createdAt (Date object)
 * and nothing else cause it requires the bot to also be in the server of the user to get more info.
 * @param {string} userId 
 * @returns {User|null} user object or null if not found
 */
async function lookUpUserUsingAPI(userId) {
    try {
        const response = await fetch(`https://discord.com/api/v10/users/${userId}`, {
            headers: {
                'Authorization': `Bot ${BOT_TOKEN}`
            }
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch user with ID ${userId}. Status: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        return {
            id: data.id,
            username: data.username,
            discriminator: data.discriminator,
            displayName: data.username, // The API doesn't return displayName, so we'll just use username here
            avatarURL: `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png?size=1024`,
            banner: data.banner,
            bot: data.bot || false,
            createdAt: new Date(data.created_at),
            clan: data.clan,
            primary_guild: data.primary_guild
        };
    } catch (error) {
        console.error(`Error looking up user with ID ${userId}:`, error);
        return null;
    }
}

/**
 * 
 * @param {CommandInteraction} interaction 
 * @returns true or false
 */
async function fetchFlaggedMembersAndBan(interaction = null) {
    console.log('Fetching flagged members to ban...');
    try {
        const guilds = client.guilds.cache.values();
        for (const guild of guilds) {
            await guild.members.fetch();
            for (const [userId, reasonForFlag] of Object.entries(config.flagged_user_ids)) {
                const member = guild.members.cache.get(userId);
                if (!member) { continue; }
                if (member.user.bot) { continue; }

                if (config['per-server-settings'][guild.name.toLowerCase().replace(/ /g, '_').replace('(', '').replace(')', '').replace('|', '')]?.banGtCopyUsers === false && reasonForFlag.toString().toLowerCase().includes('copy')) {
                    console.log(`[${guild.name}] not banning ${member.user.displayName} because banGtCopyUsers is disabled.`);
                    continue;
                }
                if (config['per-server-settings'][guild.name.toLowerCase().replace(/ /g, '_').replace('(', '').replace(')', '').replace('|', '')]?.banCheaters === false && reasonForFlag.toString().toLowerCase().includes('cheater')) {
                    console.log(`[${guild.name}] not banning ${member.user.displayName} because banCheaters is disabled.`);
                    continue;
                }

                const dmChannel = await member.createDM().catch(() => null);
                if (member.id === member.guild.ownerId) {
                    console.log(`User ${member.user.displayName} is the owner of the guild, not banning.`);
                    const ownerDm = await member.createDM().catch(() => null);
                    if (ownerDm) {
                        ownerDm.send(`Hello, \n\nI left your server, **${member.guild.name}**, because you are the owner and you are flagged. \n\nIf you believe this is a mistake, please contact support.`).catch(() => null);
                    }
                    member.guild.leave();
                    console.log(`Left guild ${member.guild.name} because the flagged user is the owner.`);
                    continue;
                }
                if (!member.bannable) {
                    console.log(`Cannot ban user ${member.user.displayName}, insufficient permissions.`);
                    const owner = await guild.fetchOwner();
                    const ownerdm = await owner.createDM().catch(() => null);
                    try {
                        await ownerdm.send(`# <a:urgent:1450268982736191508> URGENT!! <a:urgent:1450268982736191508>\nHello there, \n\n**${member.user.displayName}** was found in your server. I wanted to ban them but they're a moderator/admin. Please take action accordingly.\n\nThank you! :heart:`);
                    } catch (err) {
                        console.error('Error sending DM to server owner:', err?.rawError?.message || err);
                    }
                    continue;
                }
                if (dmChannel) {
                    try {
                        await dmChannel.send(`You have been banned from ${guild.name} due to being a flagged user in our database. If you believe this is a mistake, please contact support.`);
                        console.log(`Sent DM to banned user ${member.user.displayName}`);
                    } catch (err) {
                        console.error('Error sending DM to banned user:', err?.rawError?.message || err);
                    }
                }
                console.log(`Found flagged user ${member.user.displayName} in ${member.guild.name}, proceeding to ban.`);
                await member.ban({ reason: 'Flagged user in our database: ' + reasonForFlag });
                console.log(`Banned user ${member.user.displayName} as they are flagged in config.json`);
                const owner = await guild.fetchOwner();
                const ownerdm = owner.createDM().catch(() => null);
                try {
                    await ownerdm.send(`Hello, \n\n**${member.user.displayName}** has been banned from your server, **${guild.name}**, as they are flagged in our database. If you believe this is a mistake, please contact support.`);
                } catch (err) {
                    console.error('Error sending DM to server owner:', err?.rawError?.message || err);
                }
                if (interaction) {
                    const embed = new EmbedBuilder()
                        .setColor('Green')
                        .setDescription(`<:check:1450916271183888385> Banned user ${member.user.displayName} as they are flagged in our database.`);
                    interaction.editReply({ content: '', embeds: [embed] });
                }
                return true;
            }
            for (const member of guild.members.cache.values()) {
                for (const clan of config.flagged_server_ids) {
                    if (!member.user.primaryGuild) { continue; }
                    if (member.user.bot) { continue; }

                    if (member.user.primaryGuild.identityGuildId === clan) {
                        const dmChannel = await member.createDM().catch(() => null);
                        if (member.id === member.guild.ownerId) {
                            console.log(`User ${member.user.tag} is the owner of the guild, not banning.`);
                            const ownerDm = await member.createDM().catch(() => null);
                            if (ownerDm) {
                                ownerDm.send(`Hello, \n\nI left your server, **${member.guild.name}**, because you are the owner and you are flagged. \n\nIf you believe this is a mistake, please contact support.`).catch(() => null);
                            }
                            member.guild.leave();
                            console.log(`Left guild ${member.guild.name} because the flagged user is the owner.`);
                            continue;
                        }
                        if (!member.bannable) {
                            console.log(`Cannot ban user ${member.user.tag}, insufficient permissions.`);
                            const owner = await guild.fetchOwner();
                            const ownerdm = await owner.createDM().catch(() => null);
                            try {
                                await ownerdm.send(`# <a:urgent:1450268982736191508> URGENT!! <a:urgent:1450268982736191508>\nHello there, \n\n**${member.user.tag}** was found in your server. I wanted to ban them but they're a moderator/admin. Please take action accordingly.\n\nThank you! :heart:`);
                            } catch (err) {
                                console.error('Error sending DM to server owner:', err?.rawError?.message || err);
                            }
                            continue;
                        }
                        if (dmChannel) {
                            try {
                                await dmChannel.send(`You have been banned from ${guild.name} because your Server Tag is blacklisted.`);
                                console.log(`Sent DM to banned user ${member.displayName}`);
                            } catch (e) { }
                        }
                        await member.ban('Server Tag is blacklisted');
                        const owner = await guild.fetchOwner();
                        const ownerdm = owner.createDM().catch(() => null);
                        try {
                            await ownerdm.send(`Hello, \n\n**${member.user.tag}** has been banned from your server, **${guild.name}**, as their Server Tag is blacklisted. If you believe this is a mistake, please contact support.`);
                        } catch (err) {
                            console.error('Error sending DM to server owner:', err?.rawError?.message || err);
                        }
                        if (interaction) {
                            const embed = new EmbedBuilder()
                                .setColor('Green')
                                .setDescription(`<:check:1450916271183888385> **Banned user ${member.user.tag} because their Server Tag is blacklisted.**`);
                            interaction.editReply({ content: '', embeds: [embed] });
                        }
                        return true;
                    }
                }
            }
        }
        if (interaction) {
            const embed = new EmbedBuilder()
                .setColor('Green')
                .setDescription('<:check:1450916271183888385> **No more flagged members found in the server.**');
            interaction.editReply({ content: '', embeds: [embed], ephemeral: true });
        } else {
            console.log('No more flagged members found in the server.');
        }
        return false;
    } catch (error) {
        console.error('Error fetching flagged members:', error);
        if (interaction) {
            const embed = new EmbedBuilder()
                .setColor('Red')
                .setDescription('<a:urgent:1450268982736191508> **An error occurred while scanning for flagged members.**');
            interaction.editReply({ content: '', embeds: [embed], ephemeral: true });
        }
        return false;
    }
}

// --- COMMANDS CMDS ---

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) {return;}
    try {
        if (config.flagged_user_ids[interaction.user.id]) { return interaction.reply({ content: 'You are flagged in the database for: ' + config.flagged_user_ids[interaction.user.id] + " and cannot interact with this bot.", ephemeral: true }); }
        if (interaction.commandName === 'flagged-count') {
            await interaction.reply(`There are currently ${Object.keys(config.flagged_user_ids).length} flagged users in the database.`);
        }
        if (interaction.commandName === 'scan') {
            if (!interaction.member.permissions.has('Administrator')) {
                await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
                return;
            }
            await interaction.reply({ content: '<a:Searching:1494438509233307718> Scanning for flagged members...', ephemeral: true });
            await fetchFlaggedMembersAndBan(interaction);
            return;
        }
        if (interaction.commandName === 'add-flagged') {
            if (interaction.user.id !== '804839205309382676') {return interaction.reply('You do not have permission to use this command.');}
            const userIdToAdd = interaction.options.getUser('user_id');
            const reason = interaction.options.getString('reason') || 'No reason given.';
            if (config.flagged_user_ids.hasOwnProperty(userIdToAdd.id)) {
                const currentReason = config.flagged_user_ids[userIdToAdd.id];
                if (currentReason !== reason) {
                    config.flagged_user_ids[userIdToAdd.id] = reason;
                    fs.writeFileSync('./config.json', JSON.stringify(config, null, 4));
                    return interaction.reply({ content: `${userIdToAdd.displayName} is already flagged, but the reason has been updated to: ${reason}`, ephemeral: true });
                } else {
                    return interaction.reply({ content: `${userIdToAdd.displayName} is already flagged with that reason.`, ephemeral: true });
                }
            } else {
                config.flagged_user_ids[userIdToAdd.id] = reason;
                fs.writeFileSync('./config.json', JSON.stringify(config, null, 4));
                return interaction.reply({ content: `${userIdToAdd.displayName} has been added to the flagged list. There are now ${Object.keys(config.flagged_user_ids).length} flagged users.`, ephemeral: true });
            }
        }
        if (interaction.commandName === 'userinfo') {
            const user = interaction.options.getUser('user');
            if (!user) {
                return interaction.reply({ content: 'User not found.', ephemeral: true });
            }
            const embed = {
                color: 0x0099ff,
                title: `${user.displayName || user.username}'s info`,
                thumbnail: { url: user.displayAvatarURL({ dynamic: true }) },
                fields: [
                    { name: 'ID', value: user.id, inline: true },
                    { name: 'Username', value: user.username, inline: true },
                    { name: 'Created At', value: user.createdAt.toDateString(), inline: true },
                    { name: 'Mention', value: `<@${user.id}>`, inline: true },
                    { name: 'Is Flagged', value: config.flagged_user_ids[user.id] ? 'Yes' : 'No', inline: true },
                    { name: 'Reason for flagging (if flagged)', value: config.flagged_user_ids[user.id] || 'N/A', inline: true }
                ],
                timestamp: new Date(),
                footer: { text: 'User Info', icon_url: client.user.displayAvatarURL() },
            };
            await interaction.reply({ embeds: [embed] });
        }
        if (interaction.commandName === 'getservers') {
            if (interaction.user.id !== '804839205309382676') {
                return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
            }
            await interaction.reply({ content: '<a:Searching:1494438509233307718> Fetching flagged users...', ephemeral: true });
            // make dm channel with user
            const dm = await interaction.user.createDM();
            if (!dm) {
                return interaction.editReply({ content: '<a:urgent:1450268982736191508> Could not create DM channel.', ephemeral: true });
            }
            // so this is basically a command that gets all the servers the bot is in and sends it to the user in a DM (only an invite link)
            const guilds = client.guilds.cache;
            let reply = `The bot is currently in ${guilds.size} servers:\n\n`;
            for (const [guildId, guild] of guilds) {
                const invite = await guild.channels.cache
                    .filter(c => c.type === 0 && c.permissionsFor(guild.members.me).has('CreateInstantInvite'))
                    .first()
                    ?.createInvite({ maxAge: 0, maxUses: 0, unique: true })
                    .catch(() => null);
                reply += `**${guild.name}** (ID: ${guildId}) - Invite: ${invite ? invite.url : 'No invite available'}\n`;
            }
            try {
                await dm.send(reply);
                await interaction.editReply({ content: '<:check:1450916271183888385> Sent you a DM with the list of servers!', ephemeral: true });
            } catch (err) {
                console.error('Error sending DM to user:', err?.rawError.message || err);
                return interaction.editReply({ content: '<a:urgent:1450268982736191508> Could not send you a DM. Do you have DMs disabled?', ephemeral: true });
            }
        }
        if (interaction.commandName === 'leaveserver') {
            if (interaction.user.id !== '804839205309382676') {
                // if it isnt me than dont execute
                return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
            }
            await interaction.reply({ content: '<a:UnknownLoading:1494440425036058664> Leaving server...', ephemeral: true });
            const serverId = interaction.options.getString('server_id');
            const guild = client.guilds.cache.get(serverId);
            if (!guild) {
                return interaction.editReply({ content: 'Bot is not in a server with that ID.', ephemeral: true });
            }
            // create a dm channel with the server owner (the one that the bot is leaving)
            const owner = await guild.fetchOwner();
            const dm = await owner.createDM();
            if (dm) {
                try {
                    await dm.send(`Hey, sorry for the bad news. I am leaving your server ${guild.name} because Juler (my owner) told me to. If you have any questions, please contact him.`);
                } catch (err) {
                    console.error('Error sending DM to server owner:', err?.rawError.message || err);
                }
            }
            console.log(`Leaving server: ${guild.name} (ID: ${guild.id})`);
            await guild.leave();
            return interaction.editReply({ content: `<:check:1450916271183888385> Left the server: ${guild.name}`, ephemeral: true });
        }
        if (interaction.commandName === 'flagged-users') { 
            // Everyone can use this command
            await interaction.reply({ content: '<a:Searching:1494438509233307718> Fetching flagged users...', ephemeral: true });
            if (Object.keys(config.flagged_user_ids).length === 0) {
                return interaction.editReply({ content: '<a:urgent:1450268982736191508> There are currently no flagged users in the database.', ephemeral: true });
            }
            let currentMessage = '';
            const entries = Object.entries(config.flagged_user_ids);
            const total = entries.length;
            const startTime = Date.now();
            for (let i = 0; i < entries.length; i++) {
                const [userId, reason] = entries[i];
                let user = await lookUpUserUsingAPI(userId);
                while (!user) { user = await lookUpUserUsingAPI(userId); }
                const userName = user?.displayName || user?.username || 'Unknown User';
                const line = `${user?.displayName ? 'Name' : 'Username'}: ${userName} - Reason: ${reason}\n`;
                currentMessage += line;
                const elapsed = (Date.now() - startTime) / 1000;
                const avgPerUser = elapsed / (i + 1);
                const remaining = Math.ceil(avgPerUser * (total - i - 1));
                const etaText = remaining > 0 ? ` (~${remaining}s remaining)` : '';
                await interaction.editReply({ content: `<a:Searching:1494438509233307718> Fetching flagged users... (${i + 1}/${total})${etaText}`, ephemeral: true });
            }
            if (currentMessage) {
                fs.writeFileSync('./flagged_users_list.txt', currentMessage);
                await interaction.editReply({ content: "<:check:1450916271183888385> Here is the file with the flagged users:", ephemeral: true, files: [{ attachment: './flagged_users_list.txt', name: 'flagged_users_list.txt' }] });
                fs.unlinkSync('./flagged_users_list.txt');
            }
        }
    } catch (error) {
        console.error('Error handling interaction:', error);
        if (interaction.deferred || interaction.replied) {
            return interaction.editReply({ content: '<a:urgent:1450268982736191508> An error occurred while processing the command.', ephemeral: true });
        }
        return interaction.reply({ content: 'An error occurred while processing the command.', ephemeral: true });
    }
});

// /--- COMMANDS CMDS ---

client.login(BOT_TOKEN);
