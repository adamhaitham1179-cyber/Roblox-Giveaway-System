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

// =====================================================
// DURATION
// =====================================================

function parseDuration(input) {

    if (!input) {
        return null;
    }

    const value = input
        .trim()
        .toLowerCase();

    const match = value.match(
        /^(\d+)\s*(m|h|d|w)$/
    );

    if (!match) {
        return null;
    }

    const number = Number(match[1]);

    if (number <= 0) {
        return null;
    }

    let seconds;

    switch (match[2]) {

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

// =====================================================
// COMMANDS
// =====================================================

const commands = [

    // =================================================
    // SETUP NORMAL GIVEAWAY
    // =================================================

    new SlashCommandBuilder()
        .setName("setup-giveaway")
        .setDescription(
            "Set the role allowed to create normal giveaways."
        )
        .addRoleOption(option =>
            option
                .setName("staff_role")
                .setDescription(
                    "Role allowed to create and manage normal giveaways."
                )
                .setRequired(true)
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageGuild
        )
        .toJSON(),

    // =================================================
    // SETUP SPECIAL GIVEAWAY
    // =================================================

    new SlashCommandBuilder()
        .setName("setup-special-giveaway")
        .setDescription(
            "Set the role allowed to create special giveaways."
        )
        .addRoleOption(option =>
            option
                .setName("staff_role")
                .setDescription(
                    "Role allowed to create special giveaways."
                )
                .setRequired(true)
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageGuild
        )
        .toJSON(),

    // =================================================
    // NORMAL GIVEAWAY
    // =================================================

    new SlashCommandBuilder()
        .setName("giveaway")
        .setDescription(
            "Create a Robux giveaway."
        )
        .addIntegerOption(option =>
            option
                .setName("robux")
                .setDescription(
                    "Amount of Robux."
                )
                .setRequired(true)
                .setMinValue(1)
        )
        .addStringOption(option =>
            option
                .setName("duration")
                .setDescription(
                    "Example: 1m, 2h, 1d, 1w."
                )
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName("winners")
                .setDescription(
                    "Number of winners."
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

    // =================================================
    // SPECIAL GIVEAWAY
    // =================================================

    new SlashCommandBuilder()
        .setName("specialgiveaway")
        .setDescription(
            "Create a giveaway for members with a specific role."
        )
        .addIntegerOption(option =>
            option
                .setName("robux")
                .setDescription(
                    "Amount of Robux."
                )
                .setRequired(true)
                .setMinValue(1)
        )
        .addStringOption(option =>
            option
                .setName("duration")
                .setDescription(
                    "Example: 1m, 2h, 1d, 1w."
                )
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName("winners")
                .setDescription(
                    "Number of winners."
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
                    "Role required to join this giveaway."
                )
                .setRequired(true)
        )
        .toJSON()
];

// =====================================================
// COMMAND REGISTRATION
// =====================================================

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
            "✅ Global commands registered."
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
                    `❌ Could not register commands in ${guild.name}:`,
                    error.message
                );
            }
        }

    } catch (error) {

        console.error(
            "❌ Command registration failed:",
            error
        );
    }
}

// =====================================================
// NORMAL GIVEAWAY STAFF CHECK
// =====================================================

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

    const settings =
        db.getGiveawayConfig(
            interaction.guild.id
        );

    if (
        !settings ||
        !settings.staffRoleId
    ) {
        return false;
    }

    return interaction.member.roles.cache.has(
        settings.staffRoleId
    );
}

// =====================================================
// SPECIAL GIVEAWAY STAFF CHECK
// =====================================================

function isSpecialGiveawayStaff(interaction) {

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

    const settings =
        db.getGiveawayConfig(
            interaction.guild.id
        );

    if (
        !settings ||
        !settings.specialStaffRoleId
    ) {
        return false;
    }

    return interaction.member.roles.cache.has(
        settings.specialStaffRoleId
    );
}

// =====================================================
// GIVEAWAY EMBED
// =====================================================

