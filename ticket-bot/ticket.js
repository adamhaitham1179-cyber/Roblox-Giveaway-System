
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

const config = require("./config.json");

// ======================================================
// CONFIG
// ======================================================

const TOKEN = process.env.TOKEN;
const API_SECRET = process.env.API_SECRET;
const API_PORT = Number(process.env.PORT || process.env.API_PORT || 3001);

const GIVEAWAY_API_URL = process.env.GIVEAWAY_API_URL;
const GIVEAWAY_API_SECRET = process.env.GIVEAWAY_API_SECRET;

if (!TOKEN) {
    console.error("❌ Missing TOKEN environment variable.");
    process.exit(1);
}

if (!config.clientId) {
    console.error("❌ Missing clientId in config.json.");
    process.exit(1);
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

// ======================================================
// SLASH COMMANDS
// ======================================================

const commands = [
    {
        name: "setup-tickets",
        description: "Configure giveaway winner tickets.",
        default_member_permissions:
            PermissionsBitField.Flags.ManageGuild.toString(),
        options: [
            {
                name: "category",
                description: "Ticket category.",
                type: 7,
                required: true,
                channel_types: [ChannelType.GuildCategory]
            },
            {
                name: "staff_role",
                description: "Role allowed to manage tickets.",
                type: 8,
                required: true
            }
        ]
    },
    {
        name: "ticket-manage",
        description: "Open staff controls for this giveaway ticket."
    }
];

// ======================================================
// COMMAND REGISTRATION
// ======================================================

async function registerCommands() {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    await rest.put(
        Routes.applicationCommands(config.clientId),
        { body: commands }
    );

    console.log("✅ Global Ticket Bot commands registered.");

    for (const [guildId, guild] of client.guilds.cache) {
        try {
            await rest.put(
                Routes.applicationGuildCommands(config.clientId, guildId),
                { body: commands }
            );

            console.log(`✅ Commands registered in ${guild.name}`);
        } catch (error) {
            console.error(
                `❌ Command registration failed in ${guild.name}:`,
                error.message
            );
        }
    }
}

// ======================================================
// STAFF PERMISSION
// ======================================================

async function isStaff(interaction) {
    if (!interaction.guild || !interaction.member) {
        return false;
    }

    if (
        interaction.memberPermissions?.has(
            PermissionsBitField.Flags.ManageGuild
        )
    ) {
        return true;
    }

    const ticketConfig = getTicketConfig(interaction.guild.id);

    return Boolean(
        ticketConfig?.staffRoleId &&
        interaction.member.roles?.cache?.has(ticketConfig.staffRoleId)
    );
}

// ======================================================
// GAME PASS URL VALIDATION
// ======================================================

function extractGamePassId(url) {
    if (typeof url !== "string" || url.length > 500) {
        return null;
    }

    try {
        const parsed = new URL(url.trim());

        if (
            parsed.protocol !== "https:" ||
            !["roblox.com", "www.roblox.com"].includes(
                parsed.hostname.toLowerCase()
            ) ||
            parsed.username ||
            parsed.password ||
            parsed.port
        ) {
            return null;
        }

        const match = parsed.pathname.match(
            /^\/game-pass\/(\d+)(?:\/.*)?$/i
        );

        return match ? match[1] : null;
    } catch {
        return null;
    }
}

function normalizeGamePassUrl(url) {
    const id = extractGamePassId(url);

    return id
        ? `https://www.roblox.com/game-pass/${id}`
        : null;
}

// ======================================================
// REGISTER PAYMENT IN GIVEAWAY BOT
// ======================================================

async function markGiveawayPrizeAsPaid(ticket, paidBy) {
    if (!GIVEAWAY_API_URL) {
        throw new Error("GIVEAWAY_API_URL is missing.");
    }

    if (!GIVEAWAY_API_SECRET) {
        throw new Error("GIVEAWAY_API_SECRET is missing.");
    }

    if (!ticket?.giveawayId || !ticket?.discordId) {
        throw new Error("Ticket is missing giveaway or winner information.");
    }

    // This path and payload match the Giveaway Bot's
    // /internal/payout-status API.
    const response = await fetch(
        `${GIVEAWAY_API_URL.replace(/\/+$/, "")}/internal/payout-status`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-secret": GIVEAWAY_API_SECRET
            },
            body: JSON.stringify({
                discordId: String(ticket.discordId),
                giveawayId: String(ticket.giveawayId),
                amount: Number(ticket.robux),
                status: "paid"
            })
        }
    );

    const text = await response.text();

    let result;

    try {
        result = JSON.parse(text);
    } catch {
        result = { error: text };
    }

    if (!response.ok || result.success !== true) {
        throw new Error(
            result.error ||
            `Giveaway API returned HTTP ${response.status}`
        );
    }

    console.log(
        `💸 Payment registered: giveaway=${ticket.giveawayId}, ` +
        `winner=${ticket.discordId}, amount=${ticket.robux}, staff=${paidBy}`
    );

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

    if (
        !guildId ||
        !discordId ||
        !robloxUsername ||
        !giveawayId ||
        !Number.isFinite(Number(robux)) ||
        Number(robux) <= 0
    ) {
        throw new Error("Invalid winner ticket data.");
    }

    const guild = client.guilds.cache.get(String(guildId));

    if (!guild) {
        throw new Error("Ticket Bot is not in the specified server.");
    }

    const ticketConfig = getTicketConfig(String(guildId));

    if (!ticketConfig) {
        throw new Error(
            "Ticket system is not configured. Run /setup-tickets first."
        );
    }

    const staffRole = guild.roles.cache.get(ticketConfig.staffRoleId);

    if (!staffRole) {
        throw new Error("The configured Staff Role no longer exists.");
    }

    const category = guild.channels.cache.get(ticketConfig.categoryId);

    if (
        !category ||
        category.type !== ChannelType.GuildCategory
    ) {
        throw new Error("The configured ticket category no longer exists.");
    }

    // Reuse an existing ticket if its channel still exists.
    const existingTicket = getTicket(
        String(giveawayId),
        String(discordId)
    );

    if (existingTicket?.channelId) {
        const existingChannel = guild.channels.cache.get(
            existingTicket.channelId
        );

        if (existingChannel) {
            return existingChannel;
        }
    }

    const ticketId = createTicket({
        giveawayId: String(giveawayId),
        guildId: String(guildId),
        discordId: String(discordId),
        robloxUsername: String(robloxUsername),
        robux: Number(robux)
    });

    const winnerUser = await client.users.fetch(String(discordId));

    const permissionOverwrites = [
        {
            id: guild.id,
            deny: [PermissionsBitField.Flags.ViewChannel]
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

    const safeUsername =
        String(robloxUsername)
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, "")
            .slice(0, 20) || "winner";

    const channel = await guild.channels.create({
        name: `ticket-${safeUsername}`,
        type: ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites
    });

    setChannelId(ticketId, channel.id);

    const embed = new EmbedBuilder()
        .setTitle("🎉 Giveaway Winner Ticket")
        .setDescription(
            "Congratulations! You won a giveaway.\n\n" +
            "Follow the instructions below to receive your Robux."
        )
        .addFields(
            {
                name: "🎮 Roblox Username",
                value: `\`${String(robloxUsername).slice(0, 100)}\``,
                inline: true
            },
            {
                name: "💰 Prize",
                value: `**${Number(robux)} Robux**`,
                inline: true
            },
            {
                name: "🆔 Giveaway ID",
                value: `\`${String(giveawayId).slice(0, 100)}\``,
                inline: true
            },
            {
                name: "📋 What to do",
                value:
                    "1. Create a Game Pass on your Roblox account.\n" +
                    `2. Set its price to exactly **${Number(robux)} Robux**.\n` +
                    "3. Make sure the Game Pass is On Sale.\n" +
                    "4. Make sure you are its creator.\n" +
                    "5. Click **Submit Game Pass** and send the link.\n\n" +
                    "Staff must manually verify the Game Pass before paying."
            }
        )
        .setFooter({
            text: "Do not change the Game Pass until staff finishes verification."
        });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`submit_gamepass_${ticketId}`)
            .setLabel("Submit Game Pass")
            .setEmoji("🎮")
            .setStyle(ButtonStyle.Primary)
    );

    try {
        await channel.send({
            content: `<@${winnerUser.id}>`,
            embeds: [embed],
            components: [row]
        });
    } catch (error) {
        try {
            await channel.delete("Failed to send ticket message");
        } catch {}

        throw error;
    }

    console.log(
        `🎫 Ticket created: ${channel.name} | giveaway=${giveawayId}`
    );

    return channel;
}

