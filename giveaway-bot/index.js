require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    EmbedBuilder,
    PermissionFlagsBits
} = require("discord.js");

const config = require("./config.json");
const db = require("./database");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds
    ]
});

function parseDuration(input) {
    if (!input) {
        return null;
    }

    const value = input.trim().toLowerCase();

    const match = value.match(/^(\d+)\s*(m|h|d|w)$/);

    if (!match) {
        return null;
    }

    const number = Number(match[1]);

    if (number <= 0) {
        return null;
    }

    const unit = match[2];

    let seconds;

    switch (unit) {
        case "m":
            seconds = number * 60;
            break;

        case "h":
            seconds = number * 60 * 60;
            break;

        case "d":
            seconds = number * 60 * 60 * 24;
            break;

        case "w":
            seconds = number * 60 * 60 * 24 * 7;
            break;

        default:
            return null;
    }

    if (seconds < 60) {
        return null;
    }

    if (seconds > 604800) {
        return null;
    }

    return seconds;
}

const commands = [

    new SlashCommandBuilder()
        .setName("setup-giveaway")
        .setDescription(
            "Set the role allowed to create and manage giveaways."
        )
        .addRoleOption(option =>
            option
                .setName("staff_role")
                .setDescription(
                    "The role allowed to create and manage giveaways."
                )
                .setRequired(true)
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageGuild
        )
        .toJSON(),

    new SlashCommandBuilder()
        .setName("giveaway")
        .setDescription(
            "Create a Robux giveaway"
        )
        .addIntegerOption(option =>
            option
                .setName("robux")
                .setDescription(
                    "Amount of Robux"
                )
                .setRequired(true)
                .setMinValue(1)
        )
        .addStringOption(option =>
            option
                .setName("duration")
                .setDescription(
                    "Example: 1m, 2h, 1d, 1w"
                )
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName("winners")
                .setDescription(
                    "Number of winners"
                )
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(20)
        )
        .addBooleanOption(option =>
            option
                .setName("ping")
                .setDescription(
                    "Ping @everyone?"
                )
                .setRequired(true)
        )
        .toJSON(),

    new SlashCommandBuilder()
        .setName("specialgiveaway")
        .setDescription(
            "Create a Robux giveaway for a specific role."
        )
        .addIntegerOption(option =>
            option
                .setName("robux")
                .setDescription(
                    "Amount of Robux"
                )
                .setRequired(true)
                .setMinValue(1)
        )
        .addStringOption(option =>
            option
                .setName("duration")
                .setDescription(
                    "Example: 1m, 2h, 1d, 1w"
                )
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName("winners")
                .setDescription(
                    "Number of winners"
                )
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(20)
        )
        .addBooleanOption(option =>
            option
                .setName("ping")
                .setDescription(
                    "Ping @everyone?"
                )
                .setRequired(true)
        )
        .addRoleOption(option =>
            option
                .setName("special_role")
                .setDescription(
                    "The role allowed to join this giveaway."
                )
                .setRequired(true)
        )
        .toJSON()
];

async function registerCommands() {

    const rest = new REST({
        version: "10"
    }).setToken(
        process.env.GIVEAWAY_BOT_TOKEN
    );

    try {

        console.log(
            "🔄 Registering commands..."
        );

        await rest.put(
            Routes.applicationCommands(
                config.clientId
            ),
            {
                body: commands
            }
        );

        console.log(
            "✅ Global commands registered!"
        );

        for (
            const [guildId, guild]
            of client.guilds.cache
        ) {

            try {

                await rest.put(
                    Routes.applicationGuildCommands(
                        config.clientId,
                        guildId
                    ),
                    {
                        body: commands
                    }
                );

                console.log(
                    `✅ Commands registered in: ${guild.name}`
                );

            } catch (error) {

                console.error(
                    `❌ Failed to register commands in ${guild.name}:`,
                    error
                );

            }

        }

    } catch (error) {

        console.error(
            "❌ Command registration error:"
        );

        console.error(error);

    }

}