function createGiveawayEmbed(
    giveaway,
    participantCount
) {

    const host =
        giveaway.hostId
            ? `<@${giveaway.hostId}>`
            : "Unknown";

    let description =

        `# 💰 ${giveaway.robux.toLocaleString()} Robux\n\n` +

        `🎁 **Prize**\n` +
        `Win **${giveaway.robux.toLocaleString()} Robux**!\n\n` +

        `🏆 **Winners**\n` +
        `${giveaway.winners}\n\n` +

        `👑 **Host By**\n` +
        `${host}\n\n`;

    if (giveaway.specialRoleId) {

        description +=

            `🔐 **This Giveaway is for special roles only:**\n` +
            `<@&${giveaway.specialRoleId}>\n\n`;
    }

    description +=

        `⏰ **Ends**\n` +
        `<t:${Math.floor(giveaway.endTime / 1000)}:R>\n\n` +

        `👥 **Participants**\n` +
        `${participantCount}\n\n` +

        `━━━━━━━━━━━━━━━━━━━━\n\n` +

        `🎉 Press **Join Giveaway** to enter!\n\n` +

        `📝 You will be asked for your Roblox Username.`;

    return new EmbedBuilder()
        .setTitle("🎉 ROBUX GIVEAWAY")
        .setDescription(description)
        .setFooter({
            text:
                "Roblox Giveaway • Good luck! 🍀"
        })
        .setTimestamp();
}

// =====================================================
// GIVEAWAY BUTTONS
// =====================================================

function createGiveawayButtons(giveawayId) {

    const join =
        new ButtonBuilder()
            .setCustomId(
                `join_${giveawayId}`
            )
            .setLabel(
                "Join Giveaway"
            )
            .setEmoji("🎉")
            .setStyle(
                ButtonStyle.Success
            );

    const participants =
        new ButtonBuilder()
            .setCustomId(
                `participants_${giveawayId}`
            )
            .setLabel(
                "Show Participants"
            )
            .setEmoji("👥")
            .setStyle(
                ButtonStyle.Secondary
            );

    const cancel =
        new ButtonBuilder()
            .setCustomId(
                `cancel_${giveawayId}`
            )
            .setLabel(
                "Cancel Giveaway"
            )
            .setEmoji("🛑")
            .setStyle(
                ButtonStyle.Danger
            );

    return [
        new ActionRowBuilder()
            .addComponents(
                join,
                participants,
                cancel
            )
    ];
}

// =====================================================
// LEAVE CONFIRMATION
// =====================================================

function createLeaveConfirmation(giveawayId) {

    const yes =
        new ButtonBuilder()
            .setCustomId(
                `leave_yes_${giveawayId}`
            )
            .setLabel("Yes")
            .setStyle(
                ButtonStyle.Danger
            );

    const no =
        new ButtonBuilder()
            .setCustomId(
                `leave_no_${giveawayId}`
            )
            .setLabel("No")
            .setStyle(
                ButtonStyle.Secondary
            );

    return new ActionRowBuilder()
        .addComponents(
            yes,
            no
        );
}

// =====================================================
// CANCEL CONFIRMATION
// =====================================================

function createCancelConfirmation(giveawayId) {

    const yes =
        new ButtonBuilder()
            .setCustomId(
                `cancel_yes_${giveawayId}`
            )
            .setLabel("Yes")
            .setStyle(
                ButtonStyle.Danger
            );

    const no =
        new ButtonBuilder()
            .setCustomId(
                `cancel_no_${giveawayId}`
            )
            .setLabel("No")
            .setStyle(
                ButtonStyle.Secondary
            );

    return new ActionRowBuilder()
        .addComponents(
            yes,
            no
        );
}

// =====================================================
// READY
// =====================================================

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

        await restoreGiveaways();

        console.log(
            "✅ Giveaway system restored."
        );
    }
);

// =====================================================
// INTERACTIONS
// =====================================================

