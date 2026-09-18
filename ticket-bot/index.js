require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    PermissionsBitField,
    ChannelType,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags,
    REST,
    Routes
} = require("discord.js");

const express = require("express");

const {
    getTicketConfig,
    createTicket,
    getTicket,
    getTicketByChannelId,
    setChannelId,
    setGamepassUrl,
    closeTicket
} = require("./database");

// ======================================================
// CONFIG
// ======================================================

const TOKEN = process.env.TOKEN;
const API_SECRET = process.env.API_SECRET;
const API_PORT = Number(process.env.API_PORT || 3001);

const config = require("./config.json");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds
    ]
});

// ======================================================
// DISCORD COMMANDS
// ======================================================

const commands = [
    {
        name: "setup-tickets",
        description:
            "Set the category and staff role for giveaway winner tickets.",
        default_member_permissions:
            PermissionsBitField.Flags.ManageGuild.toString(),

        options: [
            {
                name: "category",
                description:
                    "The category where giveaway winner tickets will be created.",
                type: 7,
                required: true,
                channel_types: [
                    ChannelType.GuildCategory
                ]
            },

            {
                name: "staff_role",
                description:
                    "The role allowed to view and manage giveaway tickets.",
                type: 8,
                required: true
            }
        ]
    },

    {
        name: "ticket-manage",
        description:
            "Open the staff controls for the current giveaway ticket."
    }
];

// ======================================================
// COMMAND REGISTRATION
// ======================================================