// ======================================================
// INTERACTION HANDLER
// ======================================================

client.on("interactionCreate", async interaction => {
    try {
        // --------------------------------------------------
        // SETUP TICKETS
        // --------------------------------------------------
        if (
            interaction.isChatInputCommand() &&
            interaction.commandName === "setup-tickets"
        ) {
            if (
                !interaction.memberPermissions?.has(
                    PermissionsBitField.Flags.ManageGuild
                )
            ) {
                return interaction.reply({
                    content: "❌ You need Manage Server permission.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const category = interaction.options.getChannel("category", true);
            const staffRole = interaction.options.getRole("staff_role", true);

            if (
                category.type !== ChannelType.GuildCategory ||
                staffRole.id === interaction.guild.id ||
                staffRole.managed
            ) {
                return interaction.reply({
                    content: "❌ Select a valid category and a normal staff role.",
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
                    "✅ **Ticket system configured.**\n\n" +
                    `📁 Category: <#${category.id}>\n` +
                    `👮 Staff Role: <@&${staffRole.id}>`,
                flags: MessageFlags.Ephemeral
            });
        }

        // --------------------------------------------------
        // TICKET MANAGE
        // --------------------------------------------------
        if (
            interaction.isChatInputCommand() &&
            interaction.commandName === "ticket-manage"
        ) {
            if (!(await isStaff(interaction))) {
                return interaction.reply({
                    content: "❌ Only ticket staff can use this command.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const ticket = getTicketByChannelId(interaction.channelId);

            if (!ticket) {
                return interaction.reply({
                    content: "❌ Use this command inside a giveaway ticket.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`verify_gamepass_${ticket.id}`)
                    .setLabel("Verify Game Pass")
                    .setEmoji("🔎")
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`mark_paid_${ticket.id}`)
                    .setLabel("Mark as Paid")
                    .setEmoji("💸")
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`close_ticket_${ticket.id}`)
                    .setLabel("Close Ticket")
                    .setEmoji("🔒")
                    .setStyle(ButtonStyle.Danger)
            );

            return interaction.reply({
                content: "👮 **Staff Controls**",
                components: [row],
                flags: MessageFlags.Ephemeral
            });
        }

        // --------------------------------------------------
        // SUBMIT GAME PASS BUTTON
        // --------------------------------------------------
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
                    content: "❌ Ticket not found.",
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

            if (ticket.status === "paid" || ticket.status === "closed") {
                return interaction.reply({
                    content: "❌ This ticket is already closed.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const modal = new ModalBuilder()
                .setCustomId(`gamepass_modal_${ticketId}`)
                .setTitle("Submit Game Pass");

            const input = new TextInputBuilder()
                .setCustomId("gamepass_url")
                .setLabel("Roblox Game Pass URL")
                .setPlaceholder("https://www.roblox.com/game-pass/123456789")
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            modal.addComponents(
                new ActionRowBuilder().addComponents(input)
            );

            return interaction.showModal(modal);
        }

        // --------------------------------------------------
        // VERIFY GAME PASS BUTTON
        // --------------------------------------------------
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
                    content: "❌ Ticket not found.",
                    flags: MessageFlags.Ephemeral
                });
            }

            if (!ticket.gamepassUrl) {
                return interaction.reply({
                    content: "❌ The winner has not submitted a Game Pass link.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const gamePassId = extractGamePassId(ticket.gamepassUrl);

            if (!gamePassId) {
                return interaction.reply({
                    content: "❌ Invalid Game Pass URL.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const embed = new EmbedBuilder()
                .setTitle("🔎 Game Pass Submitted")
                .setDescription(
                    "Review this Game Pass manually before sending Robux.\n\n" +
                    "⚠️ This bot validates the URL format only. It does not automatically " +
                    "verify the price, creator, or On Sale status."
                )
                .addFields(
                    {
                        name: "🎮 Roblox Username",
                        value: `\`${String(ticket.robloxUsername).slice(0, 100)}\``,
                        inline: true
                    },
                    {
                        name: "💰 Giveaway Prize",
                        value: `**${ticket.robux} Robux**`,
                        inline: true
                    },
                    {
                        name: "🆔 Giveaway ID",
                        value: `\`${String(ticket.giveawayId).slice(0, 100)}\``,
                        inline: true
                    },
                    {
                        name: "🔗 Game Pass",
                        value: ticket.gamepassUrl,
                        inline: false
                    }
                );

            const row = new ActionRowBuilder().addComponents(
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
                embeds: [embed],
                components: [row],
                flags: MessageFlags.Ephemeral
            });
        }

        // --------------------------------------------------
        // MARK AS PAID
        // --------------------------------------------------
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
                    content: "❌ Ticket not found.",
                    flags: MessageFlags.Ephemeral
                });
            }

            if (ticket.status === "paid") {
                return interaction.reply({
                    content: "ℹ️ This ticket is already marked as paid.",
                    flags: MessageFlags.Ephemeral
                });
            }

            await interaction.deferReply({
                flags: MessageFlags.Ephemeral
            });

            // Update Giveaway Bot first. If this fails, do not mark this
            // ticket paid and do not delete it.
            try {
                await markGiveawayPrizeAsPaid(ticket, interaction.user.id);
            } catch (error) {
                console.error("❌ Payment registration failed:", error);

                return interaction.editReply({
                    content:
                        "❌ **Payment record failed.** The Giveaway Bot did not confirm the update, " +
                        "so this ticket has not been marked as paid.\n\n" +
                        "Check GIVEAWAY_API_URL, GIVEAWAY_API_SECRET, and the Giveaway Bot logs."
                });
            }

            try {
                closeTicket(ticketId, "paid");
            } catch (error) {
                console.error("❌ Ticket database update failed:", error);

                return interaction.editReply({
                    content:
                        "⚠️ The Giveaway Bot accepted the payment update, but the ticket database " +
                        "could not be updated. Check both services before retrying."
                });
            }

            await interaction.editReply({
                content:
                    "✅ **Payment record updated successfully.**\n" +
                    "The Giveaway Bot confirmed the payment, and this ticket is marked as paid.\n" +
                    "The ticket will be deleted in 5 seconds."
            });

            try {
                await interaction.channel.send({
                    content:
                        `💸 <@${ticket.discordId}>\n\n` +
                        `Your **${ticket.robux} Robux** giveaway reward has been marked as paid by staff.`
                });
            } catch (error) {
                console.error("❌ Could not notify winner:", error.message);
            }

            setTimeout(async () => {
                try {
                    if (interaction.channel?.deletable) {
                        await interaction.channel.delete("Giveaway reward paid");
                    }
                } catch (error) {
                    console.error("❌ Could not delete paid ticket:", error.message);
                }
            }, 5000);

            return;
        }

        // --------------------------------------------------
        // CLOSE TICKET
        // --------------------------------------------------
        if (
            interaction.isButton() &&
            interaction.customId.startsWith("close_ticket_")
        ) {
            if (!(await isStaff(interaction))) {
                return interaction.reply({
                    content: "❌ Only ticket staff can close tickets.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const ticketId = Number(
                interaction.customId.replace("close_ticket_", "")
            );

            const ticket = getTicket(ticketId);

            if (!ticket) {
                return interaction.reply({
                    content: "❌ Ticket not found.",
                    flags: MessageFlags.Ephemeral
                });
            }

            if (ticket.status === "paid") {
                return interaction.reply({
                    content: "ℹ️ This ticket is already marked as paid.",
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
                        await interaction.channel.delete("Ticket closed by staff");
                    }
                } catch (error) {
                    console.error("❌ Could not close ticket:", error.message);
                }
            }, 5000);

            return;
        }

        // --------------------------------------------------
        // GAME PASS MODAL SUBMISSION
        // --------------------------------------------------
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
                    content: "❌ Ticket not found.",
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

            if (ticket.status === "paid" || ticket.status === "closed") {
                return interaction.reply({
                    content: "❌ This ticket is already closed.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const url = interaction.fields
                .getTextInputValue("gamepass_url")
                .trim();

            const cleanUrl = normalizeGamePassUrl(url);

            if (!cleanUrl) {
                return interaction.reply({
                    content:
                        "❌ Invalid Game Pass URL.\n\n" +
                        "Use a link like:\n" +
                        "`https://www.roblox.com/game-pass/123456789`",
                    flags: MessageFlags.Ephemeral
                });
            }

            setGamepassUrl(ticketId, cleanUrl);

            await interaction.reply({
                content:
                    "✅ Game Pass link submitted successfully.\n" +
                    "Staff can use `/ticket-manage` and click **Verify Game Pass**.",
                flags: MessageFlags.Ephemeral
            });

            try {
                await interaction.channel.send({
                    content:
                        `🎮 <@${ticket.discordId}> submitted a Game Pass.\n` +
                        "Staff can now review the link."
                });
            } catch (error) {
                console.error("❌ Could not notify ticket channel:", error.message);
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
            await interaction.reply({
                content: "❌ An unexpected error occurred. Check the bot logs.",
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        } else if (interaction.deferred && !interaction.replied) {
            await interaction.editReply({
                content: "❌ An unexpected error occurred. Check the bot logs."
            }).catch(() => {});
        }
    }
});

// ======================================================
// INTERNAL API
// ======================================================

const app = express();

app.use(express.json({ limit: "100kb" }));

app.get("/internal/health", (req, res) => {
    res.json({
        success: true,
        service: "ticket-bot"
    });
});

// Giveaway Bot -> Ticket Bot: create winner ticket
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
        } = req.body || {};

        if (
            !guildId ||
            !discordId ||
            !robloxUsername ||
            !giveawayId ||
            !Number.isFinite(Number(robux)) ||
            Number(robux) <= 0
        ) {
            return res.status(400).json({
                success: false,
                error: "Missing or invalid winner data."
            });
        }

        const channel = await createWinnerTicket({
            guildId: String(guildId),
            discordId: String(discordId),
            robloxUsername: String(robloxUsername),
            robux: Number(robux),
            giveawayId: String(giveawayId)
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

app.listen(API_PORT, "0.0.0.0", () => {
    console.log(`🌐 Ticket Bot API listening on port ${API_PORT}`);
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
            { body: commands }
        );

        console.log(`✅ Commands registered in new server: ${guild.name}`);
    } catch (error) {
        console.error(
            `❌ Could not register commands in ${guild.name}:`,
            error.message
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