function isGiveawayStaff(interaction) {

    if (!interaction.guild) {
        return false;
    }

    if (!interaction.member) {
        return false;
    }

    if (
        interaction.member.permissions.has(
            PermissionFlagsBits.ManageGuild
        )
    ) {
        return true;
    }

    const giveawayConfig =
        db.getGiveawayConfig(
            interaction.guild.id
        );

    if (
        !giveawayConfig ||
        !giveawayConfig.staffRoleId
    ) {
        return false;
    }

    return interaction.member.roles.cache.has(
        giveawayConfig.staffRoleId
    );
}

function createGiveawayEmbed(
    giveaway,
    participantCount
) {

    const hostText =
        giveaway.hostId
            ? `<@${giveaway.hostId}>`
            : "Unknown";

    const specialRoleText =
        giveaway.specialRoleId
            ? `<@&${giveaway.specialRoleId}>`
            : null;

    return new EmbedBuilder()

        .setTitle(
            "🎉 ROBUX GIVEAWAY"
        )

        .setDescription(

            `# 💰 ${giveaway.robux.toLocaleString()} Robux\n\n` +

            `🎁 **Prize**\n` +
            `Win **${giveaway.robux.toLocaleString()} Robux**!\n\n` +

            `🏆 **Winners**\n` +
            `${giveaway.winners}\n\n` +

            `👑 **Host By**\n` +
            `${hostText}\n\n` +

            (
                specialRoleText
                    ? `🎭 **Special Role**\n` +
                      `${specialRoleText}\n\n` +
                      `🔐 **This Giveaway is for special roles only:**\n` +
                      `${specialRoleText}\n\n`
                    : ""
            ) +

            `⏰ **Ends**\n` +
            `<t:${Math.floor(giveaway.endTime / 1000)}:R>\n\n` +

            `👥 **Participants**\n` +
            `${participantCount}\n\n` +

            `━━━━━━━━━━━━━━━━━━━━\n` +

            `🎉 Press **Join Giveaway** to enter!\n` +

            `📝 You will be asked for your Roblox Username.`

        )

        .setFooter({

            text:
                "Roblox Giveaway • Good luck! 🍀"

        })

        .setTimestamp();

}

function createGiveawayButtons(
    giveawayId
) {

    const joinButton =
        new ButtonBuilder()

            .setCustomId(
                `join_${giveawayId}`
            )

            .setLabel(
                "Join Giveaway"
            )

            .setEmoji(
                "🎉"
            )

            .setStyle(
                ButtonStyle.Success
            );

    const endButton =
        new ButtonBuilder()

            .setCustomId(
                `end_${giveawayId}`
            )

            .setLabel(
                "End Giveaway"
            )

            .setEmoji(
                "🛑"
            )

            .setStyle(
                ButtonStyle.Danger
            );

    return new ActionRowBuilder()
        .addComponents(
            joinButton,
            endButton
        );
}

client.once(
    "ready",
    async () => {

        console.log(
            `✅ Logged in as ${client.user.tag}`
        );

        console.log(
            `🌐 Connected to ${client.guilds.cache.size} server(s).`
        );

        await registerCommands();

        console.log(
            "🔄 Checking active giveaways..."
        );

        await restoreGiveaways();

        console.log(
            "✅ Giveaway system restored!"
        );

    }
);

