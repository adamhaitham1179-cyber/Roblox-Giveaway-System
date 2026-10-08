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
const API_PORT = Number(process.env.PORT || process.env.API_PORT || 3001);

// Giveaway Bot API
const GIVEAWAY_API_URL = process.env.GIVEAWAY_API_URL;
const GIVEAWAY_API_SECRET = process.env.GIVEAWAY_API_SECRET;

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

        await rest.put(
            Routes.applicationCommands(config.clientId),
            {
                body: commands
            }
        );

        console.log("✅ Global commands registered.");

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

    if (
        member.permissions &&
        member.permissions.has(
            PermissionsBitField.Flags.ManageGuild
        )
    ) {
        return true;
    }

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

    if (url.length > 500) {
        return null;
    }

    try {
        const parsed = new URL(url);

        if (parsed.protocol !== "https:") {
            return null;
        }

        const hostname = parsed.hostname.toLowerCase();

        if (
            hostname !== "roblox.com" &&
            hostname !== "www.roblox.com"
        ) {
            return null;
        }

        if (
            parsed.username ||
            parsed.password
        ) {
            return null;
        }

        if (parsed.port) {
            return null;
        }

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
    const gamePassId = extractGamePassId(url);

    if (!gamePassId) {
        return null;
    }

    return `https://www.roblox.com/game-pass/${gamePassId}`;
}

// ======================================================
// MARK GIVEAWAY PRIZE AS PAID
// ======================================================