client.on(
    "interactionCreate",
    async interaction => {

        try {

            // =========================================
            // SLASH COMMANDS
            // =========================================

            if (
                interaction.isChatInputCommand()
            ) {

                // =====================================
                // SETUP GIVEAWAY
                // =====================================

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
                                "❌ You need **Manage Server** permission.",
                            ephemeral: true
                        });
                    }

                    const role =
                        interaction.options.getRole(
                            "staff_role"
                        );

                    if (!role) {

                        return interaction.reply({
                            content:
                                "❌ Please select a role.",
                            ephemeral: true
                        });
                    }

                    if (
                        role.id ===
                        interaction.guild.id
                    ) {

                        return interaction.reply({
                            content:
                                "❌ You cannot use @everyone.",
                            ephemeral: true
                        });
                    }

                    if (role.managed) {

                        return interaction.reply({
                            content:
                                "❌ You cannot use a managed role.",
                            ephemeral: true
                        });
                    }

                    db.setGiveawayConfig(
                        interaction.guild.id,
                        role.id
                    );

                    return interaction.reply({
                        content:
                            `✅ **Giveaway system configured!**\n\n` +
                            `🎁 Giveaway Staff Role: ${role}`,
                        ephemeral: true
                    });
                }

                // =====================================
                // SETUP SPECIAL GIVEAWAY
                // =====================================

                if (
                    interaction.commandName ===
                    "setup-special-giveaway"
                ) {

                    if (
                        !interaction.member.permissions.has(
                            PermissionFlagsBits.ManageGuild
                        )
                    ) {

                        return interaction.reply({
                            content:
                                "❌ You need **Manage Server** permission.",
                            ephemeral: true
                        });
                    }

                    const role =
                        interaction.options.getRole(
                            "staff_role"
                        );

                    if (!role) {

                        return interaction.reply({
                            content:
                                "❌ Please select a role.",
                            ephemeral: true
                        });
                    }

                    if (
                        role.id ===
                        interaction.guild.id
                    ) {

                        return interaction.reply({
                            content:
                                "❌ You cannot use @everyone.",
                            ephemeral: true
                        });
                    }

                    if (role.managed) {

                        return interaction.reply({
                            content:
                                "❌ You cannot use a managed role.",
                            ephemeral: true
                        });
                    }

                    db.setSpecialGiveawayConfig(
                        interaction.guild.id,
                        role.id
                    );

                    return interaction.reply({
                        content:
                            `✅ **Special Giveaway system configured!**\n\n` +
                            `🎭 Special Giveaway Staff Role: ${role}\n\n` +
                            `Members with this role can now use **/specialgiveaway**.`,
                        ephemeral: true
                    });
                }

                // =====================================
                // NORMAL GIVEAWAY
                // =====================================

                if (
                    interaction.commandName ===
                    "giveaway"
                ) {

                    if (
                        !isGiveawayStaff(
                            interaction
                        )
                    ) {

                        return interaction.reply({
                            content:
                                "❌ You do not have permission to create giveaways.",
                            ephemeral: true
                        });
                    }

                    await createGiveawayFromCommand(
                        interaction,
                        false
                    );

                    return;
                }

                // =====================================
                // SPECIAL GIVEAWAY
                // =====================================

                if (
                    interaction.commandName ===
                    "specialgiveaway"
                ) {

                    if (
                        !isSpecialGiveawayStaff(
                            interaction
                        )
                    ) {

                        return interaction.reply({
                            content:
                                "❌ You do not have permission to create special giveaways.\n\nAsk a server administrator to configure **/setup-special-giveaway**.",
                            ephemeral: true
                        });
                    }

                    await createGiveawayFromCommand(
                        interaction,
                        true
                    );

                    return;
                }
            }

            // =========================================
            // BUTTONS
            // =========================================

            if (
                interaction.isButton()
            ) {

                const customId =
                    interaction.customId;

                // =====================================
                // SHOW PARTICIPANTS
                // =====================================

                if (
                    customId.startsWith(
                        "participants_"
                    )
                ) {

                    const giveawayId =
                        customId.replace(
                            "participants_",
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

                    const participants =
                        db.getParticipants(
                            giveawayId
                        );

                    if (
                        participants.length === 0
                    ) {

                        return interaction.reply({
                            content:
                                "👥 **Participants**\n\nNo one has joined this giveaway yet.",
                            ephemeral: true
                        });
                    }

                    const list =
                        participants
                            .map(
                                (user, index) =>
                                    `**${index + 1}.** <@${user.discordId}> — Roblox: **${user.robloxUsername}**`
                            )
                            .join("\n");

                    const maxLength = 3500;

                    const shownList =
                        list.length > maxLength
                            ? list.slice(0, maxLength) +
                              "\n\n...and more."
                            : list;

                    const embed =
                        new EmbedBuilder()
                            .setTitle(
                                "👥 Giveaway Participants"
                            )
                            .setDescription(
                                shownList
                            )
                            .addFields({
                                name: "Total Participants",
                                value:
                                    `**${participants.length}**`,
                                inline: true
                            })
                            .setColor(0x5865F2)
                            .setFooter({
                                text:
                                    "Only you can see this list."
                            });

                    return interaction.reply({
                        embeds: [embed],
                        ephemeral: true
                    });
                }

                // =====================================
                // JOIN
                // =====================================

                if (
                    customId.startsWith(
                        "join_"
                    )
                ) {

                    const giveawayId =
                        customId.replace(
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

                    // =================================
                    // HOST CANNOT JOIN
                    // =================================

                    if (
                        giveaway.hostId ===
                        interaction.user.id
                    ) {

                        return interaction.reply({
                            content:
                                "❌ You are the host of this giveaway, so you cannot enter your own giveaway.",
                            ephemeral: true
                        });
                    }

                    // =================================
                    // SPECIAL ROLE CHECK
                    // =================================

                    if (
                        giveaway.specialRoleId &&
                        !interaction.member.roles.cache.has(
                            giveaway.specialRoleId
                        )
                    ) {

                        return interaction.reply({
                            content:
                                `❌ You cannot join this giveaway.\n\n` +
                                `You need the <@&${giveaway.specialRoleId}> role to participate.`,
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

                    // =================================
                    // ALREADY JOINED = LEAVE
                    // =================================

                    if (alreadyJoined) {

                        return interaction.reply({
                            content:
                                "🚪 You are already participating in this giveaway.\n\nDo you want to leave the giveaway?",
                            components: [
                                createLeaveConfirmation(
                                    giveawayId
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    // =================================
                    // JOIN MODAL
                    // =================================

                    const modal =
                        new ModalBuilder()
                            .setCustomId(
                                `username_${giveawayId}`
                            )
                            .setTitle(
                                "🎉 Join Giveaway"
                            );

                    const input =
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
                            .setRequired(true)
                            .setMinLength(3)
                            .setMaxLength(20);

                    modal.addComponents(
                        new ActionRowBuilder()
                            .addComponents(
                                input
                            )
                    );

                    return interaction.showModal(
                        modal
                    );
                }

                // =====================================
                // LEAVE YES
                // =====================================

                if (
                    customId.startsWith(
                        "leave_yes_"
                    )
                ) {

                    const giveawayId =
                        customId.replace(
                            "leave_yes_",
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

                        return interaction.update({
                            content:
                                "❌ This giveaway has ended.",
                            components: []
                        });
                    }

                    const removed =
                        db.removeParticipant(
                            giveawayId,
                            interaction.user.id
                        );

                    if (!removed) {

                        return interaction.update({
                            content:
                                "❌ You are not participating in this giveaway.",
                            components: []
                        });
                    }

                    await updateGiveawayMessage(
                        giveawayId
                    );

                    return interaction.update({
                        content:
                            "🚪 **You left the giveaway successfully.**",
                        components: []
                    });
                }

                // =====================================
                // LEAVE NO
                // =====================================

                if (
                    customId.startsWith(
                        "leave_no_"
                    )
                ) {

                    return interaction.update({
                        content:
                            "✅ You stayed in the giveaway.",
                        components: []
                    });
                }

                // =====================================
                // CANCEL BUTTON
                // =====================================

                if (
                    customId.startsWith(
                        "cancel_"
                    ) &&
                    !customId.startsWith(
                        "cancel_yes_"
                    ) &&
                    !customId.startsWith(
                        "cancel_no_"
                    )
                ) {

                    const giveawayId =
                        customId.replace(
                            "cancel_",
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

                    // Only HOST
                    if (
                        giveaway.hostId !==
                        interaction.user.id
                    ) {

                        return interaction.reply({
                            content:
                                "❌ Only the person who created this giveaway can cancel it.",
                            ephemeral: true
                        });
                    }

                    return interaction.reply({
                        content:
                            "⚠️ **Are you sure you want to cancel this giveaway?**\n\nThis cannot be undone.",
                        components: [
                            createCancelConfirmation(
                                giveawayId
                            )
                        ],
                        ephemeral: true
                    });
                }

                // =====================================
                // CANCEL YES
                // =====================================

                if (
                    customId.startsWith(
                        "cancel_yes_"
                    )
                ) {

                    const giveawayId =
                        customId.replace(
                            "cancel_yes_",
                            ""
                        );

                    const giveaway =
                        db.getGiveaway(
                            giveawayId
                        );

                    if (!giveaway) {

                        return interaction.update({
                            content:
                                "❌ Giveaway not found.",
                            components: []
                        });
                    }

                    if (
                        giveaway.hostId !==
                        interaction.user.id
                    ) {

                        return interaction.update({
                            content:
                                "❌ Only the giveaway host can cancel this giveaway.",
                            components: []
                        });
                    }

                    await cancelGiveaway(
                        giveawayId
                    );

                    return interaction.update({
                        content:
                            "🛑 **Giveaway cancelled successfully.**",
                        components: []
                    });
                }

                // =====================================
                // CANCEL NO
                // =====================================

                if (
                    customId.startsWith(
                        "cancel_no_"
                    )
                ) {

                    return interaction.update({
                        content:
                            "✅ Giveaway cancellation cancelled.",
                        components: []
                    });
                }

                // =====================================
                // END GIVEAWAY
                // =====================================

                if (
                    customId.startsWith(
                        "end_"
                    )
                ) {

                    if (
                        !isGiveawayStaff(
                            interaction
                        )
                    ) {

                        return interaction.reply({
                            content:
                                "❌ You do not have permission to end giveaways.",
                            ephemeral: true
                        });
                    }

                    const giveawayId =
                        customId.replace(
                            "end_",
                            ""
                        );

                    await interaction.deferReply({
                        ephemeral: true
                    });

                    await endGiveaway(
                        giveawayId
                    );

                    return interaction.editReply({
                        content:
                            "🛑 **Giveaway ended successfully!**"
                    });
                }

                // =====================================
                // REROLL
                // =====================================

                if (
                    customId.startsWith(
                        "reroll_"
                    )
                ) {

                    if (
                        !isGiveawayStaff(
                            interaction
                        )
                    ) {

                        return interaction.reply({
                            content:
                                "❌ You do not have permission to reroll giveaways.",
                            ephemeral: true
                        });
                    }

                    const giveawayId =
                        customId.replace(
                            "reroll_",
                            ""
                        );

                    await rerollGiveaway(
                        interaction,
                        giveawayId
                    );

                    return;
                }
            }

            // =========================================
            // MODALS
            // =========================================

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

                    // =================================
                    // HOST CANNOT JOIN
                    // =================================

                    if (
                        giveaway.hostId ===
                        interaction.user.id
                    ) {

                        return interaction.reply({
                            content:
                                "❌ You are the host of this giveaway, so you cannot enter your own giveaway.",
                            ephemeral: true
                        });
                    }

                    // =================================
                    // SPECIAL ROLE CHECK
                    // =================================

                    if (
                        giveaway.specialRoleId &&
                        !interaction.member.roles.cache.has(
                            giveaway.specialRoleId
                        )
                    ) {

                        return interaction.reply({
                            content:
                                `❌ You cannot join this giveaway.\n\n` +
                                `You need the <@&${giveaway.specialRoleId}> role to participate.`,
                            ephemeral: true
                        });
                    }

                    const username =
                        interaction.fields
                            .getTextInputValue(
                                "roblox_username"
                            )
                            .trim();

                    if (!username) {

                        return interaction.reply({
                            content:
                                "❌ Please enter your Roblox username.",
                            ephemeral: true
                        });
                    }

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
                                "⚠️ You are already participating in this giveaway.",
                            ephemeral: true
                        });
                    }

                    db.addParticipant({
                        giveawayId,
                        discordId:
                            interaction.user.id,
                        discordTag:
                            interaction.user.tag,
                        robloxUsername:
                            username
                    });

                    const count =
                        db.getParticipants(
                            giveawayId
                        ).length;

                    await interaction.reply({
                        content:
                            `🎉 **You're in!**\n\n` +
                            `👤 Roblox: **${username}**\n` +
                            `💰 Prize: **${giveaway.robux.toLocaleString()} Robux**\n` +
                            `👥 Participants: **${count}**\n\n` +
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

            try {

                if (
                    interaction.replied
                ) {

                    await interaction.followUp({
                        content:
                            "❌ An error occurred. Please try again.",
                        ephemeral: true
                    });

                } else if (
                    interaction.deferred
                ) {

                    await interaction.editReply({
                        content:
                            "❌ An error occurred. Please try again."
                    });

                } else {

                    await interaction.reply({
                        content:
                            "❌ An error occurred. Please try again.",
                        ephemeral: true
                    });
                }

            } catch {}
        }
    }
);

// =====================================================
// CREATE GIVEAWAY
// =====================================================

async function createGiveawayFromCommand(
    interaction,
    isSpecial
) {

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
                "❌ Invalid duration.\n\n" +
                "Examples: `1m`, `30m`, `1h`, `12h`, `1d`, `3d`, `1w`.\n\n" +
                "Minimum: **1 minute**\n" +
                "Maximum: **1 week**",
            ephemeral: true
        });
    }

    let specialRole = null;

    if (isSpecial) {

        specialRole =
            interaction.options.getRole(
                "special_role"
            );

        if (!specialRole) {

            return interaction.reply({
                content:
                    "❌ Please select the role allowed to join this giveaway.",
                ephemeral: true
            });
        }

        if (
            specialRole.id ===
            interaction.guild.id
        ) {

            return interaction.reply({
                content:
                    "❌ You cannot use @everyone as the special giveaway role.",
                ephemeral: true
            });
        }

        if (specialRole.managed) {

            return interaction.reply({
                content:
                    "❌ You cannot use a managed or integration role as the special giveaway role.",
                ephemeral: true
            });
        }
    }

    const giveawayId =
        `${interaction.guild.id}-${Date.now()}`;

    const endTime =
        Date.now() +
        duration * 1000;

    const giveaway = {

        id:
            giveawayId,

        guildId:
            interaction.guild.id,

        channelId:
            interaction.channel.id,

        messageId:
            null,

        robux,

        winners,

        endTime,

        hostId:
            interaction.user.id,

        specialRoleId:
            specialRole
                ? specialRole.id
                : null,

        ended:
            0
    };

    db.createGiveaway(
        giveaway
    );

    const embed =
        createGiveawayEmbed(
            giveaway,
            0
        );

    const buttons =
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

            components:
                buttons,

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

            `✅ **${isSpecial ? "Special giveaway" : "Giveaway"} created!**\n\n` +

            `💰 Prize: **${robux.toLocaleString()} Robux**\n` +

            `⏱️ Duration: **${durationInput}**\n` +

            `🏆 Winners: **${winners}**` +

            (
                specialRole
                    ? `\n🎭 Required Role: ${specialRole}`
                    : ""
            ),

        ephemeral: true
    });

    scheduleGiveaway(
        giveawayId,
        endTime
    );
}

// =====================================================
// UPDATE GIVEAWAY MESSAGE
// =====================================================

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
            error.message
        );
    }
}