client.on(
    "interactionCreate",
    async interaction => {

        try {

            if (
                interaction.isChatInputCommand()
            ) {

                if (
                    interaction.commandName ===
                    "setup-giveaway"
                ) {

                    if (
                        !interaction.member.permissions.has(
                            PermissionFlagsBits.ManageGuild
                        )
                    ) {

                        return interaction.reply({

                            content:
                                "❌ You need **Manage Server** permission to configure the giveaway system.",

                            ephemeral: true

                        });

                    }

                    const staffRole =
                        interaction.options.getRole(
                            "staff_role"
                        );

                    if (!staffRole) {

                        return interaction.reply({

                            content:
                                "❌ Please select a staff role.",

                            ephemeral: true

                        });

                    }

                    if (
                        staffRole.id ===
                        interaction.guild.id
                    ) {

                        return interaction.reply({

                            content:
                                "❌ You cannot use **@everyone** as the Giveaway Staff role.",

                            ephemeral: true

                        });

                    }

                    if (staffRole.managed) {

                        return interaction.reply({

                            content:
                                "❌ You cannot use a managed or integration role as the Giveaway Staff role.",

                            ephemeral: true

                        });

                    }

                    db.setGiveawayConfig(
                        interaction.guild.id,
                        staffRole.id
                    );

                    return interaction.reply({

                        content:
                            `✅ **Giveaway system configured!**\n\n` +
                            `🎁 Giveaway Staff Role: ${staffRole}\n\n` +
                            `Members with this role can now create and manage giveaways.\n\n` +
                            `🛡️ Members with **Manage Server** can also manage giveaways.`,

                        ephemeral: true

                    });

                }

                if (
                    interaction.commandName !== "giveaway" &&
                    interaction.commandName !== "specialgiveaway"
                ) {

                    return;

                }

                if (
                    !isGiveawayStaff(
                        interaction
                    )
                ) {

                    return interaction.reply({

                        content:
                            "❌ You do not have permission to create or manage giveaways.",

                        ephemeral: true

                    });

                }

                const isSpecialGiveaway =
                    interaction.commandName === "specialgiveaway";

                const specialRole =
                    isSpecialGiveaway
                        ? interaction.options.getRole("special_role")
                        : null;

                if (
                    isSpecialGiveaway &&
                    !specialRole
                ) {

                    return interaction.reply({

                        content:
                            "❌ Please select a special role.",

                        ephemeral: true

                    });

                }

                if (
                    isSpecialGiveaway &&
                    specialRole.id === interaction.guild.id
                ) {

                    return interaction.reply({

                        content:
                            "❌ You cannot use **@everyone** as the special role.",

                        ephemeral: true

                    });

                }

                if (
                    isSpecialGiveaway &&
                    specialRole.managed
                ) {

                    return interaction.reply({

                        content:
                            "❌ You cannot use a managed or integration role as the special role.",

                        ephemeral: true

                    });

                }

                const robux =
                    interaction.options.getInteger(
                        "robux"
                    );

                const durationInput =
                    interaction.options.getString(
                        "duration"
                    );

                const winners =
                    interaction.options.getInteger(
                        "winners"
                    );

                const ping =
                    interaction.options.getBoolean(
                        "ping"
                    );

                const duration =
                    parseDuration(
                        durationInput
                    );

                if (!duration) {

                    return interaction.reply({

                        content:
                            "❌ **Invalid duration!**\n\n" +
                            "Examples:\n" +
                            "`1m` = 1 minute\n" +
                            "`30m` = 30 minutes\n" +
                            "`1h` = 1 hour\n" +
                            "`12h` = 12 hours\n" +
                            "`1d` = 1 day\n" +
                            "`3d` = 3 days\n" +
                            "`1w` = 1 week\n\n" +
                            "⏱️ Minimum: **1 minute**\n" +
                            "⏱️ Maximum: **1 week**",

                        ephemeral: true

                    });

                }

                const giveawayId =
                    `${interaction.guild.id}-${Date.now()}`;

                const endTime =
                    Date.now() +
                    duration * 1000;

                db.createGiveaway({

                    id:
                        giveawayId,

                    guildId:
                        interaction.guild.id,

                    channelId:
                        interaction.channel.id,

                    messageId:
                        null,

                    robux:
                        robux,

                    winners:
                        winners,

                    endTime:
                        endTime,

                    hostId:
                        interaction.user.id,

                    specialRoleId:
                        specialRole
                            ? specialRole.id
                            : null

                });

                const giveaway = {

                    id:
                        giveawayId,

                    guildId:
                        interaction.guild.id,

                    channelId:
                        interaction.channel.id,

                    messageId:
                        null,

                    robux:
                        robux,

                    winners:
                        winners,

                    endTime:
                        endTime,

                    hostId:
                        interaction.user.id,

                    specialRoleId:
                        specialRole
                            ? specialRole.id
                            : null

                };

                const embed =
                    createGiveawayEmbed(
                        giveaway,
                        0
                    );

                const row =
                    createGiveawayButtons(
                        giveawayId
                    );

                const message =
                    await interaction.channel.send({

                        content:
                            ping
                                ? "@everyone"
                                : "",

                        embeds: [
                            embed
                        ],

                        components: [
                            row
                        ],

                        allowedMentions: {

                            parse:
                                ping
                                    ? ["everyone"]
                                    : [],

                            roles:
                                specialRole
                                    ? [specialRole.id]
                                    : []

                        }

                    });

                db.updateMessageId(
                    giveawayId,
                    message.id
                );

                await interaction.reply({

                    content:
                        `✅ **${isSpecialGiveaway ? "Special giveaway" : "Giveaway"} created!**\n\n` +
                        `💰 Prize: **${robux.toLocaleString()} Robux**\n` +
                        `⏱️ Duration: **${durationInput}**\n` +
                        `🏆 Winners: **${winners}**` +
                        (
                            specialRole
                                ? `\n🎭 Special Role: ${specialRole}`
                                : ""
                        ),

                    ephemeral: true

                });

                scheduleGiveaway(
                    giveawayId,
                    endTime
                );

                return;

            }

            if (
                interaction.isButton()
            ) {

                if (
                    interaction.customId.startsWith(
                        "join_"
                    )
                ) {

                    const giveawayId =
                        interaction.customId.replace(
                            "join_",
                            ""
                        );

                    const giveaway =
                        db.getGiveaway(
                            giveawayId
                        );

                    if (
                        !giveaway ||
                        giveaway.ended
                    ) {

                        return interaction.reply({

                            content:
                                "❌ This giveaway has ended.",

                            ephemeral: true

                        });

                    }

                    if (
                        Date.now() >=
                        giveaway.endTime
                    ) {

                        await endGiveaway(
                            giveawayId
                        );

                        return interaction.reply({

                            content:
                                "❌ This giveaway has ended.",

                            ephemeral: true

                        });

                    }

                    if (
                        giveaway.specialRoleId &&
                        !interaction.member.roles.cache.has(
                            giveaway.specialRoleId
                        )
                    ) {

                        return interaction.reply({

                            content:
                                `❌ You cannot join this giveaway.\n\nYou need the <@&${giveaway.specialRoleId}> role to participate.`,

                            ephemeral: true

                        });

                    }

                    const participants =
                        db.getParticipants(
                            giveawayId
                        );

                    const alreadyJoined =
                        participants.some(
                            user =>
                                user.discordId ===
                                interaction.user.id
                        );

                    if (
                        alreadyJoined
                    ) {

                        return interaction.reply({

                            content:
                                "⚠️ You are already participating!",

                            ephemeral: true

                        });

                    }

                    const modal =
                        new ModalBuilder()

                            .setCustomId(
                                `username_${giveawayId}`
                            )

                            .setTitle(
                                "🎉 Join Giveaway"
                            );

                    const usernameInput =
                        new TextInputBuilder()

                            .setCustomId(
                                "roblox_username"
                            )

                            .setLabel(
                                "Roblox Username"
                            )

                            .setPlaceholder(
                                "Enter your Roblox username"
                            )

                            .setStyle(
                                TextInputStyle.Short
                            )

                            .setRequired(
                                true
                            )

                            .setMinLength(
                                3
                            )

                            .setMaxLength(
                                20
                            );

                    const inputRow =
                        new ActionRowBuilder()
                            .addComponents(
                                usernameInput
                            );

                    modal.addComponents(
                        inputRow
                    );

                    await interaction.showModal(
                        modal
                    );

                    return;

                }

                if (
                    interaction.customId.startsWith(
                        "end_"
                    )
                ) {

                    const giveawayId =
                        interaction.customId.replace(
                            "end_",
                            ""
                        );

                    const giveaway =
                        db.getGiveaway(
                            giveawayId
                        );

                    if (!giveaway) {

                        return interaction.reply({

                            content:
                                "❌ Giveaway not found.",

                            ephemeral: true

                        });

                    }

                    if (
                        !isGiveawayStaff(
                            interaction
                        )
                    ) {

                        return interaction.reply({

                            content:
                                "❌ You do not have permission to manage this giveaway.",

                            ephemeral: true

                        });

                    }

                    await interaction.deferReply({

                        ephemeral: true

                    });

                    await endGiveaway(
                        giveawayId
                    );

                    await interaction.editReply({

                        content:
                            "🛑 **Giveaway ended successfully!**"

                    });

                    return;

                }

                if (
                    interaction.customId.startsWith(
                        "reroll_"
                    )
                ) {

                    const giveawayId =
                        interaction.customId.replace(
                            "reroll_",
                            ""
                        );

                    const giveaway =
                        db.getGiveaway(
                            giveawayId
                        );

                    if (!giveaway) {

                        return interaction.reply({

                            content:
                                "❌ Giveaway not found.",

                            ephemeral: true

                        });

                    }

                    if (
                        !isGiveawayStaff(
                            interaction
                        )
                    ) {

                        return interaction.reply({

                            content:
                                "❌ You do not have permission to manage this giveaway.",

                            ephemeral: true

                        });

                    }

                    const participants =
                        db.getParticipants(
                            giveawayId
                        );

                    const previousWinners =
                        db.getWinners(
                            giveawayId
                        );

                    const previousWinnerIds =
                        previousWinners.map(
                            winner =>
                                winner.discordId
                        );

                    const available =
                        participants.filter(
                            participant =>
                                !previousWinnerIds.includes(
                                    participant.discordId
                                )
                        );

                    if (
                        available.length === 0
                    ) {

                        return interaction.reply({

                            content:
                                "❌ There are no other participants available for a reroll.",

                            ephemeral: true

                        });

                    }

                    const newWinner =
                        available[
                            Math.floor(
                                Math.random() *
                                available.length
                            )
                        ];

                    db.addWinner({

                        giveawayId:
                            giveawayId,

                        discordId:
                            newWinner.discordId,

                        discordTag:
                            newWinner.discordTag,

                        robloxUsername:
                            newWinner.robloxUsername

                    });

                    try {

                        const ticketResult =
                            await sendWinnerToTicketBot({

                                giveawayId:
                                    giveawayId,

                                guildId:
                                    giveaway.guildId,

                                discordId:
                                    newWinner.discordId,

                                discordTag:
                                    newWinner.discordTag,

                                robloxUsername:
                                    newWinner.robloxUsername,

                                robux:
                                    giveaway.robux

                            });

                        console.log(
                            `🎫 Ticket created for reroll winner ${newWinner.discordTag}`
                        );

                        console.log(
                            `📁 Channel ID: ${ticketResult.channelId}`
                        );

                    } catch (error) {

                        console.error(
                            `❌ Could not create ticket for reroll winner ${newWinner.discordTag}:`,
                            error.message
                        );

                    }

                    const channel =
                        await client.channels.fetch(
                            giveaway.channelId
                        );

                    const message =
                        await channel.messages.fetch(
                            giveaway.messageId
                        );

                    const winners =
                        db.getWinners(
                            giveawayId
                        );

                    const winnerText =
                        winners
                            .map(
                                winner =>
                                    `🏆 <@${winner.discordId}> — **${winner.robloxUsername}**`
                            )
                            .join("\n");

                    const embed =
                        EmbedBuilder.from(
                            message.embeds[0]
                        );

                    embed.setDescription(

                        `💰 **Prize:** ${giveaway.robux.toLocaleString()} Robux\n\n` +

                        `🏆 **Winner(s):**\n` +

                        `${winnerText}\n\n` +

                        `👥 Participants: **${participants.length}**\n\n` +

                        `🔄 **Winner rerolled!**\n\n` +

                        `🎊 Congratulations!`

                    );

                    const rerollButton =
                        new ButtonBuilder()

                            .setCustomId(
                                `reroll_${giveawayId}`
                            )

                            .setLabel(
                                "Reroll Winner"
                            )

                            .setEmoji(
                                "🔄"
                            )

                            .setStyle(
                                ButtonStyle.Primary
                            );

                    const rerollRow =
                        new ActionRowBuilder()
                            .addComponents(
                                rerollButton
                            );

                    await message.edit({

                        content:
                            winners
                                .map(
                                    winner =>
                                        `<@${winner.discordId}>`
                                )
                                .join(" "),

                        embeds: [
                            embed
                        ],

                        components: [
                            rerollRow
                        ]

                    });

                    await interaction.reply({

                        content:
                            `🔄 **Reroll complete!**\n\n` +
                            `🏆 New winner: <@${newWinner.discordId}>`,

                        ephemeral: true

                    });

                    return;

                }

            }

            if (
                interaction.isModalSubmit()
            ) {

                if (
                    interaction.customId.startsWith(
                        "username_"
                    )
                ) {

                    const giveawayId =
                        interaction.customId.replace(
                            "username_",
                            ""
                        );

                    const giveaway =
                        db.getGiveaway(
                            giveawayId
                        );

                    if (
                        !giveaway ||
                        giveaway.ended
                    ) {

                        return interaction.reply({

                            content:
                                "❌ This giveaway has ended.",

                            ephemeral: true

                        });

                    }

                    if (
                        Date.now() >=
                        giveaway.endTime
                    ) {

                        await endGiveaway(
                            giveawayId
                        );

                        return interaction.reply({

                            content:
                                "❌ This giveaway has ended.",

                            ephemeral: true

                        });

                    }

                    if (
                        giveaway.specialRoleId &&
                        !interaction.member.roles.cache.has(
                            giveaway.specialRoleId
                        )
                    ) {

                        return interaction.reply({

                            content:
                                `❌ You cannot join this giveaway.\n\nYou need the <@&${giveaway.specialRoleId}> role to participate.`,

                            ephemeral: true

                        });

                    }

                    const username =
                        interaction.fields
                            .getTextInputValue(
                                "roblox_username"
                            )
                            .trim();

                    const participants =
                        db.getParticipants(
                            giveawayId
                        );

                    if (
                        participants.some(
                            user =>
                                user.discordId ===
                                interaction.user.id
                        )
                    ) {

                        return interaction.reply({

                            content:
                                "⚠️ You are already entered!",

                            ephemeral: true

                        });

                    }

                    db.addParticipant({

                        giveawayId:
                            giveawayId,

                        discordId:
                            interaction.user.id,

                        discordTag:
                            interaction.user.tag,

                        robloxUsername:
                            username

                    });

                    const newCount =
                        db.getParticipants(
                            giveawayId
                        ).length;

                    await interaction.reply({

                        content:
                            `🎉 **You're in!**\n\n` +
                            `👤 Roblox: **${username}**\n` +
                            `💰 Prize: **${giveaway.robux.toLocaleString()} Robux**\n\n` +
                            `👥 Participants: **${newCount}**\n\n` +
                            `🍀 Good luck!`,

                        ephemeral: true

                    });

                    await updateGiveawayMessage(
                        giveawayId
                    );

                }

            }

        } catch (error) {

            console.error(
                "❌ Interaction error:",
                error
            );

        }

    }
);