async function registerCommands() {
    try {
        console.log("Registering Ticket Bot commands...");

        const rest = new REST({
            version: "10"
        }).setToken(TOKEN);

        // --------------------------------------------------
        // GLOBAL COMMANDS
        // --------------------------------------------------

        await rest.put(
            Routes.applicationCommands(config.clientId),
            {
                body: commands
            }
        );

        console.log("✅ Global commands registered.");

        // --------------------------------------------------
        // REGISTER IN EVERY SERVER
        // --------------------------------------------------

        for (const [guildId, guild] of client.guilds.cache) {
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

        console.log(
            "✅ Available commands: /setup-tickets, /ticket-manage"
        );

    } catch (error) {
        console.error(
            "❌ Failed to register commands:",
            error
        );
    }
}

// ======================================================
// STAFF PERMISSION
// ======================================================

async function isStaff(interaction) {
    if (!interaction.guild) {
        return false;
    }

    const member = interaction.member;

    if (!member) {
        return false;
    }

    // --------------------------------------------------
    // Manage Server
    // --------------------------------------------------

    if (
        member.permissions &&
        member.permissions.has(
            PermissionsBitField.Flags.ManageGuild
        )
    ) {
        return true;
    }

    // --------------------------------------------------
    // Configured Staff Role
    // --------------------------------------------------

    const ticketConfig = getTicketConfig(
        interaction.guild.id
    );

    if (
        ticketConfig &&
        ticketConfig.staffRoleId &&
        member.roles &&
        member.roles.cache.has(
            ticketConfig.staffRoleId
        )
    ) {
        return true;
    }

    return false;
}

// ======================================================
// GAME PASS URL VALIDATION
// ======================================================

function extractGamePassId(url) {
    if (
        !url ||
        typeof url !== "string"
    ) {
        return null;
    }

    url = url.trim();

    // Maximum URL length
    if (url.length > 500) {
        return null;
    }

    try {
        const parsed = new URL(url);

        // --------------------------------------------------
        // HTTPS ONLY
        // --------------------------------------------------

        if (parsed.protocol !== "https:") {
            return null;
        }

        // --------------------------------------------------
        // ROBLOX ONLY
        // --------------------------------------------------

        const hostname =
            parsed.hostname.toLowerCase();

        if (
            hostname !== "roblox.com" &&
            hostname !== "www.roblox.com"
        ) {
            return null;
        }

        // --------------------------------------------------
        // BLOCK USERNAME / PASSWORD
        // --------------------------------------------------

        if (
            parsed.username ||
            parsed.password
        ) {
            return null;
        }

        // --------------------------------------------------
        // BLOCK CUSTOM PORT
        // --------------------------------------------------

        if (parsed.port) {
            return null;
        }

        // --------------------------------------------------
        // GAME PASS URL
        //
        // Accepted:
        // https://www.roblox.com/game-pass/123456789
        //
        // Also accepted:
        // https://www.roblox.com/game-pass/123456789/name
        // --------------------------------------------------

        const match = parsed.pathname.match(
            /^\/game-pass\/(\d+)(?:\/.*)?$/i
        );

        if (!match) {
            return null;
        }

        return match[1];

    } catch {
        return null;
    }
}

// ======================================================
// NORMALIZE GAME PASS URL
// ======================================================

function normalizeGamePassUrl(url) {
    const gamePassId =
        extractGamePassId(url);

    if (!gamePassId) {
        return null;
    }

    return `https://www.roblox.com/game-pass/${gamePassId}`;
}

// ======================================================
// CREATE WINNER TICKET
// ======================================================

async function createWinnerTicket(data) {

    const {
        guildId,
        discordId,
        robloxUsername,
        robux,
        giveawayId
    } = data;

    // ==================================================
    // GET GUILD
    // ==================================================

    const guild =
        client.guilds.cache.get(guildId);

    if (!guild) {
        throw new Error(
            "Guild not found."
        );
    }

    // ==================================================
    // GET TICKET CONFIG
    // ==================================================

    const ticketConfig =
        getTicketConfig(guildId);

    if (!ticketConfig) {
        throw new Error(
            "Ticket system has not been configured in this server."
        );
    }

    // ==================================================
    // STAFF ROLE MUST EXIST
    // ==================================================

    if (!ticketConfig.staffRoleId) {
        throw new Error(
            "The ticket Staff Role has not been configured."
        );
    }

    const staffRole =
        guild.roles.cache.get(
            ticketConfig.staffRoleId
        );

    if (!staffRole) {
        throw new Error(
            "The configured ticket Staff Role no longer exists."
        );
    }

    // ==================================================
    // CHECK EXISTING TICKET
    // ==================================================

    const existingTicket =
        getTicket(
            giveawayId,
            discordId
        );

    if (existingTicket) {

        if (existingTicket.channelId) {

            const existingChannel =
                guild.channels.cache.get(
                    existingTicket.channelId
                );

            if (existingChannel) {
                return existingChannel;
            }
        }
    }

    // ==================================================
    // CREATE DATABASE TICKET
    // ==================================================

    const ticketId =
        createTicket({
            giveawayId,
            guildId,
            discordId,
            robloxUsername,
            robux
        });

    // ==================================================
    // FETCH WINNER
    // ==================================================

    let winnerUser;

    try {

        winnerUser =
            await client.users.fetch(
                discordId
            );

    } catch (error) {

        console.error(
            "❌ Could not fetch winner user:",
            error
        );

        throw new Error(
            "Could not find the giveaway winner on Discord."
        );
    }

    // ==================================================
    // VALIDATE CATEGORY
    // ==================================================

    const category =
        guild.channels.cache.get(
            ticketConfig.categoryId
        );

    if (
        !category ||
        category.type !== ChannelType.GuildCategory
    ) {
        throw new Error(
            "The configured ticket category no longer exists."
        );
    }

    // ==================================================
    // CHANNEL PERMISSIONS
    //
    // ONLY:
    // 1. Giveaway winner
    // 2. Ticket Staff Role
    // 3. Bot
    //
    // @everyone CANNOT SEE THE TICKET
    // ==================================================

    const permissionOverwrites = [

        // --------------------------------------------------
        // EVERYONE
        // --------------------------------------------------

        {
            id: guild.id,

            deny: [
                PermissionsBitField.Flags.ViewChannel
            ]
        },

        // --------------------------------------------------
        // WINNER
        // --------------------------------------------------

        {
            id: winnerUser.id,

            allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory
            ],

            deny: [
                PermissionsBitField.Flags.ManageChannels,
                PermissionsBitField.Flags.ManageMessages
            ]
        },

        // --------------------------------------------------
        // STAFF ROLE
        // --------------------------------------------------

        {
            id: staffRole.id,

            allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory,
                PermissionsBitField.Flags.ManageChannels,
                PermissionsBitField.Flags.ManageMessages
            ]
        },

        // --------------------------------------------------
        // BOT
        // --------------------------------------------------

        {
            id: client.user.id,

            allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory,
                PermissionsBitField.Flags.ManageChannels,
                PermissionsBitField.Flags.ManageMessages
            ]
        }
    ];

    // ==================================================
    // SAFE CHANNEL NAME
    // ==================================================

    const safeUsername =
        String(robloxUsername)
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, "")
            .slice(0, 20) ||
        "winner";

    // ==================================================
    // CREATE CHANNEL
    // ==================================================

    let channel;

    try {

        channel =
            await guild.channels.create({
                name: `ticket-${safeUsername}`,
                type: ChannelType.GuildText,
                parent: category.id,
                permissionOverwrites
            });

    } catch (error) {

        console.error(
            "❌ Failed to create ticket channel:",
            error
        );

        throw new Error(
            `Discord could not create the ticket channel: ${error.message}`
        );
    }

    // ==================================================
    // SAVE CHANNEL ID
    // ==================================================

    setChannelId(
        ticketId,
        channel.id
    );

    // ==================================================
    // TICKET EMBED
    // ==================================================

    const embed =
        new EmbedBuilder()
            .setTitle(
                "🎉 Giveaway Winner Ticket"
            )
            .setDescription(
                "Congratulations! You won a giveaway.\n\n" +
                "Please follow the instructions below to receive your Robux."
            )
            .addFields(

                {
                    name: "🎮 Roblox Username",
                    value:
                        `\`${robloxUsername}\``,
                    inline: true
                },

                {
                    name: "💰 Prize",
                    value:
                        `**${robux} Robux**`,
                    inline: true
                },

                {
                    name: "📋 What to do",
                    value:
                        "1. Create a **Game Pass** on your Roblox account.\n" +
                        `2. Set the Game Pass price to exactly **${robux} Robux**.\n` +
                        "3. Make sure the Game Pass is **On Sale**.\n" +
                        "4. Make sure you are the creator of the Game Pass.\n" +
                        "5. Click **Submit Game Pass** below and send the link.\n\n" +
                        "Staff will manually verify the Game Pass before sending the Robux."
                }

            )
            .setFooter({
                text:
                    "Do not delete or change the Game Pass until staff finishes verification."
            });

    // ==================================================
    // PLAYER BUTTON
    // ==================================================

    const playerButtons =
        new ActionRowBuilder()
            .addComponents(

                new ButtonBuilder()
                    .setCustomId(
                        `submit_gamepass_${ticketId}`
                    )
                    .setLabel(
                        "Submit Game Pass"
                    )
                    .setEmoji("🎮")
                    .setStyle(
                        ButtonStyle.Primary
                    )

            );

    // ==================================================
    // SEND PLAYER TICKET MESSAGE
    // ==================================================

    try {

        await channel.send({
            content:
                `<@${winnerUser.id}>`,
            embeds: [embed],
            components: [playerButtons]
        });

    } catch (error) {

        console.error(
            "❌ Failed to send ticket message:",
            error
        );

        try {
            await channel.delete(
                "Failed to send ticket message"
            );
        } catch {}

        throw new Error(
            `Ticket channel was created, but the bot could not send the ticket message: ${error.message}`
        );
    }

    console.log(
        `🎫 Ticket created for ${robloxUsername}`
    );

    console.log(
        `📁 Channel ID: ${channel.id}`
    );

    console.log(
        `👮 Staff Role: ${staffRole.name}`
    );

    return channel;
}

