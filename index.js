require('dotenv').config();
const { Client, GatewayIntentBits, Partials, ActivityType, EmbedBuilder, InteractionReplyOptions } = require('discord.js');
const { set } = require('forever/lib/forever/cli');
const fs = require('fs');

process.on('error', (err) => {
    throw new Error(`Uncaught error: ${err.message}`);
})

const raw = fs.readFileSync('./config.json', 'utf8');
console.log('Config file raw content:', raw); // Debug print
const config = require("./config.json");
console.log("Configuration loaded:", config); // Debug print
console.log("Official Server ID:", config.official_server_id); // Debug print
console.log("Flagged Server IDs:", config.flagged_server_ids); // Debug print
console.log("Modlog Channel ID:", config.modlog_channel_id); // Debug print
console.log("Flagged User IDs:", config.flagged_user_ids); // Debug print
console.log("There are " + config.flagged_user_ids.length + " flagged user IDs."); // Debug print

const OFFICIAL_SERVER_ID = config.official_server_id;
const FLAGGED_SERVER_IDS = config.flagged_server_ids;
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
    throw new ReferenceError('BOT_TOKEN is not set in .env file.');
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageReactions,
        GatewayIntentBits.DirectMessageTyping,
        GatewayIntentBits.GuildInvites
    ],
    partials: [Partials.GuildMember],
});

async function shutdown() {
    await client.Destroy();
}

process.on('SIGINT', shutdown)

const cff = require("./config.json");
const { exec } = require("child_process");

function run(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, (err, stdout, stderr) => {
            if (err) return reject(stderr);
            resolve(stdout.trim());
        });
    });
}

async function syncRepo() {
    if (!cff.GitHub) return null;
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

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    const guilds = client.guilds.cache;
    const status = { name: `🔨 Banning ${config.flagged_user_ids.length} people from ${guilds.size} servers`, type: 4, visibility: 'online' };
    client.user.setPresence({
        activities: [{
            name: status.name,
            type: status.type ?? ActivityType.Playing
        }],
        status: status.visibility
    })
});

client.on('ready', () => {
    fetchFlaggedMembersAndBan();
    fetchIIServerAndBan();
});