async function updateGiveawayMessage(
    giveawayId
) {

    const giveaway =
        db.getGiveaway(
            giveawayId
        );

    if (
        !giveaway ||
        giveaway.ended
    ) {

        return;

    }

    try {

        const channel =
            await client.channels.fetch(
                giveaway.channelId
            );

        const message =
            await channel.messages.fetch(
                giveaway.messageId
            );

        const participants =
            db.getParticipants(
                giveawayId
            );

        const embed =
            createGiveawayEmbed(
                giveaway,
                participants.length
            );

        await message.edit({

            embeds: [
                embed
            ]

        });

    } catch (error) {

        console.error(
            "❌ Could not update giveaway:",
            error
        );

    }

}

async function createTicketsForWinners(
    giveaway,
    winners
) {

    if (
        !winners ||
        winners.length === 0
    ) {

        return;

    }

    for (
        const winner of winners
    ) {

        try {

            const result =
                await sendWinnerToTicketBot({

                    giveawayId:
                        giveaway.id,

                    guildId:
                        giveaway.guildId,

                    discordId:
                        winner.discordId,

                    discordTag:
                        winner.discordTag,

                    robloxUsername:
                        winner.robloxUsername,

                    robux:
                        giveaway.robux

                });

            console.log(
                `🎫 Ticket created for ${winner.discordTag}`
            );

            console.log(
                `📁 Channel ID: ${result.channelId}`
            );

        } catch (error) {

            console.error(
                `❌ Could not create ticket for ${winner.discordTag}:`,
                error.message
            );

        }

    }

}