// ======================================================
// SLASH COMMANDS
// ======================================================

client.on(
    "interactionCreate",
    async interaction => {

        // ==================================================
        // SETUP TICKETS
        // ==================================================

        if (
            interaction.isChatInputCommand() &&
            interaction.commandName === "setup-tickets"
        ) {

            try {

                // --------------------------------------------------
                // MANAGE SERVER REQUIRED
                // --------------------------------------------------

                if (
                    !interaction.memberPermissions ||
                    !interaction.memberPermissions.has(
                        PermissionsBitField.Flags.ManageGuild
                    )
                ) {

                    return interaction.reply({
                        content:
                            "❌ You need the **Manage Server** permission to use this command.",

                        flags:
                            MessageFlags.Ephemeral
                    });
                }

                // --------------------------------------------------
                // GET CATEGORY
                // --------------------------------------------------

                const category =
                    interaction.options.getChannel(
                        "category",
                        true
                    );

                // --------------------------------------------------
                // GET STAFF ROLE
                // --------------------------------------------------

                const staffRole =
                    interaction.options.getRole(
                        "staff_role",
                        true
                    );

                // --------------------------------------------------
                // VALIDATE CATEGORY
                // --------------------------------------------------

                if (
                    !category ||
                    category.type !== ChannelType.GuildCategory
                ) {

                    return interaction.reply({
                        content:
                            "❌ Please select a valid server category.",

                        flags:
                            MessageFlags.Ephemeral
                    });
                }

                // --------------------------------------------------
                // VALIDATE STAFF ROLE
                // --------------------------------------------------

                if (!staffRole) {

                    return interaction.reply({
                        content:
                            "❌ You must select a Staff Role.",

                        flags:
                            MessageFlags.Ephemeral
                    });
                }

                // @everyone cannot be used
                if (
                    staffRole.id ===
                    interaction.guild.id
                ) {

                    return interaction.reply({
                        content:
                            "❌ You cannot use @everyone as the Staff Role.",

                        flags:
                            MessageFlags.Ephemeral
                    });
                }

                // Managed roles cannot be selected
                if (staffRole.managed) {

                    return interaction.reply({
                        content:
                            "❌ Please select a normal server role, not a managed role.",

                        flags:
                            MessageFlags.Ephemeral
                    });
                }

                // --------------------------------------------------
                // SAVE CONFIG
                // --------------------------------------------------

                const database =
                    require("./database");

                database.setTicketConfig(
                    interaction.guild.id,
                    category.id,
                    staffRole.id
                );

                // --------------------------------------------------
                // SUCCESS
                // --------------------------------------------------

                await interaction.reply({

                    content:
                        "✅ **Ticket system configured successfully.**\n\n" +

                        `📁 Category: <#${category.id}>\n` +

                        `👮 Staff Role: <@&${staffRole.id}>\n\n` +

                        "🎫 Giveaway tickets will only be visible to the giveaway winner and members with the Staff Role.",

                    flags:
                        MessageFlags.Ephemeral
                });

            } catch (error) {

                console.error(
                    "❌ Setup ticket error:",
                    error
                );

                if (!interaction.replied) {

                    await interaction.reply({

                        content:
                            "❌ An error occurred while configuring the ticket system.",

                        flags:
                            MessageFlags.Ephemeral
                    });
                }
            }

            return;
        }

        // ==================================================
        // TICKET MANAGE
        // ==================================================

        if (
            interaction.isChatInputCommand() &&
            interaction.commandName === "ticket-manage"
        ) {

            try {

                // --------------------------------------------------
                // STAFF ONLY
                // --------------------------------------------------

                if (!(await isStaff(interaction))) {

                    return interaction.reply({
                        content:
                            "❌ Only ticket staff can use this command.",

                        flags:
                            MessageFlags.Ephemeral
                    });
                }

                // --------------------------------------------------
                // MUST BE INSIDE TICKET
                // --------------------------------------------------

                if (!interaction.channel) {

                    return interaction.reply({
                        content:
                            "❌ This command must be used inside a ticket.",

                        flags:
                            MessageFlags.Ephemeral
                    });
                }

                // --------------------------------------------------
                // FIND TICKET BY CHANNEL
                // --------------------------------------------------

                const ticket =
                    getTicketByChannelId(
                        interaction.channel.id
                    );

                if (!ticket) {

                    return interaction.reply({
                        content:
                            "❌ This channel is not a giveaway ticket.",

                        flags:
                            MessageFlags.Ephemeral
                    });
                }

                const ticketId =
                    ticket.id;

                // --------------------------------------------------
                // STAFF BUTTONS
                // --------------------------------------------------

                const staffButtons =
                    new ActionRowBuilder()
                        .addComponents(

                            new ButtonBuilder()
                                .setCustomId(
                                    `verify_gamepass_${ticketId}`
                                )
                                .setLabel(
                                    "Verify Game Pass"
                                )
                                .setEmoji("🔎")
                                .setStyle(
                                    ButtonStyle.Success
                                ),

                            new ButtonBuilder()
                                .setCustomId(
                                    `mark_paid_${ticketId}`
                                )
                                .setLabel(
                                    "Mark as Paid"
                                )
                                .setEmoji("💸")
                                .setStyle(
                                    ButtonStyle.Success
                                ),

                            new ButtonBuilder()
                                .setCustomId(
                                    `close_ticket_${ticketId}`
                                )
                                .setLabel(
                                    "Close Ticket"
                                )
                                .setEmoji("🔒")
                                .setStyle(
                                    ButtonStyle.Danger
                                )

                        );

                return interaction.reply({

                    content:
                        "👮 **Staff Controls**\n\n" +
                        "These controls are only visible to you.",

                    components:
                        [staffButtons],

                    flags:
                        MessageFlags.Ephemeral
                });

            } catch (error) {

                console.error(
                    "❌ Ticket manage error:",
                    error
                );

                if (
                    interaction.isRepliable() &&
                    !interaction.replied
                ) {

                    await interaction.reply({

                        content:
                            "❌ An error occurred while opening staff controls.",

                        flags:
                            MessageFlags.Ephemeral
                    });
                }
            }

            return;
        }
    }
);