// =====================================================
// CANCEL GIVEAWAY
// =====================================================

async function cancelGiveaway(
    giveawayId
) {

    const giveaway =
        db.getGiveaway(
            giveawayId
        );

    if (!giveaway) {
        return false;
    }

    if (giveaway.ended) {
        return false;
    }

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

        const embed =
            new EmbedBuilder()
                .setTitle(
                    "🛑 Giveaway Cancelled"
                )
                .setDescription(
                    `💰 **Prize:** ${giveaway.robux.toLocaleString()} Robux\n\n` +
                    `❌ This giveaway was cancelled by the host.`
                )
                .setFooter({
                    text:
                        "Roblox Giveaway • Cancelled"
                })
                .setTimestamp();

        await message.edit({

            content: "",

            embeds: [
                embed
            ],

            components: []
        });

        console.log(
            `🛑 Giveaway ${giveawayId} cancelled.`
        );

        return true;

    } catch (error) {

        console.error(
            "❌ Could not cancel giveaway:",
            error.message
        );

        return false;
    }
}

// =====================================================
// END GIVEAWAY
// =====================================================

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

        // =========================================
        // NO PARTICIPANTS
        // =========================================

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

        // =========================================
        // PICK WINNERS
        // =========================================

        let winners =
            db.getWinners(
                giveawayId
            );

        if (
            winners.length === 0
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

                    giveawayId,

                    discordId:
                        winner.discordId,

                    discordTag:
                        winner.discordTag,

                    robloxUsername:
                        winner.robloxUsername
                });
            }

            winners =
                db.getWinners(
                    giveawayId
                );
        }

        // =========================================
        // CREATE TICKETS
        // =========================================

        await createTicketsForWinners(
            giveaway,
            winners
        );

        // =========================================
        // WINNER MESSAGE
        // =========================================

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
                .setEmoji("🔄")
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
            `🏆 Giveaway ${giveawayId} ended.`
        );

    } catch (error) {

        console.error(
            "❌ Giveaway ending error:",
            error
        );
    }
}

