require("dotenv").config();

const fs = require("fs");
const path = require("path");
const http = require("http");

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
// ROBLOX VERIFICATION + PROFILE + PAYOUT LEDGER
// =====================================================
const verificationFile = path.join(__dirname, "verification.json");
function loadVerificationData() {
    try {
        if (!fs.existsSync(verificationFile)) return { users: {}, pending: {}, payouts: [] };
        const d = JSON.parse(fs.readFileSync(verificationFile, "utf8"));
        return { users: d.users || {}, pending: d.pending || {}, payouts: d.payouts || [] };
    } catch (e) { console.error("Could not read verification.json:", e); return { users: {}, pending: {}, payouts: [] }; }
}
let verificationData = loadVerificationData();
function saveVerificationData() {
    const temp = verificationFile + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(verificationData, null, 2), "utf8");
    fs.renameSync(temp, verificationFile);
}
function getVerifiedUser(id) { return verificationData.users[id] || null; }
function findVerifiedDiscordByRobloxId(id) { return Object.values(verificationData.users).find(u => String(u.robloxUserId) === String(id)) || null; }
function verificationCode() { return String(Math.floor(100000 + Math.random() * 900000)); }
async function lookupRobloxUser(username) {
    const r = await fetch("https://users.roblox.com/v1/usernames/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }) });
    if (!r.ok) throw new Error(`Roblox lookup HTTP ${r.status}`);
    const d = await r.json(); const found = d.data?.[0]; if (!found) return null;
    const pr = await fetch(`https://users.roblox.com/v1/users/${found.id}`); if (!pr.ok) throw new Error(`Roblox profile HTTP ${pr.status}`);
    const profile = await pr.json(); let avatarUrl = null;
    try { const ar = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${found.id}&size=150x150&format=Png&isCircular=false`); if (ar.ok) avatarUrl = (await ar.json()).data?.[0]?.imageUrl || null; } catch {}
    return { robloxUserId: String(found.id), username: found.name, displayName: found.displayName || profile.displayName || found.name, description: typeof profile.description === "string" ? profile.description : null, avatarUrl };
}
function saveVerifiedUser(discordId, profile) {
    const old = verificationData.users[discordId];
    verificationData.users[discordId] = { discordId, robloxUserId: String(profile.robloxUserId), robloxUsername: profile.username, displayName: profile.displayName, avatarUrl: profile.avatarUrl || null, verifiedAt: old?.verifiedAt || Date.now(), updatedAt: Date.now() };
    saveVerificationData();
}
function getWinnerStatsWithLedger(discordId) {
    let won = 0, total = 0, pending = 0, paid = 0;
    try { const rows = db.getAllWinnerRecords ? db.getAllWinnerRecords(discordId) : []; for (const row of rows) { won++; const n = Number(row.robux || row.prize || 0); total += n; if (String(row.payoutStatus || row.status || "pending").toLowerCase() === "paid") paid += n; else pending += n; } } catch {}
    for (const p of (verificationData.payouts || []).filter(x => x.discordId === discordId)) { const n = Number(p.amount || 0); if (String(p.status).toLowerCase() === "paid") paid += n; else pending += n; total += n; }
    return { won: Math.max(won, (verificationData.payouts || []).filter(x => x.discordId === discordId).length), total, pending, paid };
}
function recordPayoutStatus(discordId, giveawayId, amount, status) {
    const rows = verificationData.payouts || (verificationData.payouts = []);
    const old = rows.find(p => p.discordId === discordId && p.giveawayId === giveawayId);
    if (old) { old.amount = Number(amount || old.amount || 0); old.status = status; old.updatedAt = Date.now(); }
    else rows.push({ discordId, giveawayId, amount: Number(amount || 0), status, createdAt: Date.now(), updatedAt: Date.now() });
    saveVerificationData();
}

// =====================================================
// DURATION
// =====================================================

function parseDuration(input) {

    if (!input) {
        return null;
    }

    const value =
        input
            .trim()
            .toLowerCase();

    const match =
        value.match(
            /^(\d+)\s*(m|h|d|w)$/
        );

    if (!match) {
        return null;
    }

    const number =
        Number(match[1]);

    if (number <= 0) {
        return null;
    }

    let seconds;

    switch (match[2]) {

        case "m":
            seconds =
                number * 60;
            break;

        case "h":
            seconds =
                number * 60 * 60;
            break;

        case "d":
            seconds =
                number * 60 * 60 * 24;
            break;

        case "w":
            seconds =
                number * 60 * 60 * 24 * 7;
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
    new SlashCommandBuilder().setName("verify").setDescription("Verify your Roblox account before joining giveaways.").toJSON(),
    new SlashCommandBuilder().setName("profile").setDescription("View your verified Roblox profile and giveaway stats.").toJSON(),

    new SlashCommandBuilder()

        .setName("setup-giveaway")

        .setDescription(
            "Set the role allowed to create normal giveaways."
        )

        .addRoleOption(option =>
            option
                .setName("staff_role")
                .setDescription(
                    "Role allowed to create normal giveaways."
                )
                .setRequired(true)
        )

        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageGuild
        )

        .toJSON(),

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

    const rest =
        new REST({
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

        if (config.guildId) {

            await rest.put(
                Routes.applicationGuildCommands(
                    config.clientId,
                    config.guildId
                ),
                {
                    body: commands
                }
            );

            console.log(
                `✅ Commands registered in configured server: ${config.guildId}`
            );
        }

        console.log(
            "📋 Available commands:"
        );

        for (const command of commands) {

            console.log(
                `   /${command.name}`
            );
        }

    } catch (error) {

        console.error(
            "❌ Command registration failed:"
        );

        console.error(error);
    }
}

// =====================================================
// NORMAL STAFF
// =====================================================

function isGiveawayStaff(
    interaction
) {

    if (
        !interaction.guild ||
        !interaction.member
    ) {
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
// SPECIAL STAFF
// =====================================================

function isSpecialGiveawayStaff(
    interaction
) {

    if (
        !interaction.guild ||
        !interaction.member
    ) {
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
// EMBED
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

        .setTitle(
            "🎉 ROBUX GIVEAWAY"
        )

        .setDescription(
            description
        )

        .setFooter({
            text:
                "Roblox Giveaway • Good luck! 🍀"
        })

        .setTimestamp();
}

// =====================================================
// MAIN BUTTONS
// =====================================================

function createGiveawayButtons(
    giveawayId
) {

    const showParticipants =
        new ButtonBuilder()

            .setCustomId(
                `participants_${giveawayId}`
            )

            .setLabel(
                "Show Participants"
            )

            .setEmoji(
                "👥"
            )

            .setStyle(
                ButtonStyle.Secondary
            );

    const join =
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

    const cancel =
        new ButtonBuilder()

            .setCustomId(
                `cancel_${giveawayId}`
            )

            .setLabel(
                "Cancel Giveaway"
            )

            .setEmoji(
                "🛑"
            )

            .setStyle(
                ButtonStyle.Danger
            );

    return new ActionRowBuilder()
        .addComponents(
            showParticipants,
            join,
            cancel
        );
}

// =====================================================
// PARTICIPANT LIST
// =====================================================

async function showParticipants(
    interaction,
    giveawayId,
    page = 0
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

    if (
        participants.length === 0
    ) {

        return interaction.reply({

            content:
                "👥 **Participants**\n\n" +
                "No one has joined this giveaway yet.",

            ephemeral: true
        });
    }

    const isHost =
        giveaway.hostId ===
        interaction.user.id;

    const perPage = 4;

    const totalPages =
        Math.ceil(
            participants.length /
            perPage
        );

    const safePage =
        Math.max(
            0,
            Math.min(
                page,
                totalPages - 1
            )
        );

    const start =
        safePage * perPage;

    const current =
        participants.slice(
            start,
            start + perPage
        );

    let description = "";

    current.forEach(
        (participant, index) => {

            const number =
                start + index + 1;

            description +=

                `**${number}.** <@${participant.discordId}>\n` +

                `> Roblox: **${participant.robloxUsername}**\n\n`;
        }
    );

    const embed =
        new EmbedBuilder()

            .setTitle(
                "👥 Giveaway Participants"
            )

            .setDescription(
                description
            )

            .addFields({

                name:
                    "Total Participants",

                value:
                    `**${participants.length}**`,

                inline: true

            }, {

                name:
                    "Page",

                value:
                    `**${safePage + 1} / ${totalPages}**`,

                inline: true
            })

            .setFooter({

                text:
                    isHost
                        ? "You are the giveaway host. You can kick participants."
                        : "Only the giveaway host can kick participants."
            });

    const rows = [];

    // =================================================
    // KICK BUTTONS
    // =================================================

    if (isHost) {

        for (
            const participant of current
        ) {

            const label =
                participant.discordTag
                    ? `Kick ${participant.discordTag}`
                    : `Kick #${start + current.indexOf(participant) + 1}`;

            const kickButton =
                new ButtonBuilder()

                    .setCustomId(
                        `kick_${giveawayId}_${participant.discordId}`
                    )

                    .setLabel(
                        label.substring(0, 80)
                    )

                    .setEmoji(
                        "👢"
                    )

                    .setStyle(
                        ButtonStyle.Danger
                    );

            rows.push(
                new ActionRowBuilder()
                    .addComponents(
                        kickButton
                    )
            );
        }
    }

    // =================================================
    // PAGINATION
    // =================================================

    if (
        totalPages > 1
    ) {

        const navigation = [];

        const previous =
            new ButtonBuilder()

                .setCustomId(
                    `participants_page_${giveawayId}_${safePage - 1}`
                )

                .setLabel(
                    "Previous"
                )

                .setEmoji(
                    "⬅️"
                )

                .setStyle(
                    ButtonStyle.Secondary
                )

                .setDisabled(
                    safePage === 0
                );

        const next =
            new ButtonBuilder()

                .setCustomId(
                    `participants_page_${giveawayId}_${safePage + 1}`
                )

                .setLabel(
                    "Next"
                )

                .setEmoji(
                    "➡️"
                )

                .setStyle(
                    ButtonStyle.Secondary
                )

                .setDisabled(
                    safePage >= totalPages - 1
                );

        navigation.push(
            previous,
            next
        );

        rows.push(
            new ActionRowBuilder()
                .addComponents(
                    navigation
                )
        );
    }

    return interaction.reply({

        embeds: [
            embed
        ],

        components:
            rows,

        ephemeral: true
    });
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

            if (interaction.isModalSubmit() && interaction.customId === "verify_start") {
                const last = verificationData.pending[interaction.user.id]?.createdAt || 0;
                if (Date.now() - last < 60000) return interaction.reply({ content: "⏳ Please wait a minute before trying verification again.", ephemeral: true });
                const username = interaction.fields.getTextInputValue("roblox_username").trim();
                try {
                    const profile = await lookupRobloxUser(username);
                    if (!profile) return interaction.reply({ content: "❌ Roblox username not found.", ephemeral: true });
                    const linked = findVerifiedDiscordByRobloxId(profile.robloxUserId);
                    if (linked && linked.discordId !== interaction.user.id) return interaction.reply({ content: "❌ This Roblox account is already linked to another Discord account.", ephemeral: true });
                    const code = verificationCode();
                    verificationData.pending[interaction.user.id] = { robloxUserId: profile.robloxUserId, robloxUsername: profile.username, displayName: profile.displayName, avatarUrl: profile.avatarUrl, code, createdAt: Date.now(), expiresAt: Date.now() + 600000 };
                    saveVerificationData();
                    const e = new EmbedBuilder().setTitle("🔐 Verify your Roblox account").setDescription(`Roblox account: **${profile.username}**\n\nAdd this temporary code to your Roblox profile About/Bio, then press **Check Again**:\n\n**${code}**\n\nCode expires in 10 minutes.`);
                    if (profile.avatarUrl) e.setThumbnail(profile.avatarUrl);
                    return interaction.reply({ embeds: [e], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("verify_complete").setLabel("Check Again").setStyle(ButtonStyle.Success))], ephemeral: true });
                } catch (err) { console.error("Verification lookup failed:", err); return interaction.reply({ content: "⚠️ Roblox verification is temporarily unavailable. Please try again later.", ephemeral: true }); }
            }
            if (interaction.isButton() && interaction.customId === "verify_complete") {
                const pending = verificationData.pending[interaction.user.id];
                if (!pending) return interaction.reply({ content: "❌ No active verification. Use /verify again.", ephemeral: true });
                if (Date.now() > pending.expiresAt) { delete verificationData.pending[interaction.user.id]; saveVerificationData(); return interaction.update({ content: "⏰ Code expired. Use /verify again.", embeds: [], components: [] }); }
                try {
                    const profile = await lookupRobloxUser(pending.robloxUsername);
                    if (!profile || profile.robloxUserId !== pending.robloxUserId) return interaction.reply({ content: "⚠️ Could not confirm the Roblox profile right now. Try again.", ephemeral: true });
                    if (typeof profile.description !== "string" || !profile.description.includes(pending.code)) return interaction.reply({ content: "❌ Code not found in your public Roblox About/Bio. Add it, then press Check Again.", ephemeral: true });
                    const linked = findVerifiedDiscordByRobloxId(profile.robloxUserId);
                    if (linked && linked.discordId !== interaction.user.id) return interaction.reply({ content: "❌ This Roblox account is already linked to another Discord account.", ephemeral: true });
                    saveVerifiedUser(interaction.user.id, profile); delete verificationData.pending[interaction.user.id]; saveVerificationData();
                    const e = new EmbedBuilder().setTitle("✅ Roblox Account Verified").setDescription(`Username: **${profile.username}**\nDisplay Name: **${profile.displayName}**\nRoblox ID: **${profile.robloxUserId}**`);
                    if (profile.avatarUrl) e.setThumbnail(profile.avatarUrl);
                    return interaction.update({ embeds: [e], components: [] });
                } catch (err) { console.error("Verification check failed:", err); return interaction.reply({ content: "⚠️ Roblox verification is temporarily unavailable. Try again later.", ephemeral: true }); }
            }

            // =================================================
            // COMMANDS
            // =================================================

            if (interaction.isChatInputCommand() && interaction.commandName === "verify") {
                const existing = getVerifiedUser(interaction.user.id);
                if (existing) {
                    const st = getWinnerStatsWithLedger(interaction.user.id);
                    const e = new EmbedBuilder().setTitle("✅ Roblox Account Verified").setDescription(`👤 **Username:** ${existing.robloxUsername}\n✨ **Display Name:** ${existing.displayName}\n🆔 **User ID:** ${existing.robloxUserId}\n\n🏆 **Giveaways Won:** ${st.won}\n💰 **Total Prize:** ${st.total.toLocaleString()} Robux\n⏳ **Pending:** ${st.pending.toLocaleString()} Robux\n✅ **Paid:** ${st.paid.toLocaleString()} Robux`);
                    if (existing.avatarUrl) e.setThumbnail(existing.avatarUrl);
                    return interaction.reply({ embeds: [e], ephemeral: true });
                }
                const m = new ModalBuilder().setCustomId("verify_start").setTitle("🔐 Verify Roblox Account");
                m.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("roblox_username").setLabel("Roblox Username").setPlaceholder("Enter your Roblox username").setStyle(TextInputStyle.Short).setRequired(true).setMinLength(3).setMaxLength(20)));
                return interaction.showModal(m);
            }
            if (interaction.isChatInputCommand() && interaction.commandName === "profile") {
                const v = getVerifiedUser(interaction.user.id);
                if (!v) return interaction.reply({ content: "❌ You are not verified yet. Use **/verify** first.", ephemeral: true });
                const st = getWinnerStatsWithLedger(interaction.user.id);
                const e = new EmbedBuilder().setTitle("👤 Roblox Profile").setDescription(`**${v.robloxUsername}** (${v.displayName})\n\n🆔 **Roblox User ID:** ${v.robloxUserId}\n🏆 **Giveaways Won:** ${st.won}\n💰 **Total Prize:** ${st.total.toLocaleString()} Robux\n⏳ **Pending:** ${st.pending.toLocaleString()} Robux\n✅ **Paid:** ${st.paid.toLocaleString()} Robux`).setFooter({ text: "Roblox Giveaway" });
                if (v.avatarUrl) e.setThumbnail(v.avatarUrl);
                return interaction.reply({ embeds: [e], ephemeral: true });
            }

            if (
                interaction.isChatInputCommand()
            ) {

                // =================================================
                // SETUP GIVEAWAY
                // =================================================

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

                // =================================================
                // SETUP SPECIAL
                // =================================================

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

                // =================================================
                // GIVEAWAY
                // =================================================

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

                    return createGiveawayFromCommand(
                        interaction,
                        false
                    );
                }

                // =================================================
                // SPECIAL GIVEAWAY
                // =================================================

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
                                "❌ You do not have permission to create special giveaways.\n\n" +
                                "Ask a server administrator to configure **/setup-special-giveaway**.",

                            ephemeral: true
                        });
                    }

                    return createGiveawayFromCommand(
                        interaction,
                        true
                    );
                }
            }

            // =================================================
            // BUTTONS
            // =================================================

            if (
                interaction.isButton()
            ) {

                // =================================================
                // PARTICIPANTS PAGE
                // =================================================

                if (
                    interaction.customId.startsWith(
                        "participants_page_"
                    )
                ) {

                    const parts =
                        interaction.customId.split(
                            "_"
                        );

                    const page =
                        Number(
                            parts.pop()
                        );

                    const giveawayId =
                        parts
                            .slice(2)
                            .join("_");

                    const giveaway =
                        db.getGiveaway(
                            giveawayId
                        );

                    if (!giveaway) {

                        return interaction.update({

                            content:
                                "❌ Giveaway not found.",

                            embeds: [],

                            components: []
                        });
                    }

                    const participants =
                        db.getParticipants(
                            giveawayId
                        );

                    const isHost =
                        giveaway.hostId ===
                        interaction.user.id;

                    const perPage = 4;

                    const totalPages =
                        Math.max(
                            1,
                            Math.ceil(
                                participants.length /
                                perPage
                            )
                        );

                    const safePage =
                        Math.max(
                            0,
                            Math.min(
                                page,
                                totalPages - 1
                            )
                        );

                    const start =
                        safePage * perPage;

                    const current =
                        participants.slice(
                            start,
                            start + perPage
                        );

                    let description = "";

                    current.forEach(
                        (participant, index) => {

                            description +=

                                `**${start + index + 1}.** <@${participant.discordId}>\n` +

                                `> Roblox: **${participant.robloxUsername}**\n\n`;
                        }
                    );

                    const embed =
                        new EmbedBuilder()

                            .setTitle(
                                "👥 Giveaway Participants"
                            )

                            .setDescription(
                                description ||
                                "No participants on this page."
                            )

                            .addFields({

                                name:
                                    "Total Participants",

                                value:
                                    `**${participants.length}**`,

                                inline: true

                            }, {

                                name:
                                    "Page",

                                value:
                                    `**${safePage + 1} / ${totalPages}**`,

                                inline: true
                            })

                            .setFooter({

                                text:
                                    isHost
                                        ? "You are the giveaway host. You can kick participants."
                                        : "Only the giveaway host can kick participants."
                            });

                    const rows = [];

                    if (isHost) {

                        for (
                            const participant of current
                        ) {

                            const index =
                                participants.indexOf(
                                    participant
                                );

                            const label =
                                participant.discordTag
                                    ? `Kick ${participant.discordTag}`
                                    : `Kick #${index + 1}`;

                            const kick =
                                new ButtonBuilder()

                                    .setCustomId(
                                        `kick_${giveawayId}_${participant.discordId}`
                                    )

                                    .setLabel(
                                        label.substring(
                                            0,
                                            80
                                        )
                                    )

                                    .setEmoji(
                                        "👢"
                                    )

                                    .setStyle(
                                        ButtonStyle.Danger
                                    );

                            rows.push(
                                new ActionRowBuilder()
                                    .addComponents(
                                        kick
                                    )
                            );
                        }
                    }

                    if (
                        totalPages > 1
                    ) {

                        rows.push(

                            new ActionRowBuilder()
                                .addComponents(

                                    new ButtonBuilder()

                                        .setCustomId(
                                            `participants_page_${giveawayId}_${safePage - 1}`
                                        )

                                        .setLabel(
                                            "Previous"
                                        )

                                        .setEmoji(
                                            "⬅️"
                                        )

                                        .setStyle(
                                            ButtonStyle.Secondary
                                        )

                                        .setDisabled(
                                            safePage === 0
                                        ),

                                    new ButtonBuilder()

                                        .setCustomId(
                                            `participants_page_${giveawayId}_${safePage + 1}`
                                        )

                                        .setLabel(
                                            "Next"
                                        )

                                        .setEmoji(
                                            "➡️"
                                        )

                                        .setStyle(
                                            ButtonStyle.Secondary
                                        )

                                        .setDisabled(
                                            safePage >=
                                            totalPages - 1
                                        )
                                )
                        );
                    }

                    return interaction.update({

                        embeds: [
                            embed
                        ],

                        components:
                            rows
                    });
                }

                // =================================================
                // SHOW PARTICIPANTS
                // =================================================

                if (
                    interaction.customId.startsWith(
                        "participants_"
                    )
                ) {

                    const giveawayId =
                        interaction.customId.replace(
                            "participants_",
                            ""
                        );

                    return showParticipants(
                        interaction,
                        giveawayId,
                        0
                    );
                }

                // =================================================
                // KICK
                // =================================================

                if (
                    interaction.customId.startsWith(
                        "kick_"
                    )
                ) {

                    const parts =
                        interaction.customId.split(
                            "_"
                        );

                    const giveawayId =
                        parts[1];

                    const targetDiscordId =
                        parts[2];

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

                    // =============================================
                    // HOST ONLY
                    // =============================================

                    if (
                        giveaway.hostId !==
                        interaction.user.id
                    ) {

                        return interaction.reply({

                            content:
                                "❌ Only the giveaway host can kick participants.",

                            ephemeral: true
                        });
                    }

                    if (
                        giveaway.ended
                    ) {

                        return interaction.reply({

                            content:
                                "❌ This giveaway has already ended.",

                            ephemeral: true
                        });
                    }

                    const participant =
                        db.getParticipant(
                            giveawayId,
                            targetDiscordId
                        );

                    if (!participant) {

                        return interaction.reply({

                            content:
                                "❌ This player is no longer participating in the giveaway.",

                            ephemeral: true
                        });
                    }

                    const modal =
                        new ModalBuilder()

                            .setCustomId(
                                `kickreason_${giveawayId}_${targetDiscordId}`
                            )

                            .setTitle(
                                "👢 Kick Participant"
                            );

                    const reasonInput =
                        new TextInputBuilder()

                            .setCustomId(
                                "kick_reason"
                            )

                            .setLabel(
                                "Reason"
                            )

                            .setPlaceholder(
                                "Enter the reason for kicking this participant..."
                            )

                            .setStyle(
                                TextInputStyle.Paragraph
                            )

                            .setRequired(
                                true
                            )

                            .setMinLength(
                                1
                            )

                            .setMaxLength(
                                500
                            );

                    modal.addComponents(

                        new ActionRowBuilder()
                            .addComponents(
                                reasonInput
                            )
                    );

                    return interaction.showModal(
                        modal
                    );
                }

                // =================================================
                // JOIN
                // =================================================

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

                    // =============================================
                    // KICK CHECK
                    // =============================================

                    const kicked =
                        db.getKickedParticipant(
                            giveawayId,
                            interaction.user.id
                        );

                    if (kicked) {

                        return interaction.reply({

                            content:
                                `❌ **You have been kicked from this giveaway.**\n\n` +
                                `**Reason:** ${kicked.reason}\n\n` +
                                `You can still join other giveaways.`,

                            ephemeral: true
                        });
                    }

                    // =============================================
                    // HOST CANNOT JOIN
                    // =============================================

                    if (
                        giveaway.hostId ===
                        interaction.user.id
                    ) {

                        return interaction.reply({

                            content:
                                "❌ You cannot join your own giveaway.",

                            ephemeral: true
                        });
                    }

                    // =============================================
                    // SPECIAL ROLE
                    // =============================================

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

                    const alreadyJoined =
                        db.isParticipant(
                            giveawayId,
                            interaction.user.id
                        );

                    if (alreadyJoined) {

                        db.removeParticipant(
                            giveawayId,
                            interaction.user.id
                        );

                        await updateGiveawayMessage(
                            giveawayId
                        );

                        return interaction.reply({

                            content:
                                "✅ You have left the giveaway.",

                            ephemeral: true
                        });
                    }

                    const verified = getVerifiedUser(interaction.user.id);
                    if (!verified) return interaction.reply({ content: "❌ You must verify your Roblox account before joining giveaways. Use **/verify** first.", ephemeral: true });
                    if (db.isParticipant(giveawayId, interaction.user.id)) {
                        db.removeParticipant(giveawayId, interaction.user.id);
                        await updateGiveawayMessage(giveawayId);
                        return interaction.reply({ content: "✅ You have left the giveaway.", ephemeral: true });
                    }
                    db.addParticipant({ giveawayId, discordId: interaction.user.id, discordTag: interaction.user.tag, robloxUsername: verified.robloxUsername });
                    const count = db.getParticipants(giveawayId).length;
                    await interaction.reply({ content: `🎉 **You're in!**\n\n👤 Roblox: **${verified.robloxUsername}**\n💰 Prize: **${giveaway.robux.toLocaleString()} Robux**\n👥 Participants: **${count}**\n\n🍀 Good luck!`, ephemeral: true });
                    await updateGiveawayMessage(giveawayId);
                }

                // =================================================
                // CANCEL
                // =================================================

                if (
                    interaction.customId.startsWith(
                        "cancel_"
                    )
                ) {

                    const giveawayId =
                        interaction.customId.replace(
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

                    if (giveaway.ended) {

                        return interaction.reply({

                            content:
                                "❌ This giveaway has already ended.",

                            ephemeral: true
                        });
                    }

                    const yes =
                        new ButtonBuilder()

                            .setCustomId(
                                `confirmcancel_${giveawayId}`
                            )

                            .setLabel(
                                "Yes"
                            )

                            .setEmoji(
                                "✅"
                            )

                            .setStyle(
                                ButtonStyle.Danger
                            );

                    const no =
                        new ButtonBuilder()

                            .setCustomId(
                                `declinecancel_${giveawayId}`
                            )

                            .setLabel(
                                "No"
                            )

                            .setEmoji(
                                "❌"
                            )

                            .setStyle(
                                ButtonStyle.Secondary
                            );

                    return interaction.reply({

                        content:
                            "⚠️ **Are you sure you want to cancel this giveaway?**",

                        components: [

                            new ActionRowBuilder()
                                .addComponents(
                                    yes,
                                    no
                                )

                        ],

                        ephemeral: true
                    });
                }

                // =================================================
                // CONFIRM CANCEL
                // =================================================

                if (
                    interaction.customId.startsWith(
                        "confirmcancel_"
                    )
                ) {

                    const giveawayId =
                        interaction.customId.replace(
                            "confirmcancel_",
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

                    if (giveaway.ended) {

                        return interaction.update({

                            content:
                                "❌ This giveaway has already ended.",

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

                // =================================================
                // DECLINE CANCEL
                // =================================================

                if (
                    interaction.customId.startsWith(
                        "declinecancel_"
                    )
                ) {

                    return interaction.update({

                        content:
                            "✅ Giveaway cancellation cancelled.",

                        components: []
                    });
                }

                // =================================================
                // END
                // =================================================

                if (
                    interaction.customId.startsWith(
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
                        interaction.customId.replace(
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

                // =================================================
                // REROLL
                // =================================================

                if (
                    interaction.customId.startsWith(
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
                        interaction.customId.replace(
                            "reroll_",
                            ""
                        );

                    return rerollGiveaway(
                        interaction,
                        giveawayId
                    );
                }
            }

            // =================================================
            // MODALS
            // =================================================

            if (
                interaction.isModalSubmit()
            ) {

                // =================================================
                // KICK REASON
                // =================================================

                if (
                    interaction.customId.startsWith(
                        "kickreason_"
                    )
                ) {

                    const parts =
                        interaction.customId.split(
                            "_"
                        );

                    const giveawayId =
                        parts[1];

                    const targetDiscordId =
                        parts[2];

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

                    // =============================================
                    // HOST ONLY
                    // =============================================

                    if (
                        giveaway.hostId !==
                        interaction.user.id
                    ) {

                        return interaction.reply({

                            content:
                                "❌ Only the giveaway host can kick participants.",

                            ephemeral: true
                        });
                    }

                    if (giveaway.ended) {

                        return interaction.reply({

                            content:
                                "❌ This giveaway has already ended.",

                            ephemeral: true
                        });
                    }

                    const participant =
                        db.getParticipant(
                            giveawayId,
                            targetDiscordId
                        );

                    if (!participant) {

                        return interaction.reply({

                            content:
                                "❌ This player is no longer participating in the giveaway.",

                            ephemeral: true
                        });
                    }

                    const reason =
                        interaction.fields
                            .getTextInputValue(
                                "kick_reason"
                            )
                            .trim();

                    if (!reason) {

                        return interaction.reply({

                            content:
                                "❌ You must provide a reason for kicking this participant.",

                            ephemeral: true
                        });
                    }

                    // =============================================
                    // REMOVE FROM PARTICIPANTS
                    // =============================================

                    db.removeParticipant(
                        giveawayId,
                        targetDiscordId
                    );

                    // =============================================
                    // SAVE KICK
                    // =============================================

                    db.removeKickedParticipant(
                        giveawayId,
                        targetDiscordId
                    );

                    db.addKickedParticipant({

                        giveawayId,

                        discordId:
                            participant.discordId,

                        discordTag:
                            participant.discordTag,

                        robloxUsername:
                            participant.robloxUsername,

                        reason,

                        kickedBy:
                            interaction.user.id
                    });

                    // =============================================
                    // UPDATE GIVEAWAY
                    // =============================================

                    await updateGiveawayMessage(
                        giveawayId
                    );

                    // =============================================
                    // TRY DM
                    // =============================================

                    let dmSent = false;

                    try {

                        const user =
                            await client.users.fetch(
                                targetDiscordId
                            );

                        await user.send({

                            embeds: [

                                new EmbedBuilder()

                                    .setTitle(
                                        "👢 You Were Kicked"
                                    )

                                    .setDescription(

                                        `You have been kicked from the giveaway.\n\n` +

                                        `💰 **Prize:** ${giveaway.robux.toLocaleString()} Robux\n\n` +

                                        `👑 **Host:** <@${giveaway.hostId}>\n\n` +

                                        `📝 **Reason:**\n` +
                                        `${reason}\n\n` +

                                        `You can still participate in other giveaways.`

                                    )

                                    .setFooter({

                                        text:
                                            "Roblox Giveaway"
                                    })

                                    .setTimestamp()
                            ]
                        });

                        dmSent = true;

                    } catch {

                        dmSent = false;
                    }

                    return interaction.reply({

                        content:

                            `👢 **Participant kicked successfully.**\n\n` +

                            `👤 Player: <@${targetDiscordId}>\n` +

                            `📝 Reason: **${reason}**\n\n` +

                            (
                                dmSent
                                    ? "📩 The player was notified by DM."
                                    : "⚠️ I could not send the player a DM."
                            ),

                        ephemeral: true
                    });
                }

                // =================================================
                // USERNAME
                // =================================================

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

                    // =============================================
                    // KICK CHECK AGAIN
                    // =============================================

                    const kicked =
                        db.getKickedParticipant(
                            giveawayId,
                            interaction.user.id
                        );

                    if (kicked) {

                        return interaction.reply({

                            content:
                                `❌ **You have been kicked from this giveaway.**\n\n` +
                                `**Reason:** ${kicked.reason}\n\n` +
                                `You can still join other giveaways.`,

                            ephemeral: true
                        });
                    }

                    // =============================================
                    // HOST
                    // =============================================

                    if (
                        giveaway.hostId ===
                        interaction.user.id
                    ) {

                        return interaction.reply({

                            content:
                                "❌ You cannot join your own giveaway.",

                            ephemeral: true
                        });
                    }

                    // =============================================
                    // SPECIAL ROLE
                    // =============================================

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

                    if (
                        db.isParticipant(
                            giveawayId,
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

    let message;

    try {

        message =
            await interaction.channel.send({

                content:
                    ping
                        ? "@everyone"
                        : "",

                embeds: [
                    embed
                ],

                components: [
                    buttons
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

    } catch (error) {

        console.error(
            "❌ Could not send giveaway message:",
            error
        );

        try {

            db.endGiveaway(
                giveawayId
            );

        } catch {}

        return interaction.reply({

            content:
                "❌ I could not create the giveaway message. Please check my permissions in this channel.",

            ephemeral: true
        });
    }

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
// UPDATE GIVEAWAY
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

    if (!giveaway.messageId) {
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

        if (
            error?.code === 10008
        ) {

            console.log(
                `⚠️ Giveaway message ${giveaway.messageId} no longer exists.`
            );

            return;
        }

        console.error(
            "❌ Could not update giveaway:",
            error.message
        );
    }
}

// =====================================================
// CANCEL
// =====================================================

async function cancelGiveaway(
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

    db.endGiveaway(
        giveawayId
    );

    if (!giveaway.messageId) {
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
            new EmbedBuilder()

                .setTitle(
                    "🛑 GIVEAWAY CANCELLED"
                )

                .setDescription(

                    `💰 **Prize:** ${giveaway.robux.toLocaleString()} Robux\n\n` +

                    `👑 **Host:** <@${giveaway.hostId}>\n\n` +

                    `❌ This giveaway was cancelled.\n\n` +

                    `👥 Participants: **${participants.length}**`
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

    } catch (error) {

        if (
            error?.code === 10008
        ) {

            console.log(
                "⚠️ Giveaway message was already deleted."
            );

        } else {

            console.error(
                "❌ Could not cancel giveaway:",
                error.message
            );
        }
    }

    console.log(
        `🛑 Giveaway ${giveawayId} cancelled.`
    );
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

    if (
        !giveaway ||
        giveaway.ended
    ) {
        return;
    }

    const participants =
        db.getParticipants(
            giveawayId
        );

    db.endGiveaway(
        giveawayId
    );

    let message = null;

    try {

        const channel =
            await client.channels.fetch(
                giveaway.channelId
            );

        if (
            channel &&
            channel.isTextBased() &&
            giveaway.messageId
        ) {

            try {

                message =
                    await channel.messages.fetch(
                        giveaway.messageId
                    );

            } catch (error) {

                if (
                    error?.code === 10008
                ) {

                    console.log(
                        `⚠️ Giveaway message ${giveaway.messageId} no longer exists.`
                    );

                } else {

                    console.error(
                        "❌ Could not fetch giveaway message:",
                        error
                    );
                }
            }
        }

    } catch (error) {

        console.error(
            "❌ Could not fetch giveaway channel:",
            error
        );
    }

    // =================================================
    // NO PARTICIPANTS
    // =================================================

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

        if (message) {

            try {

                await message.edit({

                    content: "",

                    embeds: [
                        embed
                    ],

                    components: []
                });

            } catch (error) {

                if (
                    error?.code === 10008
                ) {

                    console.log(
                        "⚠️ Giveaway message was deleted before it could be updated."
                    );

                } else {

                    console.error(
                        "❌ Could not update ended giveaway message:",
                        error
                    );
                }
            }
        }

        return;
    }

    // =================================================
    // PICK WINNERS
    // =================================================

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

    // =================================================
    // TICKETS
    // =================================================

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

    if (message) {

        try {

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
                            rerollButton
                        )

                ]
            });

        } catch (error) {

            if (
                error?.code === 10008
            ) {

                console.log(
                    "⚠️ Giveaway message was deleted. Winners and tickets were still processed."
                );

            } else {

                console.error(
                    "❌ Could not update giveaway message:",
                    error
                );
            }
        }

    } else {

        console.log(
            "⚠️ Giveaway message no longer exists. Winners and tickets were still processed."
        );
    }

    console.log(
        `🏆 Giveaway ${giveawayId} ended.`
    );
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

    try {

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

                .setEmoji(
                    "🔄"
                )

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

    } catch (error) {

        if (
            error?.code === 10008
        ) {

            console.log(
                "⚠️ Giveaway message was deleted. Reroll winner was still processed."
            );

        } else {

            console.error(
                "❌ Could not update rerolled giveaway:",
                error
            );
        }
    }

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
// RESTORE
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

                method:
                    "POST",

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
            JSON.parse(
                text
            );

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

// Internal endpoint called by Ticket Bot when payout status changes.
const payoutServer = http.createServer((req, res) => {
    if (req.method !== "POST" || !["/internal/payout-status", "/internal/prize-paid"].includes(req.url)) { res.writeHead(404); return res.end("Not found"); }
    let body = ""; req.on("data", chunk => { body += chunk; if (body.length > 100000) req.destroy(); });
    req.on("end", () => {
        try {
            if (!process.env.TICKET_API_SECRET || req.headers["x-api-secret"] !== process.env.TICKET_API_SECRET) { res.writeHead(401); return res.end(JSON.stringify({ error: "Unauthorized" })); }
            const d = JSON.parse(body || "{}");
            if (!d.discordId || !d.giveawayId) { res.writeHead(400); return res.end(JSON.stringify({ error: "Missing discordId/giveawayId" })); }
            recordPayoutStatus(d.discordId, d.giveawayId, d.amount || d.robux || 0, String(d.status || "paid").toLowerCase() === "pending" ? "pending" : "paid");
            res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ success: true }));
        } catch { res.writeHead(400); res.end(JSON.stringify({ error: "Invalid request" })); }
    });
});
const payoutPort = Number(process.env.GIVEAWAY_INTERNAL_PORT || process.env.PORT || 3002);
payoutServer.listen(payoutPort, "0.0.0.0", () => console.log(`Payout API listening on ${payoutPort}`));

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