async function endGiveaway(
    giveawayId
) {

    const giveaway =
        db.getGiveaway(
            giveawayId
        );

    if (!giveaway) {

        return;

    }

    if (giveaway.ended) {

        return;

    }

    const participants =
        db.getParticipants(
            giveawayId
        );

    db.endGiveaway(
        giveawayId
    );

    try {

        const channel =
            await client.channels.fetch(
                giveaway.channelId
            );

        const message =
            await channel.messages.fetch(
                giveaway.messageId
            );

        if (
            participants.length === 0
        ) {

            const embed =
                new EmbedBuilder()

                    .setTitle(
                        "😔 Giveaway Ended"
                    )

                    .setDescription(

                        `💰 Prize: **${giveaway.robux.toLocaleString()} Robux**\n\n` +

                        `❌ Nobody entered the giveaway.`

                    )

                    .setTimestamp();

            await message.edit({

                content: "",

                embeds: [
                    embed
                ],

                components: []

            });

            return;

        }

        const existingWinners =
            db.getWinners(
                giveawayId
            );

        if (
            existingWinners.length === 0
        ) {

            const shuffled =
                [...participants].sort(
                    () =>
                        Math.random() - 0.5
                );

            const selected =
                shuffled.slice(

                    0,

                    Math.min(
                        giveaway.winners,
                        participants.length
                    )

                );

            for (
                const winner of selected
            ) {

                db.addWinner({

                    giveawayId:
                        giveawayId,

                    discordId:
                        winner.discordId,

                    discordTag:
                        winner.discordTag,

                    robloxUsername:
                        winner.robloxUsername

                });

            }

        }

        const winners =
            db.getWinners(
                giveawayId
            );

        await createTicketsForWinners(

            giveaway,

            winners

        );

        const winnerText =
            winners

                .map(

                    winner =>
                        `🏆 <@${winner.discordId}> — **${winner.robloxUsername}**`

                )

                .join("\n");

        const embed =
            new EmbedBuilder()

                .setTitle(
                    "🎉 GIVEAWAY ENDED!"
                )

                .setDescription(

                    `💰 **Prize:** ${giveaway.robux.toLocaleString()} Robux\n\n` +

                    `🏆 **Winner(s):**\n` +

                    `${winnerText}\n\n` +

                    `👥 Participants: **${participants.length}**\n\n` +

                    `🎊 Congratulations!`

                )

                .setFooter({

                    text:
                        "Roblox Giveaway • Ended"

                })

                .setTimestamp();

        const rerollButton =
            new ButtonBuilder()

                .setCustomId(

                    `reroll_${giveawayId}`

                )

                .setLabel(

                    "Reroll Winner"

                )

                .setEmoji(
                    "🔄"
                )

                .setStyle(

                    ButtonStyle.Primary

                );

        const row =
            new ActionRowBuilder()

                .addComponents(

                    rerollButton

                );

        await message.edit({

            content:

                winners

                    .map(

                        winner =>
                            `<@${winner.discordId}>`

                    )

                    .join(" "),

            embeds: [
                embed
            ],

            components: [
                row
            ]

        });

        console.log(

            `🏆 Giveaway ${giveawayId} ended successfully.`

        );

    } catch (error) {

        console.error(

            "❌ Giveaway ending error:",

            error

        );

    }

}