// =====================================================
// CREATE TICKETS
// =====================================================

async function createTicketsForWinners(
    giveaway,
    winners
) {

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

            if (
                result &&
                result.channelId
            ) {

                console.log(
                    `📁 Ticket Channel: ${result.channelId}`
                );
            }

        } catch (error) {

            console.error(
                `❌ Could not create ticket for ${winner.discordTag}: ${error.message}`
            );
        }
    }
}

// =====================================================
// REROLL
// =====================================================

async function rerollGiveaway(
    interaction,
    giveawayId
) {

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

    const participants =
        db.getParticipants(
            giveawayId
        );

    const previousWinners =
        db.getWinners(
            giveawayId
        );

    const previousIds =
        previousWinners.map(
            winner =>
                winner.discordId
        );

    const available =
        participants.filter(
            participant =>
                !previousIds.includes(
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

        giveawayId,

        discordId:
            newWinner.discordId,

        discordTag:
            newWinner.discordTag,

        robloxUsername:
            newWinner.robloxUsername
    });

    try {

        await sendWinnerToTicketBot({

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

    } catch (error) {

        console.error(
            `❌ Could not create reroll ticket for ${newWinner.discordTag}:`,
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
        new EmbedBuilder()
            .setTitle(
                "🎉 GIVEAWAY ENDED!"
            )
            .setDescription(
                `💰 **Prize:** ${giveaway.robux.toLocaleString()} Robux\n\n` +
                `🏆 **Winner(s):**\n` +
                `${winnerText}\n\n` +
                `👥 Participants: **${participants.length}**\n\n` +
                `🔄 Winner rerolled!`
            )
            .setTimestamp();

    const button =
        new ButtonBuilder()
            .setCustomId(
                `reroll_${giveawayId}`
            )
            .setLabel(
                "Reroll Winner"
            )
            .setEmoji("🔄")
            .setStyle(
                ButtonStyle.Primary
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
            new ActionRowBuilder()
                .addComponents(
                    button
                )
        ]
    });

    return interaction.reply({

        content:
            `🔄 **Reroll complete!**\n\n` +
            `🏆 New winner: <@${newWinner.discordId}>`,

        ephemeral: true
    });
}

// =====================================================
// SCHEDULE
// =====================================================

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

// =====================================================
// RESTORE GIVEAWAYS
// =====================================================

async function restoreGiveaways() {

    const giveaways =
        db.getActiveGiveaways();

    console.log(
        `📦 Found ${giveaways.length} active giveaway(s).`
    );

    for (
        const giveaway of giveaways
    ) {

        if (
            Date.now() >=
            giveaway.endTime
        ) {

            await endGiveaway(
                giveaway.id
            );

        } else {

            scheduleGiveaway(
                giveaway.id,
                giveaway.endTime
            );

            await updateGiveawayMessage(
                giveaway.id
            );
        }
    }
}

// =====================================================
// TICKET BOT API
// =====================================================

async function sendWinnerToTicketBot(
    data
) {

    const apiUrl =
        process.env.TICKET_API_URL;

    const apiSecret =
        process.env.TICKET_API_SECRET;

    if (!apiUrl) {

        throw new Error(
            "TICKET_API_URL is missing."
        );
    }

    if (!apiSecret) {

        throw new Error(
            "TICKET_API_SECRET is missing."
        );
    }

    const response =
        await fetch(
            `${apiUrl}/internal/giveaway-winner`,
            {

                method: "POST",

                headers: {

                    "Content-Type":
                        "application/json",

                    "x-api-secret":
                        apiSecret
                },

                body:
                    JSON.stringify({

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
            JSON.parse(text);

    } catch {

        result = {
            message: text
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

// =====================================================
// START
// =====================================================

async function start() {

    if (
        !process.env.GIVEAWAY_BOT_TOKEN
    ) {

        console.error(
            "❌ GIVEAWAY_BOT_TOKEN is missing."
        );

        process.exit(1);
    }

    if (
        !process.env.TICKET_API_URL
    ) {

        console.error(
            "❌ TICKET_API_URL is missing."
        );

        process.exit(1);
    }

    if (
        !process.env.TICKET_API_SECRET
    ) {

        console.error(
            "❌ TICKET_API_SECRET is missing."
        );

        process.exit(1);
    }

    try {

        await client.login(
            process.env.GIVEAWAY_BOT_TOKEN
        );

    } catch (error) {

        console.error(
            "❌ Failed to login:",
            error
        );

        process.exit(1);
    }
}

start();