// ======================================================
// BUTTONS + MODALS
// ======================================================

client.on(
    "interactionCreate",
    async interaction => {

        try {

            // ==================================================
            // SUBMIT GAME PASS
            // ==================================================

            if (
                interaction.isButton() &&
                interaction.customId.startsWith(
                    "submit_gamepass_"
                )
            ) {

                const ticketId =
                    Number(
                        interaction.customId.replace(
                            "submit_gamepass_",
                            ""
                        )
                    );

                const ticket =
                    getTicket(ticketId);

                if (!ticket) {

                    return interaction.reply({
                        content:
                            "❌ This ticket could not be found.",

                        flags:
                            MessageFlags.Ephemeral
                    });
                }

                // --------------------------------------------------
                // ONLY WINNER OR STAFF
                // --------------------------------------------------

                const staff =
                    await isStaff(interaction);

                if (
                    interaction.user.id !==
                        ticket.discordId &&
                    !staff
                ) {

                    return interaction.reply({
                        content:
                            "❌ Only the winner or ticket staff can submit a Game Pass.",

                        flags:
                            MessageFlags.Ephemeral
                    });
                }

                // --------------------------------------------------
                // MODAL
                // --------------------------------------------------

                const modal =
                    new ModalBuilder()
                        .setCustomId(
                            `gamepass_modal_${ticketId}`
                        )
                        .setTitle(
                            "Submit Game Pass"
                        );

                const input =
                    new TextInputBuilder()
                        .setCustomId(
                            "gamepass_url"
                        )
                        .setLabel(
                            "Roblox Game Pass URL"
                        )
                        .setPlaceholder(
                            "https://www.roblox.com/game-pass/123456789"
                        )
                        .setStyle(
                            TextInputStyle.Short
                        )
                        .setRequired(true);

                modal.addComponents(
                    new ActionRowBuilder()
                        .addComponents(input)
                );

                return interaction.showModal(
                    modal
                );
            }

            // ==================================================
            // VERIFY GAME PASS
            // ==================================================

            if (
                interaction.isButton() &&
                interaction.customId.startsWith(
                    "verify_gamepass_"
                )
            ) {

                // --------------------------------------------------
                // STAFF ONLY
                // --------------------------------------------------

                if (!(await isStaff(interaction))) {

                    return interaction.reply({
                        content:
                            "❌ Only ticket staff can verify Game Passes.",

                        flags:
                            MessageFlags.Ephemeral
                    });
                }

                const ticketId =
                    Number(
                        interaction.customId.replace(
                            "verify_gamepass_",
                            ""
                        )
                    );

                const ticket =
                    getTicket(ticketId);

                if (!ticket) {

                    return interaction.reply({
                        content:
                            "❌ This ticket could not be found.",

                        flags:
                            MessageFlags.Ephemeral
                    });
                }

                // --------------------------------------------------
                // NO GAME PASS YET
                // --------------------------------------------------

                if (!ticket.gamepassUrl) {

                    return interaction.reply({
                        content:
                            "❌ The winner has not submitted a Game Pass link yet.",

                        flags:
                            MessageFlags.Ephemeral
                    });
                }

                // --------------------------------------------------
                // VALIDATE URL
                // --------------------------------------------------

                const gamePassId =
                    extractGamePassId(
                        ticket.gamepassUrl
                    );

                if (!gamePassId) {

                    return interaction.reply({
                        content:
                            "❌ The submitted Game Pass URL is invalid.",

                        flags:
                            MessageFlags.Ephemeral
                    });
                }

                // --------------------------------------------------
                // VERIFICATION EMBED
                // --------------------------------------------------

                const verifiedEmbed =
                    new EmbedBuilder()
                        .setTitle(
                            "🔎 Game Pass Submitted"
                        )
                        .setDescription(

                            "The Game Pass link is a valid Roblox Game Pass URL.\n\n" +

                            "⚠️ **Manual verification required:**\n" +

                            "Open the Game Pass below in your browser and manually check the Game Pass before paying the winner.\n\n" +

                            "The bot does **not** automatically verify the price, creator, On Sale status, or other Roblox properties."

                        )
                        .addFields(

                            {
                                name:
                                    "🎮 Roblox Username",

                                value:
                                    `\`${ticket.robloxUsername}\``,

                                inline:
                                    true
                            },

                            {
                                name:
                                    "💰 Giveaway Prize",

                                value:
                                    `**${ticket.robux} Robux**`,

                                inline:
                                    true
                            },

                            {
                                name:
                                    "🆔 Game Pass ID",

                                value:
                                    `\`${gamePassId}\``,

                                inline:
                                    true
                            },

                            {
                                name:
                                    "🔗 Submitted Game Pass",

                                value:
                                    ticket.gamepassUrl,

                                inline:
                                    false
                            }

                        );

                // --------------------------------------------------
                // STAFF BUTTONS
                // --------------------------------------------------

                const verificationButtons =
                    new ActionRowBuilder()
                        .addComponents(

                            new ButtonBuilder()
                                .setLabel(
                                    "Open Game Pass"
                                )
                                .setEmoji("🌐")
                                .setStyle(
                                    ButtonStyle.Link
                                )
                                .setURL(
                                    ticket.gamepassUrl
                                ),

                            new ButtonBuilder()
                                .setCustomId(
                                    `mark_paid_${ticketId}`
                                )
                                .setLabel(
                                    "Mark as Paid"
                                )
                                .setEmoji("💸")
                                .setStyle(
                                    ButtonStyle.Success
                                ),

                            new ButtonBuilder()
                                .setCustomId(
                                    `close_ticket_${ticketId}`
                                )
                                .setLabel(
                                    "Close Ticket"
                                )
                                .setEmoji("🔒")
                                .setStyle(
                                    ButtonStyle.Danger
                                )

                        );

                return interaction.reply({

                    embeds:
                        [verifiedEmbed],

                    components:
                        [verificationButtons],

                    flags:
                        MessageFlags.Ephemeral
                });
            }

            // ==================================================
            // MARK AS PAID
            // ==================================================

            if (
                interaction.isButton() &&
                interaction.customId.startsWith(
                    "mark_paid_"
                )
            ) {

                // --------------------------------------------------
                // STAFF ONLY
                // --------------------------------------------------

                if (!(await isStaff(interaction))) {

                    return interaction.reply({
                        content:
                            "❌ Only ticket staff can mark a ticket as paid.",

                        flags:
                            MessageFlags.Ephemeral
                    });
                }

                const ticketId =
                    Number(
                        interaction.customId.replace(
                            "mark_paid_",
                            ""
                        )
                    );

                const ticket =
                    getTicket(ticketId);

                if (!ticket) {

                    return interaction.reply({
                        content:
                            "❌ This ticket could not be found.",

                        flags:
                            MessageFlags.Ephemeral
                    });
                }

                // --------------------------------------------------
                // MARK PAID
                // --------------------------------------------------

                closeTicket(
                    ticketId,
                    "paid"
                );

                await interaction.reply({

                    content:
                        "💸 **Payment marked as completed.**\n\n" +
                        "The ticket will be deleted in 5 seconds.",

                    flags:
                        MessageFlags.Ephemeral
                });

                // --------------------------------------------------
                // INFORM WINNER
                // --------------------------------------------------

                try {

                    await interaction.channel.send({

                        content:
                            `💸 <@${ticket.discordId}>\n\n` +
                            `Your **${ticket.robux} Robux** giveaway reward has been marked as paid by staff.`

                    });

                } catch (error) {

                    console.error(
                        "❌ Failed to send payment message:",
                        error
                    );
                }

                // --------------------------------------------------
                // DELETE AFTER 5 SECONDS
                // --------------------------------------------------

                setTimeout(
                    async () => {

                        try {

                            if (
                                interaction.channel &&
                                interaction.channel.deletable
                            ) {

                                await interaction.channel.delete(
                                    "Giveaway reward paid"
                                );
                            }

                        } catch (error) {

                            console.error(
                                "❌ Failed to delete paid ticket:",
                                error
                            );
                        }

                    },
                    5000
                );

                return;
            }

            // ==================================================
            // CLOSE TICKET
            // ==================================================

            if (
                interaction.isButton() &&
                interaction.customId.startsWith(
                    "close_ticket_"
                )
            ) {

                // --------------------------------------------------
                // STAFF ONLY
                // --------------------------------------------------

                if (!(await isStaff(interaction))) {

                    return interaction.reply({
                        content:
                            "❌ Only ticket staff can close giveaway tickets.",

                        flags:
                            MessageFlags.Ephemeral
                    });
                }

                const ticketId =
                    Number(
                        interaction.customId.replace(
                            "close_ticket_",
                            ""
                        )
                    );

                const ticket =
                    getTicket(ticketId);

                if (!ticket) {

                    return interaction.reply({
                        content:
                            "❌ This ticket could not be found.",

                        flags:
                            MessageFlags.Ephemeral
                    });
                }

                await interaction.reply({

                    content:
                        "🔒 This ticket will be closed in 5 seconds.",

                    flags:
                        MessageFlags.Ephemeral
                });

                // --------------------------------------------------
                // DELETE AFTER 5 SECONDS
                // --------------------------------------------------

                setTimeout(
                    async () => {

                        try {

                            closeTicket(
                                ticketId,
                                "closed"
                            );

                            if (
                                interaction.channel &&
                                interaction.channel.deletable
                            ) {

                                await interaction.channel.delete(
                                    "Ticket closed by staff"
                                );
                            }

                        } catch (error) {

                            console.error(
                                "❌ Failed to close ticket:",
                                error
                            );
                        }

                    },
                    5000
                );

                return;
            }

            // ==================================================
            // GAME PASS MODAL
            // ==================================================

            if (
                interaction.isModalSubmit() &&
                interaction.customId.startsWith(
                    "gamepass_modal_"
                )
            ) {

                const ticketId =
                    Number(
                        interaction.customId.replace(
                            "gamepass_modal_",
                            ""
                        )
                    );

                const ticket =
                    getTicket(ticketId);

                if (!ticket) {

                    return interaction.reply({
                        content:
                            "❌ This ticket could not be found.",

                        flags:
                            MessageFlags.Ephemeral
                    });
                }

                // --------------------------------------------------
                // ONLY WINNER OR STAFF
                // --------------------------------------------------

                const staff =
                    await isStaff(interaction);

                if (
                    interaction.user.id !==
                        ticket.discordId &&
                    !staff
                ) {

                    return interaction.reply({
                        content:
                            "❌ Only the winner or ticket staff can submit a Game Pass.",

                        flags:
                            MessageFlags.Ephemeral
                    });
                }

                // --------------------------------------------------
                // GET URL
                // --------------------------------------------------

                const url =
                    interaction.fields
                        .getTextInputValue(
                            "gamepass_url"
                        )
                        .trim();

                // ==================================================
                // ONLY CHECK GAME PASS URL
                // ==================================================

                const gamePassId =
                    extractGamePassId(url);

                if (!gamePassId) {

                    return interaction.reply({

                        content:
                            "❌ Invalid Game Pass URL.\n\n" +

                            "Only a valid HTTPS Roblox Game Pass link is accepted.\n\n" +

                            "Example:\n" +

                            "`https://www.roblox.com/game-pass/123456789`",

                        flags:
                            MessageFlags.Ephemeral
                    });
                }

                // ==================================================
                // SAVE CLEAN URL
                // ==================================================

                const cleanUrl =
                    normalizeGamePassUrl(url);

                setGamepassUrl(
                    ticketId,
                    cleanUrl
                );

                // ==================================================
                // CONFIRM TO WINNER
                // ==================================================

                await interaction.reply({

                    content:
                        "✅ Game Pass link submitted successfully.\n\n" +

                        "Staff can now use `/ticket-manage` and click **Verify Game Pass** to manually verify it.",

                    flags:
                        MessageFlags.Ephemeral
                });

                // ==================================================
                // INFORM STAFF
                // ==================================================

                try {

                    await interaction.channel.send({

                        content:
                            `🎮 <@${ticket.discordId}> submitted a Game Pass.\n\n` +
                            "Staff can now use `/ticket-manage` to verify it."

                    });

                } catch (error) {

                    console.error(
                        "❌ Failed to send submission message:",
                        error
                    );
                }

                return;
            }

        } catch (error) {

            console.error(
                "❌ Interaction error:",
                error
            );

            if (
                interaction.isRepliable() &&
                !interaction.replied &&
                !interaction.deferred
            ) {

                try {

                    await interaction.reply({

                        content:
                            "❌ An unexpected error occurred. Please try again.",

                        flags:
                            MessageFlags.Ephemeral
                    });

                } catch {}
            }
        }
    }
);