function scheduleGiveaway(
    giveawayId,
    endTime
) {

    const remaining =
        endTime - Date.now();

    if (
        remaining <= 0
    ) {

        endGiveaway(
            giveawayId
        );

        return;

    }

    setTimeout(

        () => {

            endGiveaway(
                giveawayId
            );

        },

        remaining

    );

}

async function restoreGiveaways() {

    const activeGiveaways =
        db.getActiveGiveaways();

    console.log(

        `📦 Found ${activeGiveaways.length} active giveaway(s).`

    );

    for (
        const giveaway of activeGiveaways
    ) {

        if (
            Date.now() >=
            giveaway.endTime
        ) {

            console.log(

                `⏰ Giveaway ${giveaway.id} already expired. Ending...`

            );

            await endGiveaway(
                giveaway.id
            );

            continue;

        }

        scheduleGiveaway(

            giveaway.id,

            giveaway.endTime

        );

        await updateGiveawayMessage(

            giveaway.id

        );

    }

}

async function sendWinnerToTicketBot(
    data
) {

    const apiUrl =
        process.env.TICKET_API_URL ||
        "http://127.0.0.1:3001";

    const apiSecret =
        process.env.TICKET_API_SECRET;

    if (!apiSecret) {

        throw new Error(

            "TICKET_API_SECRET is missing from .env"

        );

    }

    const response =
        await fetch(

            `${apiUrl}/internal/giveaway-winner`,

            {

                method:
                    "POST",

                headers: {

                    "Content-Type":
                        "application/json",

                    "x-api-secret":
                        apiSecret

                },

                body: JSON.stringify({

                    giveawayId:
                        data.giveawayId,

                    guildId:
                        data.guildId,

                    discordId:
                        data.discordId,

                    discordTag:
                        data.discordTag,

                    robloxUsername:
                        data.robloxUsername,

                    robux:
                        data.robux

                })

            }

        );

    const text =
        await response.text();

    let result;

    try {

        result =
            JSON.parse(
                text
            );

    } catch {

        result = {

            message:
                text

        };

    }

    if (
        !response.ok
    ) {

        throw new Error(

            result.error ||

            result.message ||

            `Ticket Bot returned HTTP ${response.status}`

        );

    }

    if (
        result.success === false
    ) {

        throw new Error(

            result.error ||

            "Ticket Bot rejected the request."

        );

    }

    return result;

}

async function start() {

    if (
        !process.env.GIVEAWAY_BOT_TOKEN
    ) {

        console.error(

            "❌ TOKEN is missing from .env"

        );

        process.exit(1);

    }

    if (
        !process.env.TICKET_API_URL
    ) {

        console.warn(

            "⚠️ TICKET_API_URL is missing. Using http://127.0.0.1:3001"

        );

    }

    if (
        !process.env.TICKET_API_SECRET
    ) {

        console.error(

            "❌ TICKET_API_SECRET is missing from .env"

        );

        process.exit(1);

    }

    try {

        await client.login(

            process.env.GIVEAWAY_BOT_TOKEN

        );

    } catch (error) {

        console.error(

            "❌ Failed to login to Discord:"

        );

        console.error(
            error
        );

        process.exit(1);

    }

}

start();
