const { REST, Routes, SlashCommandBuilder } = require("discord.js");
// Info needed for slash commands (so we don't have to use "!" before commands)
// Read environment variables from .env file
require("dotenv").config();
const botID = "1395532485676236911"; // Do not include serverID here
const botToken = process.env.BOT_TOKEN; // Your bot token here
// Make sure to keep your bot token secret and never share it with anyone!
// If you need to reset your token, go to https://discord.com/developers/applications and select your bot application.
// Then go to the "Bot" tab and click on "Reset Token" to generate a new token.
// Update the botToken variable with the new token after resetting it
// Incase the bot token is compromised, please reset it immediately so the bot doesn't give everyone admin permissions or something like that. (Or worse, nuke your server. Theres a security bot so that doesn't happen.)

const rest = new REST().setToken(botToken);
const slashRegister = async () => {
    try {
        await rest.put(Routes.applicationCommands(botID), {
            body: [
                new SlashCommandBuilder()
                    .setName("flagged-count")
                    .setDescription("Get the count of flagged users in the database"),
                new SlashCommandBuilder()
                    .setName("scan")
                    .setDescription("Scan the server for flagged users and ban them"),
                new SlashCommandBuilder()
                    .setName("add-flagged")
                    .setDescription("Add a user to the flagged users database > ONLY FOR OWNER")
                    .setIntegrationTypes(0, 1)
                    .setContexts(0, 1)
                    .addUserOption(option =>
                        option
                            .setName('user_id')
                            .setDescription('The ID of the user to add to the flagged list')
                            .setRequired(true)
                    )
                    .addStringOption(option =>
                        option
                            .setName('reason')
                            .setDescription('The reason for flagging the user')
                            .setRequired(false)
                    ),
                new SlashCommandBuilder()
                    .setName("userinfo")
                    .setDescription("Get information about a user")
                    .setIntegrationTypes(0, 1)
                    .setContexts(0, 1, 2)
                    .addUserOption(option =>
                        option
                            .setName('user')
                            .setDescription('The user to get information about')
                            .setRequired(true)
                    ),
                new SlashCommandBuilder()
                    .setName("getservers")
                    .setDescription("Get a list of servers the bot is in > ONLY FOR OWNER"),
                new SlashCommandBuilder()
                    .setName("leaveserver")
                    .setDescription("leave an unwanted server > ONLY FOR OWNER")
                    .addStringOption(option =>
                        option
                            .setName('server_id')
                            .setDescription('The ID of the server to leave')
                            .setRequired(true)
                    ),
                new SlashCommandBuilder()
                    .setName("flagged-users")
                    .setDescription("Get a list of flagged users in the database")
            ]
        });
        console.log("Successfully registered the slash commands globally");
    } catch (error) {
        console.error(error);
    }
};

slashRegister();

module.exports = { slashRegister };