// ======================================================
// INTERNAL API
// ======================================================

const app = express();

app.use(
    express.json()
);

// ======================================================
// HEALTH CHECK
// ======================================================

app.get(
    "/internal/health",
    (req, res) => {

        res.json({
            success: true,
            service: "ticket-bot"
        });
    }
);

// ======================================================
// GIVEAWAY WINNER -> CREATE TICKET
// ======================================================

app.post(
    "/internal/giveaway-winner",
    async (req, res) => {

        try {

            // --------------------------------------------------
            // API SECRET
            // --------------------------------------------------

            const secret =
                req.headers["x-api-secret"];

            if (
                !API_SECRET ||
                secret !== API_SECRET
            ) {

                return res
                    .status(401)
                    .json({
                        success: false,
                        error: "Unauthorized"
                    });
            }

            // --------------------------------------------------
            // DATA
            // --------------------------------------------------

            const {
                guildId,
                discordId,
                robloxUsername,
                robux,
                giveawayId
            } = req.body;

            // --------------------------------------------------
            // VALIDATE DATA
            // --------------------------------------------------

            if (
                !guildId ||
                !discordId ||
                !robloxUsername ||
                !robux ||
                !giveawayId
            ) {

                return res
                    .status(400)
                    .json({
                        success: false,
                        error:
                            "Missing required winner data."
                    });
            }

            // --------------------------------------------------
            // CREATE TICKET
            // --------------------------------------------------

            const channel =
                await createWinnerTicket({

                    guildId,
                    discordId,
                    robloxUsername,
                    robux: Number(robux),
                    giveawayId

                });

            return res.json({

                success:
                    true,

                channelId:
                    channel.id

            });

        } catch (error) {

            console.error(
                "❌ Winner ticket API error:",
                error
            );

            return res
                .status(500)
                .json({

                    success:
                        false,

                    error:
                        error.message ||
                        "Internal server error"

                });
        }
    }
);