async function markGiveawayPrizeAsPaid(ticket, paidBy) {
    if (!GIVEAWAY_API_URL) {
        throw new Error(
            "GIVEAWAY_API_URL is missing."
        );
    }

    if (!GIVEAWAY_API_SECRET) {
        throw new Error(
            "GIVEAWAY_API_SECRET is missing."
        );
    }

    if (
        !ticket ||
        !ticket.giveawayId ||
        !ticket.discordId
    ) {
        throw new Error(
            "Ticket is missing giveaway or winner information."
        );
    }

    const response = await fetch(
        `${GIVEAWAY_API_URL.replace(/\/+$/, "")}/internal/prize-paid`,
        {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
                "x-api-secret": GIVEAWAY_API_SECRET
            },

            body: JSON.stringify({
                giveawayId: String(ticket.giveawayId),
                discordId: String(ticket.discordId),
                ticketId: String(ticket.id),
                paidBy: String(paidBy)
            })
        }
    );

    const responseText = await response.text();

    let result;

    try {
        result = JSON.parse(responseText);
    } catch {
        result = {
            error: responseText
        };
    }

    if (
        !response.ok ||
        result.success !== true
    ) {
        throw new Error(
            result.error ||
            `Giveaway API returned HTTP ${response.status}`
        );
    }

    return result;
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

    // GET GUILD
    const guild = client.guilds.cache.get(guildId);

    if (!guild) {
        throw new Error("Guild not found.");
    }

    // GET TICKET CONFIG
    const ticketConfig = getTicketConfig(guildId);

    if (!ticketConfig) {
        throw new Error(
            "Ticket system has not been configured in this server."
        );
    }

    // STAFF ROLE MUST EXIST
    if (!ticketConfig.staffRoleId) {
        throw new Error(
            "The ticket Staff Role has not been configured."
        );
    }

    const staffRole = guild.roles.cache.get(
        ticketConfig.staffRoleId
    );

    if (!staffRole) {
        throw new Error(
            "The configured ticket Staff Role no longer exists."
        );
    }

    // CHECK EXISTING TICKET
    const existingTicket = getTicket(
        giveawayId,
        discordId
    );

    if (existingTicket && existingTicket.channelId) {
        const existingChannel = guild.channels.cache.get(
            existingTicket.channelId
        );

        if (existingChannel) {
            return existingChannel;
        }
    }

    // CREATE DATABASE TICKET
    const ticketId = createTicket({
        giveawayId,
        guildId,
        discordId,
        robloxUsername,
        robux
    });

    // FETCH WINNER
    let winnerUser;

    try {
        winnerUser = await client.users.fetch(discordId);
    } catch (error) {
        console.error(
            "❌ Could not fetch winner user:",
            error
        );

        throw new Error(
            "Could not find the giveaway winner on Discord."
        );
    }

    // VALIDATE CATEGORY
    const category = guild.channels.cache.get(
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

    // CHANNEL PERMISSIONS
    const permissionOverwrites = [
        {
            id: guild.id,

            deny: [
                PermissionsBitField.Flags.ViewChannel
            ]
        },

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

        {
            id: staffRole.id,

            allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory
            ]
        },

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

    // SAFE CHANNEL NAME
    const safeUsername = String(robloxUsername)
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "")
        .slice(0, 20) || "winner";

    // CREATE CHANNEL
    let channel;

    try {
        channel = await guild.channels.create({
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

    // SAVE CHANNEL ID
    setChannelId(ticketId, channel.id);

    // TICKET EMBED
    const embed = new EmbedBuilder()
        .setTitle("🎉 Giveaway Winner Ticket")
        .setDescription(
            "Congratulations! You won a giveaway.\n\n" +
            "Please follow the instructions below to receive your Robux."
        )
        .addFields(
            {
                name: "🎮 Roblox Username",
                value: `\`${robloxUsername}\``,
                inline: true
            },
            {
                name: "💰 Prize",
                value: `**${robux} Robux**`,
                inline: true
            },
            {
                name: "🆔 Giveaway ID",
                value: `\`${giveawayId}\``,
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

    // PLAYER BUTTON
    const playerButtons = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`submit_gamepass_${ticketId}`)
                .setLabel("Submit Game Pass")
                .setEmoji("🎮")
                .setStyle(ButtonStyle.Primary)
        );

    // SEND PLAYER TICKET MESSAGE
    try {
        await channel.send({
            content: `<@${winnerUser.id}>`,
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

client.on("interactionCreate", async interaction => {
    // ==================================================
    // SETUP TICKETS
    // ==================================================
    if (
        interaction.isChatInputCommand() &&
        interaction.commandName === "setup-tickets"
    ) {
        try {
            if (
                !interaction.memberPermissions ||
                !interaction.memberPermissions.has(
                    PermissionsBitField.Flags.ManageGuild
                )
            ) {
                return interaction.reply({
                    content:
                        "❌ You need the **Manage Server** permission to use this command.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const category =
                interaction.options.getChannel("category", true);

            const staffRole =
                interaction.options.getRole("staff_role", true);

            if (
                !category ||
                category.type !== ChannelType.GuildCategory
            ) {
                return interaction.reply({
                    content: "❌ Please select a valid server category.",
                    flags: MessageFlags.Ephemeral
                });
            }

            if (!staffRole) {
                return interaction.reply({
                    content: "❌ You must select a Staff Role.",
                    flags: MessageFlags.Ephemeral
                });
            }

            if (staffRole.id === interaction.guild.id) {
                return interaction.reply({
                    content:
                        "❌ You cannot use @everyone as the Staff Role.",
                    flags: MessageFlags.Ephemeral
                });
            }

            if (staffRole.managed) {
                return interaction.reply({
                    content:
                        "❌ Please select a normal server role, not a managed role.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const database = require("./database");

            database.setTicketConfig(
                interaction.guild.id,
                category.id,
                staffRole.id
            );

            return interaction.reply({
                content:
                    "✅ **Ticket system configured successfully.**\n\n" +
                    `📁 Category: <#${category.id}>\n` +
                    `👮 Staff Role: <@&${staffRole.id}>\n\n` +
                    "🎫 Giveaway tickets will only be visible to the giveaway winner and members with the Staff Role.",
                flags: MessageFlags.Ephemeral
            });

        } catch (error) {
            console.error("❌ Setup ticket error:", error);

            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content:
                        "❌ An error occurred while configuring the ticket system.",
                    flags: MessageFlags.Ephemeral
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
            if (!(await isStaff(interaction))) {
                return interaction.reply({
                    content:
                        "❌ Only ticket staff can use this command.",
                    flags: MessageFlags.Ephemeral
                });
            }

            if (!interaction.channel) {
                return interaction.reply({
                    content:
                        "❌ This command must be used inside a ticket.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const ticket = getTicketByChannelId(
                interaction.channel.id
            );

            if (!ticket) {
                return interaction.reply({
                    content:
                        "❌ This channel is not a giveaway ticket.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const ticketId = ticket.id;

            const staffButtons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`verify_gamepass_${ticketId}`)
                        .setLabel("Verify Game Pass")
                        .setEmoji("🔎")
                        .setStyle(ButtonStyle.Success),

                    new ButtonBuilder()
                        .setCustomId(`mark_paid_${ticketId}`)
                        .setLabel("Mark as Paid")
                        .setEmoji("💸")
                        .setStyle(ButtonStyle.Success),

                    new ButtonBuilder()
                        .setCustomId(`close_ticket_${ticketId}`)
                        .setLabel("Close Ticket")
                        .setEmoji("🔒")
                        .setStyle(ButtonStyle.Danger)
                );

            return interaction.reply({
                content:
                    "👮 **Staff Controls**\n\n" +
                    "These controls are only visible to you.",
                components: [staffButtons],
                flags: MessageFlags.Ephemeral
            });

        } catch (error) {
            console.error("❌ Ticket manage error:", error);

            if (
                interaction.isRepliable() &&
                !interaction.replied &&
                !interaction.deferred
            ) {
                await interaction.reply({
                    content:
                        "❌ An error occurred while opening staff controls.",
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        return;
    }
});

// ======================================================
// BUTTONS + MODALS
// ======================================================

client.on("interactionCreate", async interaction => {
    try {
        // ==============================================
        // SUBMIT GAME PASS
        // ==============================================
        if (
            interaction.isButton() &&
            interaction.customId.startsWith("submit_gamepass_")
        ) {
            const ticketId = Number(
                interaction.customId.replace("submit_gamepass_", "")
            );

            const ticket = getTicket(ticketId);

            if (!ticket) {
                return interaction.reply({
                    content: "❌ This ticket could not be found.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const staff = await isStaff(interaction);

            if (
                interaction.user.id !== ticket.discordId &&
                !staff
            ) {
                return interaction.reply({
                    content:
                        "❌ Only the winner or ticket staff can submit a Game Pass.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const modal = new ModalBuilder()
                .setCustomId(`gamepass_modal_${ticketId}`)
                .setTitle("Submit Game Pass");

            const input = new TextInputBuilder()
                .setCustomId("gamepass_url")
                .setLabel("Roblox Game Pass URL")
                .setPlaceholder(
                    "https://www.roblox.com/game-pass/123456789"
                )
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            modal.addComponents(
                new ActionRowBuilder().addComponents(input)
            );

            return interaction.showModal(modal);
        }

        // ==============================================
        // VERIFY GAME PASS — STAFF ONLY
        // ==============================================
        if (
            interaction.isButton() &&
            interaction.customId.startsWith("verify_gamepass_")
        ) {
            if (!(await isStaff(interaction))) {
                return interaction.reply({
                    content:
                        "❌ Only ticket staff can verify Game Passes.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const ticketId = Number(
                interaction.customId.replace("verify_gamepass_", "")
            );

            const ticket = getTicket(ticketId);

            if (!ticket) {
                return interaction.reply({
                    content: "❌ This ticket could not be found.",
                    flags: MessageFlags.Ephemeral
                });
            }

            if (!ticket.gamepassUrl) {
                return interaction.reply({
                    content:
                        "❌ The winner has not submitted a Game Pass link yet.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const gamePassId = extractGamePassId(
                ticket.gamepassUrl
            );

            if (!gamePassId) {
                return interaction.reply({
                    content:
                        "❌ The submitted Game Pass URL is invalid.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const verifiedEmbed = new EmbedBuilder()
                .setTitle("🔎 Game Pass Submitted")
                .setDescription(
                    "The Game Pass link is a valid Roblox Game Pass URL.\n\n" +
                    "⚠️ **Manual verification required:**\n" +
                    "Open the Game Pass below in your browser and check it before paying the winner.\n\n" +
                    "The bot does **not** automatically verify the price, creator, On Sale status, or other Roblox properties."
                )
                .addFields(
                    {
                        name: "🎮 Roblox Username",
                        value: `\`${ticket.robloxUsername}\``,
                        inline: true
                    },
                    {
                        name: "💰 Giveaway Prize",
                        value: `**${ticket.robux} Robux**`,
                        inline: true
                    },
                    {
                        name: "🆔 Giveaway ID",
                        value: `\`${ticket.giveawayId}\``,
                        inline: true
                    },
                    {
                        name: "🆔 Game Pass ID",
                        value: `\`${gamePassId}\``,
                        inline: true
                    },
                    {
                        name: "🔗 Submitted Game Pass",
                        value: ticket.gamepassUrl,
                        inline: false
                    }
                );

            const verificationButtons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel("Open Game Pass")
                        .setEmoji("🌐")
                        .setStyle(ButtonStyle.Link)
                        .setURL(ticket.gamepassUrl),

                    new ButtonBuilder()
                        .setCustomId(`mark_paid_${ticketId}`)
                        .setLabel("Mark as Paid")
                        .setEmoji("💸")
                        .setStyle(ButtonStyle.Success),

                    new ButtonBuilder()
                        .setCustomId(`close_ticket_${ticketId}`)
                        .setLabel("Close Ticket")
                        .setEmoji("🔒")
                        .setStyle(ButtonStyle.Danger)
                );

            return interaction.reply({
                embeds: [verifiedEmbed],
                components: [verificationButtons],
                flags: MessageFlags.Ephemeral
            });
        }

        // الجزء الخاص بزر Mark as Paid وزر Close Ticket
        // ونافذة إرسال رابط الـGame Pass سيأتي في الجزء الثالث.

    } catch (error) {
        console.error("❌ Ticket interaction error:", error);

        if (
            interaction.isRepliable() &&
            !interaction.replied &&
            !interaction.deferred
        ) {
            await interaction.reply({
                content:
                    "❌ An error occurred while processing this interaction.",
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        }
    }
// ======================================================
// BUTTONS + MODALS
// ======================================================

client.on("interactionCreate", async interaction => {
    try {
        // ==================================================
        // SUBMIT GAME PASS
        // ==================================================
        if (
            interaction.isButton() &&
            interaction.customId.startsWith("submit_gamepass_")
        ) {
            const ticketId = Number(
                interaction.customId.replace("submit_gamepass_", "")
            );

            const ticket = getTicket(ticketId);

            if (!ticket) {
                return interaction.reply({
                    content: "❌ This ticket could not be found.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const staff = await isStaff(interaction);

            if (interaction.user.id !== ticket.discordId && !staff) {
                return interaction.reply({
                    content: "❌ Only the winner or ticket staff can submit a Game Pass.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const modal = new ModalBuilder()
                .setCustomId(`gamepass_modal_${ticketId}`)
                .setTitle("Submit Game Pass");

            const input = new TextInputBuilder()
                .setCustomId("gamepass_url")
                .setLabel("Roblox Game Pass URL")
                .setPlaceholder(
                    "https://www.roblox.com/game-pass/123456789"
                )
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            modal.addComponents(
                new ActionRowBuilder().addComponents(input)
            );

            return interaction.showModal(modal);
        }

        // ==================================================
        // VERIFY GAME PASS
        // ==================================================
        if (
            interaction.isButton() &&
            interaction.customId.startsWith("verify_gamepass_")
        ) {
            if (!(await isStaff(interaction))) {
                return interaction.reply({
                    content: "❌ Only ticket staff can verify Game Passes.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const ticketId = Number(
                interaction.customId.replace("verify_gamepass_", "")
            );

            const ticket = getTicket(ticketId);

            if (!ticket) {
                return interaction.reply({
                    content: "❌ This ticket could not be found.",
                    flags: MessageFlags.Ephemeral
                });
            }

            if (!ticket.gamepassUrl) {
                return interaction.reply({
                    content: "❌ The winner has not submitted a Game Pass link yet.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const gamePassId = extractGamePassId(ticket.gamepassUrl);

            if (!gamePassId) {
                return interaction.reply({
                    content: "❌ The submitted Game Pass URL is invalid.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const verifiedEmbed = new EmbedBuilder()
                .setTitle("🔎 Game Pass Submitted")
                .setDescription(
                    "The Game Pass link is a valid Roblox Game Pass URL.\n\n" +
                    "⚠️ **Manual verification required:**\n" +
                    "Open the Game Pass and manually check its price, creator, and On Sale status before paying the winner.\n\n" +
                    "The bot does not automatically verify these Roblox properties."
                )
                .addFields(
                    {
                        name: "🎮 Roblox Username",
                        value: `\`${ticket.robloxUsername}\``,
                        inline: true
                    },
                    {
                        name: "💰 Giveaway Prize",
                        value: `**${ticket.robux} Robux**`,
                        inline: true
                    },
                    {
                        name: "🆔 Game Pass ID",
                        value: `\`${gamePassId}\``,
                        inline: true
                    },
                    {
                        name: "🔗 Submitted Game Pass",
                        value: ticket.gamepassUrl,
                        inline: false
                    }
                );

            const verificationButtons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel("Open Game Pass")
                        .setEmoji("🌐")
                        .setStyle(ButtonStyle.Link)
                        .setURL(ticket.gamepassUrl),

                    new ButtonBuilder()
                        .setCustomId(`mark_paid_${ticketId}`)
                        .setLabel("Mark as Paid")
                        .setEmoji("💸")
                        .setStyle(ButtonStyle.Success),

                    new ButtonBuilder()
                        .setCustomId(`close_ticket_${ticketId}`)
                        .setLabel("Close Ticket")
                        .setEmoji("🔒")
                        .setStyle(ButtonStyle.Danger)
                );

            return interaction.reply({
                embeds: [verifiedEmbed],
                components: [verificationButtons],
                flags: MessageFlags.Ephemeral
            });
        }

        // ==================================================
        // MARK AS PAID
        // ==================================================
        if (
            interaction.isButton() &&
            interaction.customId.startsWith("mark_paid_")
        ) {
            if (!(await isStaff(interaction))) {
                return interaction.reply({
                    content: "❌ Only ticket staff can mark a ticket as paid.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const ticketId = Number(
                interaction.customId.replace("mark_paid_", "")
            );

            const ticket = getTicket(ticketId);

            if (!ticket) {
                return interaction.reply({
                    content: "❌ This ticket could not be found.",
                    flags: MessageFlags.Ephemeral
                });
            }

            await interaction.deferReply({
                flags: MessageFlags.Ephemeral
            });

            // --------------------------------------------------
            // REGISTER PAYMENT IN GIVEAWAY BOT FIRST
            // --------------------------------------------------
            try {
                await markGiveawayPrizeAsPaid(ticket, interaction.user.id);
            } catch (error) {
                console.error("❌ Giveaway payment registration failed:", error);

                return interaction.editReply({
                    content:
                        "❌ **Payment was not recorded.**\n\n" +
                        "The Giveaway Bot did not confirm the payment record, " +
                        "so this ticket has not been marked as paid.\n\n" +
                        "Check the Giveaway Bot URL, API secret, and service logs, then try again."
                });
            }

            // --------------------------------------------------
            // MARK TICKET AS PAID AFTER API SUCCESS
            // --------------------------------------------------
            try {
                closeTicket(ticketId, "paid");
            } catch (error) {
                console.error("❌ Failed to update ticket payment status:", error);

                return interaction.editReply({
                    content:
                        "⚠️ The Giveaway Bot accepted the payment record, " +
                        "but the ticket database update failed. Check the database before retrying."
                });
            }

            await interaction.editReply({
                content:
                    "✅ **Payment recorded successfully.**\n\n" +
                    "The Giveaway Bot has been notified and the ticket is marked as paid.\n" +
                    "The ticket will be deleted in 5 seconds."
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
                console.error("❌ Failed to send payment message:", error);
            }

            // --------------------------------------------------
            // DELETE AFTER 5 SECONDS
            // --------------------------------------------------
            setTimeout(async () => {
                try {
                    if (interaction.channel?.deletable) {
                        await interaction.channel.delete(
                            "Giveaway reward paid"
                        );
                    }
                } catch (error) {
                    console.error("❌ Failed to delete paid ticket:", error);
                }
            }, 5000);

            return;
        }

        // ==================================================
        // CLOSE TICKET
        // ==================================================
        if (
            interaction.isButton() &&
            interaction.customId.startsWith("close_ticket_")
        ) {
            if (!(await isStaff(interaction))) {
                return interaction.reply({
                    content: "❌ Only ticket staff can close giveaway tickets.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const ticketId = Number(
                interaction.customId.replace("close_ticket_", "")
            );

            const ticket = getTicket(ticketId);

            if (!ticket) {
                return interaction.reply({
                    content: "❌ This ticket could not be found.",
                    flags: MessageFlags.Ephemeral
                });
            }

            await interaction.reply({
                content: "🔒 This ticket will be closed in 5 seconds.",
                flags: MessageFlags.Ephemeral
            });

            setTimeout(async () => {
                try {
                    closeTicket(ticketId, "closed");

                    if (interaction.channel?.deletable) {
                        await interaction.channel.delete(
                            "Ticket closed by staff"
                        );
                    }
                } catch (error) {
                    console.error("❌ Failed to close ticket:", error);
                }
            }, 5000);

            return;
        }

        // ==================================================
        // GAME PASS MODAL
        // ==================================================
        if (
            interaction.isModalSubmit() &&
            interaction.customId.startsWith("gamepass_modal_")
        ) {
            const ticketId = Number(
                interaction.customId.replace("gamepass_modal_", "")
            );

            const ticket = getTicket(ticketId);

            if (!ticket) {
                return interaction.reply({
                    content: "❌ This ticket could not be found.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const staff = await isStaff(interaction);

            if (interaction.user.id !== ticket.discordId && !staff) {
                return interaction.reply({
                    content: "❌ Only the winner or ticket staff can submit a Game Pass.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const url = interaction.fields
                .getTextInputValue("gamepass_url")
                .trim();

            const gamePassId = extractGamePassId(url);

            if (!gamePassId) {
                return interaction.reply({
                    content:
                        "❌ Invalid Game Pass URL.\n\n" +
                        "Only a valid HTTPS Roblox Game Pass link is accepted.\n\n" +
                        "Example:\n" +
                        "`https://www.roblox.com/game-pass/123456789`",
                    flags: MessageFlags.Ephemeral
                });
            }

            const cleanUrl = normalizeGamePassUrl(url);

            setGamepassUrl(ticketId, cleanUrl);

            await interaction.reply({
                content:
                    "✅ Game Pass link submitted successfully.\n\n" +
                    "Staff can use `/ticket-manage` and click **Verify Game Pass** to manually verify it.",
                flags: MessageFlags.Ephemeral
            });

            try {
                await interaction.channel.send({
                    content:
                        `🎮 <@${ticket.discordId}> submitted a Game Pass.\n\n` +
                        "Staff can now use `/ticket-manage` to verify it."
                });
            } catch (error) {
                console.error("❌ Failed to send submission message:", error);
            }

            return;
        }
    } catch (error) {
        console.error("❌ Interaction error:", error);

        if (
            interaction.isRepliable() &&
            !interaction.replied &&
            !interaction.deferred
        ) {
            try {
                await interaction.reply({
                    content: "❌ An unexpected error occurred. Please try again.",
                    flags: MessageFlags.Ephemeral
                });
            } catch {}
        } else if (interaction.deferred && !interaction.replied) {
            try {
                await interaction.editReply({
                    content: "❌ An unexpected error occurred. Please check the bot logs."
                });
            } catch {}
        }
    }
});

// ======================================================
// INTERNAL API
// ======================================================

const app = express();

app.use(express.json());

// ======================================================
// HEALTH CHECK
// ======================================================

app.get("/internal/health", (req, res) => {
    res.json({
        success: true,
        service: "ticket-bot"
    });
});

// ======================================================
// GIVEAWAY WINNER -> CREATE TICKET
// ======================================================

app.post("/internal/giveaway-winner", async (req, res) => {
    try {
        const secret = req.headers["x-api-secret"];

        if (!API_SECRET || secret !== API_SECRET) {
            return res.status(401).json({
                success: false,
                error: "Unauthorized"
            });
        }

        const {
            guildId,
            discordId,
            robloxUsername,
            robux,
            giveawayId
        } = req.body;

        if (
            !guildId ||
            !discordId ||
            !robloxUsername ||
            !robux ||
            !giveawayId
        ) {
            return res.status(400).json({
                success: false,
                error: "Missing required winner data."
            });
        }

        const channel = await createWinnerTicket({
            guildId,
            discordId,
            robloxUsername,
            robux: Number(robux),
            giveawayId
        });

        return res.json({
            success: true,
            channelId: channel.id
        });
    } catch (error) {
        console.error("❌ Winner ticket API error:", error);

        return res.status(500).json({
            success: false,
            error: error.message || "Internal server error"
        });
    }
});

// ======================================================
// API SERVER
// ======================================================

app.listen(API_PORT, "0.0.0.0", () => {
    console.log(`🌐 Internal API running on 0.0.0.0:${API_PORT}`);
    console.log("🔗 Health endpoint: /internal/health");
});

// ======================================================
// BOT READY
// ======================================================

client.once("clientReady", () => {
    console.log(`✅ Ticket Bot logged in as ${client.user.tag}`);
    console.log(`🆔 Bot ID: ${client.user.id}`);
    console.log(`🏠 Connected to ${client.guilds.cache.size} server(s)`);
});

// ======================================================
// NEW SERVER
// ======================================================

client.on("guildCreate", async guild => {
    try {
        const rest = new REST({ version: "10" }).setToken(TOKEN);

        await rest.put(
            Routes.applicationGuildCommands(config.clientId, guild.id),
            {
                body: commands
            }
        );

        console.log(`✅ Commands registered in new server: ${guild.name}`);
    } catch (error) {
        console.error(
            `❌ Failed to register commands in new server ${guild.name}:`,
            error
        );
    }
});

// ======================================================
// START BOT
// ======================================================

(async () => {
    try {
        await client.login(TOKEN);
        await registerCommands();
    } catch (error) {
        console.error("❌ Failed to start Ticket Bot:", error);
    }
})();
    return;
}