client.on('guildMemberAdd', async (member) => {
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
                                        await ownerdm.send(`# <a:urgent:1450268982736191508> URGENT!! <a:urgent:1450268982736191508>\nHello there, \n\n**${member.user.tag}** was found in your server. I wanted to ban them but they're a moderator/admin. Please take action accordingly.\n\nThank you! :heart:`)
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
                                        await ownerdm.send(`Hello, \n\n**${member.user.tag}** has been banned from your server, **${guild.name}**, as they are a member of a flagged server in our database. If you believe this is a mistake, please contact support.`)
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


async function fetchFlaggedMembersAndBan() {
    console.log('Fetching flagged members to ban...');
    try {
        // index everyones servers
        const guilds = await client.guilds.cache.values();
        // for each server check if any members are in the flagged list
        for (const guild of guilds) {
            await guild.members.fetch(); // fetch all members
            for (const userId of config.flagged_user_ids) {
                const member = guild.members.cache.get(userId); // get member by id
                if (member) {
                    const dmChannel = await member.createDM().catch(() => null);
                    if (member.id === member.guild.ownerId) {
                        // if member is owner of guild, dont ban and leave the server
                        console.log(`User ${member.user.tag} is the owner of the guild, not banning.`);
                        const dmChannel = await member.createDM().catch(() => null);
                        dmChannel.send(`Hello, \n\nI left your server, **${member.guild.name}**, because you are the owner and you are flagged. \n\nIf you believe this is a mistake, please contact support.`)
                        member.guild.leave();
                        console.log(`Left guild ${member.guild.name} because the flagged user is the owner.`);
                        continue;
                    }
                    if (!member.bannable) {
                        // if member is not bannable, skip and notify owner
                        console.log(`Cannot ban user ${member.user.tag}, insufficient permissions.`);
                        const owner = await guild.fetchOwner();
                        const ownerdm = await owner.createDM().catch(() => null);
                        try {
                            await ownerdm.send(`# <a:urgent:1450268982736191508> URGENT!! <a:urgent:1450268982736191508>\nHello there, \n\n**${member.user.tag}** was found in your server. I wanted to ban them but they're a moderator/admin. Please take action accordingly.\n\nThank you! :heart:`)
                        } catch (err) {
                            console.error('Error sending DM to server owner:', err?.rawError.message || err);
                        }
                        continue;
                    }
                    if (dmChannel) {
                        // sends a dm to the user being banned before banning them
                        try {
                            await dmChannel.send(`You have been banned from ${guild.name} due to being a flagged user in our database. If you believe this is a mistake, please contact support.`);
                            await console.log(`Sent DM to banned user ${member.user.tag}`);
                        } catch (err) {
                            console.error('Error sending DM to banned user:', err?.rawError.message || err);
                        }
                    }
                    console.log(`Found flagged user ${member.user.tag} in ${member.guild.name}, proceeding to ban.`);
                    await member.ban({ reason: 'Gorilla tag copy participant that is flagged in our database' });
                    console.log(`Banned user ${member.user.tag} as they are flagged in config.json`);
                    const owner = await guild.fetchOwner();
                    const ownerdm = owner.createDM().catch(() => null);
                    try {
                        await ownerdm.send(`Hello, \n\n**${member.user.tag}** has been banned from your server, **${guild.name}**, as they are flagged in our database. If you believe this is a mistake, please contact support.`)
                    } catch (err) {
                        console.error('Error sending DM to server owner:', err?.rawError.message || err);
                    }

                    return; // Exit after banning one user
                }
            }
            for (const member of guild.members.cache.values()) {
                for (const clan of config.flagged_server_ids) {

                    console.log(member.user);

                    if (member.user.primaryGuild.identityGuildId == clan) {
                        const dmChannel = await member.createDM().catch(() => null);
                        if (member.id === member.guild.ownerId) {
                            // if member is owner of guild, dont ban and leave the server
                            console.log(`User ${member.user.tag} is the owner of the guild, not banning.`);
                            const dmChannel = await member.createDM().catch(() => null);
                            dmChannel.send(`Hello, \n\nI left your server, **${member.guild.name}**, because you are the owner and you are flagged. \n\nIf you believe this is a mistake, please contact support.`)
                            member.guild.leave();
                            console.log(`Left guild ${member.guild.name} because the flagged user is the owner.`);
                            continue;
                        }
                        if (!member.bannable) {
                            // if member is not bannable, skip and notify owner
                            console.log(`Cannot ban user ${member.user.tag}, insufficient permissions.`);
                            const owner = await guild.fetchOwner();
                            const ownerdm = await owner.createDM().catch(() => null);
                            try {
                                await ownerdm.send(`# <a:urgent:1450268982736191508> URGENT!! <a:urgent:1450268982736191508>\nHello there, \n\n**${member.user.tag}** was found in your server. I wanted to ban them but they're a moderator/admin. Please take action accordingly.\n\nThank you! :heart:`)
                            } catch (err) {
                                console.error('Error sending DM to server owner:', err?.rawError.message || err);
                            }
                            continue;
                        }
                        if (dmChannel) {
                            try {
                                await dmChannel.send(`You have been banned from ${guild.name} because your Server Tag is blacklisted.`)
                                console.log(`Sent DM to banned user ${member.displayName}`)
                            } catch (e) { }
                        }

                        await member.ban("Server Tag is blacklisted");

                        const owner = await guild.fetchOwner();
                        const ownerdm = owner.createDM().catch(() => null);

                        try {
                            await ownerdm.send(`Hello, \n\n**${member.user.tag}** has been banned from your server, **${guild.name}**, as their Server Tag is blacklisted. If you believe this is a mistake, please contact support.`)
                        } catch (err) {
                            console.error('Error sending DM to server owner:', err?.rawError.message || err);
                        }

                        return;
                    }
                }
            }
        }
        // if no flagged members found
        return console.log('No more flagged members found in the server.');
    } catch (error) { console.error('Error fetching flagged members:', error); } // outer try-catch
}

// --- COMMANDS CMDS ---

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    try {
        if (interaction.commandName === 'flagged-count') {
            await interaction.reply(`There are currently ${config.flagged_user_ids.length} flagged users in the database.`);
        }
        if (interaction.commandName === 'scan') {
            if (!interaction.member.permissions.has('Administrator')) {
                await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
                return;
            }
            interaction.deferReply({ ephemeral: true })
            console.log('Fetching flagged members to ban...');
            try {
                // index everyones servers
                const guilds = await client.guilds.cache.values();
                // for each server check if any members are in the flagged list
                for (const guild of guilds) {
                    await guild.members.fetch(); // fetch all members
                    for (const userId of config.flagged_user_ids) {
                        const member = guild.members.cache.get(userId); // get member by id
                        if (member) {
                            const dmChannel = await member.createDM().catch(() => null);
                            if (member.id === member.guild.ownerId) {
                                // if member is owner of guild, dont ban and leave the server
                                console.log(`User ${member.user.tag} is the owner of the guild, not banning.`);
                                const dmChannel = await member.createDM().catch(() => null);
                                dmChannel.send(`Hello, \n\nI left your server, **${member.guild.name}**, because you are the owner and you are flagged. \n\nIf you believe this is a mistake, please contact support.`)
                                member.guild.leave();
                                console.log(`Left guild ${member.guild.name} because the flagged user is the owner.`);
                                continue;
                            }
                            if (!member.bannable) {
                                // if member is not bannable, skip and notify owner
                                console.log(`Cannot ban user ${member.user.tag}, insufficient permissions.`);
                                const embed = new EmbedBuilder()
                                    .setColor('Red')
                                    .setDescription(`<a:urgent:1450268982736191508> **Cannot ban ${member.user.displayName}, insufficient permissions.**`);
                                interaction.followUp({ embeds: [embed] });
                                const owner = await guild.fetchOwner();
                                const ownerdm = await owner.createDM().catch(() => null);
                                try {
                                    await ownerdm.send(`# <a:urgent:1450268982736191508> URGENT!! <a:urgent:1450268982736191508>\nHello there, \n\n**${member.user.tag}** was found in your server. I wanted to ban them but they're a moderator/admin. Please take action accordingly.\n\nThank you! :heart:`)
                                } catch (err) {
                                    console.error('Error sending DM to server owner:', err?.rawError.message || err);
                                }
                                continue;
                            }
                            if (dmChannel) {
                                // sends a dm to the user being banned before banning them
                                try {
                                    await dmChannel.send(`You have been banned from ${guild.name} due to being a flagged user in our database. If you believe this is a mistake, please contact support.`);
                                    await console.log(`Sent DM to banned user ${member.user.tag}`);
                                } catch (err) {
                                    console.error('Error sending DM to banned user:', err?.rawError.message || err);
                                }
                            }
                            // replying fails, so not replying
                            console.log(`Found flagged user ${member.user.tag} in ${member.guild.name}, proceeding to ban.`);
                            await member.ban({ reason: 'Gorilla tag copy participant that is flagged in our database' });
                            console.log(`Banned user ${member.user.tag} as they are flagged in config.json`);
                            const owner = await guild.fetchOwner();
                            const ownerdm = owner.createDM().catch(() => null);
                            try {
                                await ownerdm.send(`Hello, \n\n**${member.user.tag}** has been banned from your server, **${guild.name}**, as they are flagged in our database. If you believe this is a mistake, please contact support.`)
                            } catch (err) {
                                console.error('Error sending DM to server owner:', err?.rawError.message || err);
                            }
                            return; // Exit after banning one user
                        }
                    }
                }
                // if no flagged members found
                const embed = new EmbedBuilder()
                    .setColor('Green')
                    .setDescription("<:check:1450916271183888385> **No more flagged members found in the server.**");
                interaction.followUp({ embeds: [embed], ephemeral: true });
                console.log('No more flagged members found in the server.');
                return;
            } catch (error) {
                console.error('Error fetching flagged members:', error);
                if (error.code === "GuildMembersTimeout") {
                    const embed = new EmbedBuilder()
                        .setColor('Red')
                        .setDescription("<a:urgent:1450268982736191508> **Members didn't arrive on time.**");
                    interaction.followUp({ embeds: [embed] });
                } else {
                    const embed = new EmbedBuilder()
                        .setColor('Red')
                        .setDescription("<a:urgent:1450268982736191508> **An error occurred.**");
                    interaction.followUp({ embeds: [embed] });
                }
            } // outer try-catch
        }
        if (interaction.commandName === 'add-flagged') {
            if (interaction.user.id !== '804839205309382676') return interaction.reply('You do not have permission to use this command.');
            const userIdToAdd = interaction.options.getUser('user_id');
            if (config.flagged_user_ids.includes(userIdToAdd.id)) {
                return interaction.reply({ content: `${userIdToAdd.displayName} is already flagged.`, InteractionReplyOptions: { ephemeral: true } });
            } else {
                config.flagged_user_ids.push(userIdToAdd.id); // try to not delete existing ids
                fs.writeFileSync('./config.json', JSON.stringify(config, null, 4));
                return interaction.reply({ content: `${userIdToAdd.displayName} has been added to the flagged list. There are now ${config.flagged_user_ids.length} flagged users.`, InteractionReplyOptions: { ephemeral: true } });
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
                    { name: 'Is Flagged', value: config.flagged_user_ids.includes(user.id) ? 'Yes' : 'No', inline: true },
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
            await interaction.deferReply({ ephemeral: true });
            // make dm channel with user
            const dm = await interaction.user.createDM();
            if (!dm) {
                return interaction.reply({ content: 'Could not create DM channel.', ephemeral: true });
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
                await interaction.followUp({ content: 'Sent you a DM with the list of servers!', ephemeral: true });
            } catch (err) {
                console.error('Error sending DM to user:', err?.rawError.message || err);
                return interaction.followUp({ content: 'Could not send you a DM. Do you have DMs disabled?', ephemeral: true });
            }
        }
        if (interaction.commandName === 'leaveserver') {
            if (interaction.user.id !== '804839205309382676') {
                // if it isnt me than dont execute
                return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
            }
            await interaction.deferReply({ ephemeral: true });
            const serverId = interaction.options.getString('server_id');
            const guild = client.guilds.cache.get(serverId);
            if (!guild) {
                return interaction.followUp({ content: 'Bot is not in a server with that ID.', ephemeral: true });
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
            return interaction.followUp({ content: `Left the server: ${guild.name}`, ephemeral: true });
        }
    } catch (error) {
        console.error('Error handling interaction:', error);
        if (interaction.deferred || interaction.replied) {
            return interaction.followUp({ content: 'An error occurred while processing the command.', ephemeral: true });
        }
        return interaction.reply({ content: 'An error occurred while processing the command.', ephemeral: true });
    }
});

// /--- COMMANDS CMDS ---

client.login(BOT_TOKEN);