// ======================================================
// API SERVER
// ======================================================

app.listen(
    API_PORT,
    "127.0.0.1",
    () => {

        console.log(
            `🌐 Internal API running on 127.0.0.1:${API_PORT}`
        );
    }
);

// ======================================================
// BOT READY
// ======================================================

client.once(
    "clientReady",
    () => {

        console.log(
            `✅ Ticket Bot logged in as ${client.user.tag}`
        );

        console.log(
            `🆔 Bot ID: ${client.user.id}`
        );

        console.log(
            `🏠 Connected to ${client.guilds.cache.size} server(s)`
        );
    }
);

// ======================================================
// NEW SERVER
// ======================================================

client.on(
    "guildCreate",
    async guild => {

        try {

            const rest =
                new REST({
                    version: "10"
                }).setToken(TOKEN);

            await rest.put(

                Routes.applicationGuildCommands(
                    config.clientId,
                    guild.id
                ),

                {
                    body: commands
                }
            );

            console.log(
                `✅ Commands registered in new server: ${guild.name}`
            );

        } catch (error) {

            console.error(
                `❌ Failed to register commands in new server ${guild.name}:`,
                error
            );
        }
    }
);

// ======================================================
// START BOT
// ======================================================

(async () => {

    try {

        await client.login(TOKEN);

        await registerCommands();

    } catch (error) {

        console.error(
            "❌ Failed to start Ticket Bot:",
            error
        );
    }

})();