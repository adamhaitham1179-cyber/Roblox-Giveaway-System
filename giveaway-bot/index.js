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
// ROBLOX VERIFICATION / PROFILE STORAGE
// =====================================================

const verificationFile = path.join(__dirname, "verification.json");

function loadVerificationData() {
    try {
        if (!fs.existsSync(verificationFile)) {
            return {
                users: {},
                pending: {},
                payouts: []
            };
        }

        const data = JSON.parse(
            fs.readFileSync(
                verificationFile,
                "utf8"
            )
        );

        return {
            users:
                data && data.users
                    ? data.users
                    : {},

            pending:
                data && data.pending
                    ? data.pending
                    : {},

            payouts:
                data && data.payouts
                    ? data.payouts
                    : []
        };

    } catch (error) {

        console.error(
            "❌ Could not read verification.json:",
            error
        );

        return {
            users: {},
            pending: {},
            payouts: []
        };
    }
}

let verificationData =
    loadVerificationData();


function saveVerificationData() {

    const temp =
        `${verificationFile}.tmp`;

    fs.writeFileSync(
        temp,
        JSON.stringify(
            verificationData,
            null,
            2
        ),
        "utf8"
    );

    fs.renameSync(
        temp,
        verificationFile
    );
}


function getVerifiedUser(
    discordId
) {

    return (
        verificationData.users[
            discordId
        ] || null
    );
}


function findVerifiedDiscordByRobloxId(
    robloxUserId
) {

    return Object.values(
        verificationData.users
    ).find(
        user =>
            String(
                user.robloxUserId
            ) ===
            String(
                robloxUserId
            )
    ) || null;
}


function verificationCode() {

    return String(
        Math.floor(
            100000 +
            Math.random() *
            900000
        )
    );
}


function escapeProfileText(
    value
) {

    return String(
        value || ""
    ).replace(
        /[\\`*_{}\[\]()<>#+\-.!|~]/g,
        "\\$&"
    );
}


// =====================================================
// ROBLOX API
// =====================================================

async function lookupRobloxUser(
    username
) {

    const response =
        await fetch(
            "https://users.roblox.com/v1/usernames/users",
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({
                    usernames: [
                        username
                    ],

                    excludeBannedUsers:
                        false
                })
            }
        );


    if (!response.ok) {

        throw new Error(
            `Roblox username lookup returned HTTP ${response.status}`
        );
    }


    const result =
        await response.json();


    const found =
        Array.isArray(
            result.data
        )
            ? result.data[0]
            : null;


    if (!found) {
        return null;
    }


    const userResponse =
        await fetch(
            `https://users.roblox.com/v1/users/${found.id}`
        );


    if (!userResponse.ok) {

        throw new Error(
            `Roblox profile returned HTTP ${userResponse.status}`
        );
    }


    const user =
        await userResponse.json();


    let avatarUrl =
        null;


    try {

        const avatarResponse =
            await fetch(
                `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${found.id}&size=150x150&format=Png&isCircular=false`
            );


        if (avatarResponse.ok) {

            const avatar =
                await avatarResponse.json();


            avatarUrl =
                avatar.data?.[0]?.imageUrl ||
                null;
        }

    } catch {}


    return {

        robloxUserId:
            String(found.id),

        username:
            found.name,

        displayName:
            found.displayName ||
            user.displayName ||
            found.name,

        description:
            typeof user.description ===
            "string"
                ? user.description
                : null,

        avatarUrl
    };
}


function verificationCodeIsInBio(
    profile,
    code
) {

    return (
        typeof profile.description ===
        "string" &&
        profile.description.includes(
            code
        )
    );
}


// =====================================================
// WINNER / PAYOUT STATS
// =====================================================

function getWinnerStats(
    discordId
) {

    let won = 0;
    let total = 0;
    let pending = 0;
    let paid = 0;


    try {

        const rows =
            db.getAllWinnerRecords
                ? db.getAllWinnerRecords(
                    discordId
                )
                : [];


        for (
            const row of rows
        ) {

            won++;


            const amount =
                Number(
                    row.robux ||
                    row.prize ||
                    0
                );


            total += amount;


            const status =
                String(
                    row.payoutStatus ||
                    row.status ||
                    "pending"
                ).toLowerCase();


            if (
                status === "paid"
            ) {

                paid += amount;

            } else {

                pending += amount;
            }
        }

    } catch {}


    return {
        won,
        total,
        pending,
        paid
    };
}


// =====================================================
// VERIFICATION STORAGE
// =====================================================

function upsertVerification(
    discordId,
    profile
) {

    const existing =
        verificationData.users[
            discordId
        ];


    verificationData.users[
        discordId
    ] = {

        discordId,

        robloxUserId:
            String(
                profile.robloxUserId
            ),

        robloxUsername:
            profile.username,

        displayName:
            profile.displayName,

        avatarUrl:
            profile.avatarUrl ||
            null,

        verifiedAt:
            existing?.verifiedAt ||
            Date.now(),

        updatedAt:
            Date.now()
    };


    saveVerificationData();
}


// =====================================================
// PAYOUT LEDGER
// =====================================================

function recordPayoutStatus(
    discordId,
    giveawayId,
    amount,
    status
) {

    if (
        !discordId ||
        !giveawayId
    ) {
        return;
    }


    const normalizedStatus =
        String(
            status || "pending"
        ).toLowerCase();


    if (
        ![
            "pending",
            "paid"
        ].includes(
            normalizedStatus
        )
    ) {
        return;
    }


    const numericAmount =
        Number(amount || 0);


    const existing =
        verificationData.payouts.find(
            item =>
                String(
                    item.discordId
                ) ===
                String(
                    discordId
                ) &&
                String(
                    item.giveawayId
                ) ===
                String(
                    giveawayId
                )
        );


    if (existing) {

        existing.amount =
            numericAmount;

        existing.status =
            normalizedStatus;

        existing.updatedAt =
            Date.now();

    } else {

        verificationData.payouts.push({

            discordId:
                String(discordId),

            giveawayId:
                String(giveawayId),

            amount:
                numericAmount,

            status:
                normalizedStatus,

            createdAt:
                Date.now(),

            updatedAt:
                Date.now()
        });
    }


    saveVerificationData();
}


function getLedgerStats(
    discordId
) {

    let total = 0;
    let pending = 0;
    let paid = 0;
    let won = 0;


    for (
        const item of
        verificationData.payouts
    ) {

        if (
            String(
                item.discordId
            ) !==
            String(
                discordId
            )
        ) {
            continue;
        }


        won++;


        const amount =
            Number(
                item.amount || 0
            );


        total += amount;


        if (
            String(
                item.status
            ).toLowerCase() ===
            "paid"
        ) {

            paid += amount;

        } else {

            pending += amount;
        }
    }


    return {
        won,
        total,
        pending,
        paid
    };
}


// =====================================================
// DURATION
// =====================================================

function parseDuration(
    input
) {

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
        Number(
            match[1]
        );


    if (
        number <= 0
    ) {
        return null;
    }


    const unit =
        match[2];


    let seconds;


    switch (unit) {

        case "m":

            seconds =
                number *
                60;

            break;


        case "h":

            seconds =
                number *
                60 *
                60;

            break;


        case "d":

            seconds =
                number *
                60 *
                60 *
                24;

            break;


        case "w":

            seconds =
                number *
                60 *
                60 *
                24 *
                7;

            break;


        default:

            return null;
    }


    if (
        seconds < 60
    ) {
        return null;
    }


    if (
        seconds > 604800
    ) {
        return null;
    }


    return seconds;
}


// =====================================================
// SLASH COMMANDS
// =====================================================

const commands = [

    // =================================================
    // VERIFY
    // =================================================

    new SlashCommandBuilder()

        .setName(
            "verify"
        )

        .setDescription(
            "Verify your Roblox account before joining giveaways."
        )

        .toJSON(),


    // =================================================
    // PROFILE
    // =================================================

    new SlashCommandBuilder()

        .setName(
            "profile"
        )

        .setDescription(
            "View your verified Roblox profile and giveaway stats."
        )

        .toJSON(),


    // =================================================
    // SETUP GIVEAWAY
    // =================================================

    new SlashCommandBuilder()

        .setName(
            "setup-giveaway"
        )

        .setDescription(
            "Set the role allowed to create and manage giveaways."
        )

        .addRoleOption(
            option =>
                option

                    .setName(
                        "staff_role"
                    )

                    .setDescription(
                        "The role allowed to create and manage giveaways."
                    )

                    .setRequired(
                        true
                    )
        )

        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageGuild
        )

        .toJSON(),


    // =================================================
    // GIVEAWAY
    // =================================================

    new SlashCommandBuilder()

        .setName(
            "giveaway"
        )

        .setDescription(
            "Create a Robux giveaway"
        )

        .addIntegerOption(
            option =>
                option

                    .setName(
                        "robux"
                    )

                    .setDescription(
                        "Amount of Robux"
                    )

                    .setRequired(
                        true
                    )

                    .setMinValue(
                        1
                    )
        )

        .addStringOption(
            option =>
                option

                    .setName(
                        "duration"
                    )

                    .setDescription(
                        "Example: 1m, 2h, 1d, 1w"
                    )

                    .setRequired(
                        true
                    )
        )

        .addIntegerOption(
            option =>
                option

                    .setName(
                        "winners"
                    )

                    .setDescription(
                        "Number of winners"
                    )

                    .setRequired(
                        true
                    )

                    .setMinValue(
                        1
                    )

                    .setMaxValue(
                        20
                    )
        )

        .addBooleanOption(
            option =>
                option

                    .setName(
                        "ping"
                    )

                    .setDescription(
                        "Ping @everyone?"
                    )

                    .setRequired(
                        true
                    )
        )

        .toJSON(),


    // =================================================
    // SPECIAL GIVEAWAY
    // =================================================

    new SlashCommandBuilder()

        .setName(
            "specialgiveaway"
        )

        .setDescription(
            "Create a Robux giveaway for a specific role."
        )

        .addIntegerOption(
            option =>
                option

                    .setName(
                        "robux"
                    )

                    .setDescription(
                        "Amount of Robux"
                    )

                    .setRequired(
                        true
                    )

                    .setMinValue(
                        1
                    )
        )

        .addStringOption(
            option =>
                option

                    .setName(
                        "duration"
                    )

                    .setDescription(
                        "Example: 1m, 2h, 1d, 1w"
                    )

                    .setRequired(
                        true
                    )
        )

        .addIntegerOption(
            option =>
                option

                    .setName(
                        "winners"
                    )

                    .setDescription(
                        "Number of winners"
                    )

                    .setRequired(
                        true
                    )

                    .setMinValue(
                        1
                    )

                    .setMaxValue(
                        20
                    )
        )

        .addBooleanOption(
            option =>
                option

                    .setName(
                        "ping"
                    )

                    .setDescription(
                        "Ping @everyone?"
                    )

                    .setRequired(
                        true
                    )
        )

        .addRoleOption(
            option =>
                option

                    .setName(
                        "special_role"
                    )

                    .setDescription(
                        "The role allowed to join this giveaway."
                    )

                    .setRequired(
                        true
                    )
        )

        .toJSON()
];


// =====================================================
// REGISTER COMMANDS
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
            "🔄 Registering slash commands..."
        );


        await rest.put(
            Routes.applicationCommands(
                config.clientId
            ),
            {
                body:
                    commands
            }
        );


        console.log(
            "✅ Slash commands registered."
        );

    } catch (error) {

        console.error(
            "❌ Command registration failed:",
            error
        );
    }
}


// =====================================================
// STAFF CONFIG
// =====================================================

function getStaffRoleId(
    guildId
) {

    try {

        if (
            typeof db.getGuildConfig ===
            "function"
        ) {

            const configData =
                db.getGuildConfig(
                    guildId
                );


            if (
                configData
            ) {

                return (
                    configData.staffRoleId ||
                    configData.staff_role ||
                    null
                );
            }
        }

    } catch (error) {

        console.error(
            "❌ Failed to get guild config:",
            error
        );
    }


    return null;
}


function isGiveawayStaff(
    interaction
) {

    if (
        interaction.memberPermissions &&
        interaction.memberPermissions.has(
            PermissionFlagsBits.ManageGuild
        )
    ) {

        return true;
    }


    const roleId =
        getStaffRoleId(
            interaction.guildId
        );


    if (!roleId) {
        return false;
    }


    return Boolean(
        interaction.member &&
        interaction.member.roles &&
        interaction.member.roles.cache &&
        interaction.member.roles.cache.has(
            roleId
        )
    );
}


// =====================================================
// GIVEAWAY MESSAGE EMBED
// =====================================================

function createGiveawayEmbed(
    giveaway
) {

    const endTimestamp =
        Math.floor(
            Number(
                giveaway.endTime
            ) / 1000
        );


    const participants =
        Number(
            giveaway.participantCount ||
            0
        );


    const embed =
        new EmbedBuilder()

            .setTitle(
                "🎉 ROBUX GIVEAWAY"
            )

            .setDescription(

                `💰 **Prize:** ${Number(
                    giveaway.robux
                ).toLocaleString()} Robux\n\n` +

                `🏆 **Winners:** ${Number(
                    giveaway.winners
                )}\n\n` +

                `👥 **Participants:** ${participants}\n\n` +

                `⏰ **Ends:** <t:${endTimestamp}:R>\n\n` +

                `🔐 **You must verify your Roblox account before joining.**\n\n` +

                `Click **Join Giveaway** below to participate.`

            )

            .setTimestamp(
                Number(
                    giveaway.createdAt ||
                    Date.now()
                )
            );


    if (
        giveaway.hostTag
    ) {

        embed.addFields({
            name:
                "👑 Hosted By",

            value:
                giveaway.hostTag
        });
    }


    if (
        giveaway.specialRoleId
    ) {

        embed.addFields({
            name:
                "🎟️ Required Role",

            value:
                `<@&${giveaway.specialRoleId}>`
        });
    }


    return embed;
}


// =====================================================
// GIVEAWAY BUTTONS
// =====================================================

function createGiveawayButtons(
    giveawayId
) {

    return [

        new ActionRowBuilder()

            .addComponents(

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
                    ),


                new ButtonBuilder()

                    .setCustomId(
                        `participants_${giveawayId}`
                    )

                    .setLabel(
                        "Participants"
                    )

                    .setEmoji(
                        "👥"
                    )

                    .setStyle(
                        ButtonStyle.Secondary
                    )

            )

    ];
}


// =====================================================
// PARTICIPANT LIST
// =====================================================

function participantDisplayName(
    participant
) {

    if (
        participant.robloxUsername
    ) {

        return participant.robloxUsername;
    }


    if (
        participant.discordTag
    ) {

        return participant.discordTag;
    }


    return participant.discordId;
}


function createParticipantPages(
    participants,
    pageSize = 10
) {

    const pages = [];


    for (
        let i = 0;
        i < participants.length;
        i += pageSize
    ) {

        pages.push(
            participants.slice(
                i,
                i + pageSize
            )
        );
    }


    if (
        pages.length === 0
    ) {

        pages.push([]);
    }


    return pages;
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


    if (!giveaway) {
        return;
    }


    try {

        const guild =
            await client.guilds.fetch(
                giveaway.guildId
            );


        const channel =
            await guild.channels.fetch(
                giveaway.channelId
            );


        if (!channel) {
            return;
        }


        const message =
            await channel.messages.fetch(
                giveaway.messageId
            );


        const participants =
            db.getParticipants(
                giveawayId
            );


        giveaway.participantCount =
            participants.length;


        await message.edit({

            embeds: [
                createGiveawayEmbed(
                    giveaway
                )
            ],

            components:
                createGiveawayButtons(
                    giveawayId
                )
        });

    } catch (error) {

        console.error(
            `❌ Failed to update giveaway ${giveawayId}:`,
            error
        );
    }
}


// =====================================================
// PARTICIPANT PAGINATION BUTTONS
// =====================================================

function participantNavigationRow(
    giveawayId,
    page,
    totalPages
) {

    const row =
        new ActionRowBuilder();


    row.addComponents(

        new ButtonBuilder()

            .setCustomId(
                `participants_prev_${giveawayId}_${page}`
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
                page <= 0
            ),


        new ButtonBuilder()

            .setCustomId(
                `participants_next_${giveawayId}_${page}`
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
                page >=
                totalPages - 1
            )

    );


    return row;
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


    db.endGiveaway(
        giveawayId
    );


    let participants = [];


    try {

        participants =
            db.getParticipants(
                giveawayId
            );

    } catch {}


    const shuffled =
        [...participants];


    for (
        let i =
            shuffled.length - 1;
        i > 0;
        i--
    ) {

        const j =
            Math.floor(
                Math.random() *
                (i + 1)
            );


        [
            shuffled[i],
            shuffled[j]
        ] = [
            shuffled[j],
            shuffled[i]
        ];
    }


    const winnerCount =
        Math.min(
            Number(
                giveaway.winners
            ),
            shuffled.length
        );


    const winners =
        shuffled.slice(
            0,
            winnerCount
        );


    const guild =
        client.guilds.cache.get(
            giveaway.guildId
        );


    let winnerText =
        "";


    if (
        winners.length === 0
    ) {

        winnerText =
            "No eligible participants.";

    } else {

        winnerText =
            winners
                .map(
                    winner =>
                        `🏆 <@${winner.discordId}> — **${winner.robloxUsername || "Unknown"}**`
                )
                .join("\n");
    }


    const resultEmbed =
        new EmbedBuilder()

            .setTitle(
                "🎉 GIVEAWAY ENDED"
            )

            .setDescription(
                `💰 **Prize:** ${Number(
                    giveaway.robux
                ).toLocaleString()} Robux\n\n` +

                `🏆 **Winners:**\n${winnerText}`
            )

            .setTimestamp();


    try {

        const channel =
            await guild?.channels.fetch(
                giveaway.channelId
            );


        const message =
            await channel?.messages.fetch(
                giveaway.messageId
            );


        if (message) {

            await message.edit({

                embeds: [
                    resultEmbed
                ],

                components: []
            });
        }

    } catch (error) {

        console.error(
            "❌ Failed to edit ended giveaway:",
            error
        );
    }


    for (
        const winner of winners
    ) {

        recordPayoutStatus(
            winner.discordId,
            giveawayId,
            giveaway.robux,
            "pending"
        );


        await sendWinnerToTicketBot({

            giveawayId,

            guildId:
                giveaway.guildId,

            discordId:
                winner.discordId,

            discordTag:
                winner.discordTag,

            robloxUsername:
                winner.robloxUsername,

            robloxUserId:
                winner.robloxUserId,

            robloxDisplayName:
                winner.robloxDisplayName,

            robux:
                giveaway.robux,

            hostId:
                giveaway.hostId,

            hostTag:
                giveaway.hostTag
        });
    }


    console.log(
        `🏁 Giveaway ${giveawayId} ended. Winners: ${winners.length}`
    );
}


// =====================================================
// SCHEDULE GIVEAWAY
// =====================================================

const giveawayTimers =
    new Map();


function scheduleGiveaway(
    giveawayId,
    endTime
) {

    if (
        giveawayTimers.has(
            giveawayId
        )
    ) {

        clearTimeout(
            giveawayTimers.get(
                giveawayId
            )
        );
    }


    const delay =
        Math.max(
            1000,
            Number(
                endTime
            ) - Date.now()
        );


    const timer =
        setTimeout(
            async () => {

                giveawayTimers.delete(
                    giveawayId
                );


                try {

                    await endGiveaway(
                        giveawayId
                    );

                } catch (error) {

                    console.error(
                        `❌ Failed to end giveaway ${giveawayId}:`,
                        error
                    );
                }

            },
            delay
        );


    giveawayTimers.set(
        giveawayId,
        timer
    );
}


// =====================================================
// SEND WINNER TO TICKET BOT
// =====================================================

async function sendWinnerToTicketBot(
    winnerData
) {

    const apiUrl =
        process.env.TICKET_API_URL;


    const apiSecret =
        process.env.TICKET_API_SECRET;


    if (
        !apiUrl ||
        !apiSecret
    ) {

        console.error(
            "❌ TICKET_API_URL or TICKET_API_SECRET is missing."
        );

        return false;
    }


    try {

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
                        JSON.stringify(
                            winnerData
                        )
                }
            );


        const text =
            await response.text();


        if (
            !response.ok
        ) {

            console.error(
                "❌ Ticket Bot rejected winner:",
                response.status,
                text
            );

            return false;
        }


        console.log(
            "✅ Winner sent to Ticket Bot:",
            winnerData.discordId
        );


        return true;

    } catch (error) {

        console.error(
            "❌ Failed to send winner to Ticket Bot:",
            error
        );

        return false;
    }
}


// =====================================================
// RESTORE ACTIVE GIVEAWAYS
// =====================================================

async function restoreGiveaways() {

    let activeGiveaways = [];


    try {

        activeGiveaways =
            db.getActiveGiveaways
                ? db.getActiveGiveaways()
                : [];

    } catch (error) {

        console.error(
            "❌ Failed to load active giveaways:",
            error
        );

        return;
    }


    console.log(
        `🔄 Found ${activeGiveaways.length} active giveaway(s)`
    );


    for (
        const giveaway of activeGiveaways
    ) {

        if (
            Date.now() >=
            Number(
                giveaway.endTime
            )
        ) {

            try {

                await endGiveaway(
                    giveaway.id
                );

            } catch (error) {

                console.error(
                    `❌ Failed restoring ended giveaway ${giveaway.id}:`,
                    error
                );
            }


            continue;
        }


        scheduleGiveaway(
            giveaway.id,
            giveaway.endTime
        );


        try {

            await updateGiveawayMessage(
                giveaway.id
            );

        } catch (error) {

            console.error(
                `❌ Failed restoring giveaway message ${giveaway.id}:`,
                error
            );
        }
    }
}


// =====================================================
// INTERNAL PAYOUT API
// =====================================================

function startInternalServer() {

    const port =
        Number(
            process.env.PORT ||
            process.env.GIVEAWAY_INTERNAL_PORT ||
            3002
        );


    const server =
        http.createServer(
            async (
                req,
                res
            ) => {

                if (
                    req.method !==
                    "POST"
                ) {

                    res.writeHead(
                        405,
                        {
                            "Content-Type":
                                "application/json"
                        }
                    );


                    return res.end(
                        JSON.stringify({
                            error:
                                "Method Not Allowed"
                        })
                    );
                }


                if (
                    req.url !==
                    "/internal/payout-status"
                ) {

                    res.writeHead(
                        404,
                        {
                            "Content-Type":
                                "application/json"
                        }
                    );


                    return res.end(
                        JSON.stringify({
                            error:
                                "Not Found"
                        })
                    );
                }


                const secret =
                    req.headers[
                        "x-api-secret"
                    ];


                if (
                    !secret ||
                    secret !==
                    process.env.TICKET_API_SECRET
                ) {

                    res.writeHead(
                        401,
                        {
                            "Content-Type":
                                "application/json"
                        }
                    );


                    return res.end(
                        JSON.stringify({
                            error:
                                "Unauthorized"
                        })
                    );
                }


                let body = "";


                req.on(
                    "data",
                    chunk => {
                        body += chunk.toString();
                    }
                );


                req.on(
                    "end",
                    () => {

                        try {

                            const data =
                                JSON.parse(
                                    body ||
                                    "{}"
                                );


                            const {
                                discordId,
                                giveawayId,
                                amount,
                                status
                            } = data;


                            if (
                                !discordId ||
                                !giveawayId
                            ) {

                                res.writeHead(
                                    400,
                                    {
                                        "Content-Type":
                                            "application/json"
                                    }
                                );


                                return res.end(
                                    JSON.stringify({
                                        error:
                                            "discordId and giveawayId are required"
                                    })
                                );
                            }


                            if (
                                ![
                                    "pending",
                                    "paid"
                                ].includes(
                                    String(
                                        status
                                    ).toLowerCase()
                                )
                            ) {

                                res.writeHead(
                                    400,
                                    {
                                        "Content-Type":
                                            "application/json"
                                    }
                                );


                                return res.end(
                                    JSON.stringify({
                                        error:
                                            "status must be pending or paid"
                                    })
                                );
                            }


                            recordPayoutStatus(
                                discordId,
                                giveawayId,
                                amount,
                                status
                            );


                            res.writeHead(
                                200,
                                {
                                    "Content-Type":
                                        "application/json"
                                }
                            );


                            return res.end(
                                JSON.stringify({
                                    success:
                                        true
                                })
                            );

                        } catch (error) {

                            console.error(
                                "❌ Payout API error:",
                                error
                            );


                            res.writeHead(
                                400,
                                {
                                    "Content-Type":
                                        "application/json"
                                }
                            );


                            return res.end(
                                JSON.stringify({
                                    error:
                                        "Invalid JSON"
                                })
                            );
                        }
                    }
                );
            }
        );


    server.listen(
        port,
        "0.0.0.0",
        () => {

            console.log(
                `🌐 Internal payout API listening on port ${port}`
            );
        }
    );
}


// =====================================================
// INTERACTION HANDLER
// =====================================================

client.on(
    "interactionCreate",
    async interaction => {

        try {

            // =================================================
            // VERIFY COMMAND
            // =================================================

            if (
                interaction.isChatInputCommand() &&
                interaction.commandName ===
                    "verify"
            ) {

                const existing =
                    getVerifiedUser(
                        interaction.user.id
                    );


                if (existing) {

                    const stats =
                        getLedgerStats(
                            interaction.user.id
                        );


                    const embed =
                        new EmbedBuilder()

                            .setTitle(
                                "✅ Roblox Verification"
                            )

                            .setDescription(
                                "Your Discord account is already linked to a Roblox account."
                            )

                            .addFields(

                                {
                                    name:
                                        "👤 Username",

                                    value:
                                        existing.robloxUsername ||
                                        "Unknown",

                                    inline:
                                        true
                                },

                                {
                                    name:
                                        "✨ Display Name",

                                    value:
                                        existing.displayName ||
                                        "Unknown",

                                    inline:
                                        true
                                },

                                {
                                    name:
                                        "🆔 User ID",

                                    value:
                                        String(
                                            existing.robloxUserId
                                        ),

                                    inline:
                                        false
                                }
                            )

                            .setTimestamp();


                    if (
                        existing.avatarUrl
                    ) {

                        embed.setThumbnail(
                            existing.avatarUrl
                        );
                    }


                    return interaction.reply({
                        embeds: [
                            embed
                        ],
                        ephemeral:
                            true
                    });
                }


                const now =
                    Date.now();


                const currentPending =
                    verificationData.pending[
                        interaction.user.id
                    ];


                if (
                    currentPending &&
                    currentPending.createdAt &&
                    now -
                        currentPending.createdAt <
                        60 * 1000
                ) {

                    return interaction.reply({

                        content:
                            "⏳ Please wait at least 1 minute before starting another verification attempt.",

                        ephemeral:
                            true
                    });
                }


                const modal =
                    new ModalBuilder()

                        .setCustomId(
                            "verify_modal"
                        )

                        .setTitle(
                            "Verify Roblox Account"
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


                modal.addComponents(

                    new ActionRowBuilder()
                        .addComponents(
                            usernameInput
                        )

                );


                return interaction.showModal(
                    modal
                );
            }


            // =================================================
            // PROFILE COMMAND
            // =================================================

            if (
                interaction.isChatInputCommand() &&
                interaction.commandName ===
                    "profile"
            ) {

                const verified =
                    getVerifiedUser(
                        interaction.user.id
                    );


                if (!verified) {

                    return interaction.reply({

                        content:
                            "❌ You are not verified yet.\n\nUse **/verify** first.",

                        ephemeral:
                            true
                    });
                }


                const ledgerStats =
                    getLedgerStats(
                        interaction.user.id
                    );


                const oldStats =
                    getWinnerStats(
                        interaction.user.id
                    );


                const stats = {

                    won:
                        Math.max(
                            ledgerStats.won,
                            oldStats.won
                        ),

                    total:
                        Math.max(
                            ledgerStats.total,
                            oldStats.total
                        ),

                    pending:
                        ledgerStats.pending,

                    paid:
                        ledgerStats.paid
                };


                const embed =
                    new EmbedBuilder()

                        .setTitle(
                            `👤 ${verified.robloxUsername}`
                        )

                        .setDescription(
                            `**Roblox Profile**\n\n` +
                            `✨ **Display Name:** ${verified.displayName || "Unknown"}\n` +
                            `🆔 **User ID:** ${verified.robloxUserId}\n\n` +
                            `🎉 **Giveaways Won:** ${stats.won}\n` +
                            `💰 **Total Prize:** ${stats.total.toLocaleString()} Robux\n` +
                            `⏳ **Pending:** ${stats.pending.toLocaleString()} Robux\n` +
                            `✅ **Paid:** ${stats.paid.toLocaleString()} Robux`
                        )

                        .setTimestamp();


                if (
                    verified.avatarUrl
                ) {

                    embed.setThumbnail(
                        verified.avatarUrl
                    );
                }


                return interaction.reply({

                    embeds: [
                        embed
                    ],

                    ephemeral:
                        true
                });
            }


            // =================================================
            // VERIFY MODAL
            // =================================================

            if (
                interaction.isModalSubmit() &&
                interaction.customId ===
                    "verify_modal"
            ) {

                const username =
                    interaction.fields
                        .getTextInputValue(
                            "roblox_username"
                        )
                        .trim();


                const existing =
                    getVerifiedUser(
                        interaction.user.id
                    );


                if (existing) {

                    return interaction.reply({

                        content:
                            "❌ Your Discord account is already verified. You cannot change the linked Roblox account using /verify.",

                        ephemeral:
                            true
                    });
                }


                const recent =
                    verificationData.pending[
                        interaction.user.id
                    ];


                if (
                    recent &&
                    Date.now() -
                        Number(
                            recent.createdAt
                        ) <
                        60 * 1000
                ) {

                    return interaction.reply({

                        content:
                            "⏳ Please wait before starting another verification attempt.",

                        ephemeral:
                            true
                    });
                }


                await interaction.deferReply({
                    ephemeral:
                        true
                });


                try {

                    const profile =
                        await lookupRobloxUser(
                            username
                        );


                    if (!profile) {

                        return interaction.editReply({

                            content:
                                "❌ Roblox username not found. Please check the username and try again."
                        });
                    }


                    const linked =
                        findVerifiedDiscordByRobloxId(
                            profile.robloxUserId
                        );


                    if (
                        linked &&
                        linked.discordId !==
                            interaction.user.id
                    ) {

                        return interaction.editReply({

                            content:
                                "❌ This Roblox account is already linked to another Discord account."
                        });
                    }


                    const code =
                        verificationCode();


                    const expiresAt =
                        Date.now() +
                        10 * 60 * 1000;


                    verificationData.pending[
                        interaction.user.id
                    ] = {

                        discordId:
                            interaction.user.id,

                        robloxUserId:
                            profile.robloxUserId,

                        robloxUsername:
                            profile.username,

                        code,

                        createdAt:
                            Date.now(),

                        expiresAt
                    };


                    saveVerificationData();


                    const embed =
                        new EmbedBuilder()

                            .setTitle(
                                "🔐 Roblox Verification"
                            )

                            .setDescription(

                                `To verify **${profile.username}**, put the following code in your Roblox profile **About/Bio**:\n\n` +

                                `# \`${code}\`\n\n` +

                                `⏰ This code expires in **10 minutes**.\n\n` +

                                `After adding it to your Roblox profile, click **Complete Verification** below.`

                            )

                            .addFields(

                                {
                                    name:
                                        "👤 Username",

                                    value:
                                        profile.username,

                                    inline:
                                        true
                                },

                                {
                                    name:
                                        "✨ Display Name",

                                    value:
                                        profile.displayName,

                                    inline:
                                        true
                                },

                                {
                                    name:
                                        "🆔 User ID",

                                    value:
                                        profile.robloxUserId,

                                    inline:
                                        false
                                }
                            )

                            .setTimestamp();


                    if (
                        profile.avatarUrl
                    ) {

                        embed.setThumbnail(
                            profile.avatarUrl
                        );
                    }


                    const row =
                        new ActionRowBuilder()
                            .addComponents(

                                new ButtonBuilder()

                                    .setCustomId(
                                        "verify_complete"
                                    )

                                    .setLabel(
                                        "Complete Verification"
                                    )

                                    .setEmoji(
                                        "✅"
                                    )

                                    .setStyle(
                                        ButtonStyle.Success
                                    )

                            );


                    return interaction.editReply({

                        embeds: [
                            embed
                        ],

                        components: [
                            row
                        ]
                    });

                } catch (error) {

                    console.error(
                        "❌ Roblox verification lookup failed:",
                        error
                    );


                    return interaction.editReply({

                        content:
                            "⚠️ Roblox is temporarily unavailable. Please try again later."
                    });
                }
            }


            // =================================================
            // GIVEAWAY COMMAND
            // =================================================

            if (
                interaction.isChatInputCommand() &&
                (
                    interaction.commandName ===
                        "giveaway" ||
                    interaction.commandName ===
                        "specialgiveaway"
                )
            ) {

                if (
                    !isGiveawayStaff(
                        interaction
                    )
                ) {

                    return interaction.reply({

                        content:
                            "❌ You do not have permission to create or manage giveaways.",

                        ephemeral:
                            true
                    });
                }


                const isSpecial =
                    interaction.commandName ===
                    "specialgiveaway";


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
                            "❌ Invalid duration.\n\nUse a duration between **1 minute and 1 week**.\nExamples: `1m`, `2h`, `1d`, `1w`.",

                        ephemeral:
                            true
                    });
                }


                let specialRoleId =
                    null;


                if (
                    isSpecial
                ) {

                    const specialRole =
                        interaction.options.getRole(
                            "special_role"
                        );


                    if (
                        !specialRole
                    ) {

                        return interaction.reply({

                            content:
                                "❌ Please select a valid special role.",

                            ephemeral:
                                true
                        });
                    }


                    if (
                        specialRole.id ===
                        interaction.guild.roles.everyone.id
                    ) {

                        return interaction.reply({

                            content:
                                "❌ @everyone cannot be used as a special giveaway role.",

                            ephemeral:
                                true
                        });
                    }


                    specialRoleId =
                        specialRole.id;
                }


                const giveawayId =
                    `${Date.now()}-${Math.random()
                        .toString(36)
                        .slice(2, 8)}`;


                const endTime =
                    Date.now() +
                    duration *
                    1000;


                const giveaway = {

                    id:
                        giveawayId,

                    guildId:
                        interaction.guildId,

                    channelId:
                        interaction.channelId,

                    messageId:
                        null,

                    robux,

                    duration,

                    winners,

                    ping,

                    specialRoleId,

                    hostId:
                        interaction.user.id,

                    hostTag:
                        interaction.user.tag,

                    createdAt:
                        Date.now(),

                    endTime,

                    ended:
                        false,

                    participantCount:
                        0
                };


                try {

                    db.createGiveaway(
                        giveaway
                    );

                } catch (error) {

                    console.error(
                        "❌ Failed to save giveaway:",
                        error
                    );


                    return interaction.reply({

                        content:
                            "❌ Failed to create giveaway in the database.",

                        ephemeral:
                            true
                    });
                }


                const embed =
                    createGiveawayEmbed(
                        giveaway
                    );


                const components =
                    createGiveawayButtons(
                        giveawayId
                    );


                const content =
                    ping
                        ? "@everyone"
                        : undefined;


                await interaction.reply({

                    content,

                    embeds: [
                        embed
                    ],

                    components
                });


                const message =
                    await interaction.fetchReply();


                try {

                    db.setGiveawayMessageId(
                        giveawayId,
                        message.id
                    );

                } catch (error) {

                    console.error(
                        "❌ Failed to save giveaway message ID:",
                        error
                    );
                }


                scheduleGiveaway(
                    giveawayId,
                    endTime
                );


                return;
            }


        // =====================================================
// BUTTON HANDLER
// =====================================================

if (
    interaction.isButton()
) {

    // =================================================
    // COMPLETE VERIFICATION
    // =================================================

    if (
        interaction.customId ===
        "verify_complete"
    ) {

        const pending =
            verificationData.pending[
                interaction.user.id
            ];


        if (!pending) {

            return interaction.reply({

                content:
                    "❌ You do not have an active verification attempt. Please use **/verify** again.",

                ephemeral:
                    true
            });
        }


        if (
            Date.now() >
            Number(
                pending.expiresAt
            )
        ) {

            delete verificationData.pending[
                interaction.user.id
            ];

            saveVerificationData();


            return interaction.reply({

                content:
                    "⏰ Your verification code has expired. Please use **/verify** to get a new code.",

                ephemeral:
                    true
            });
        }


        await interaction.deferReply({
            ephemeral:
                true
        });


        try {

            const profile =
                await lookupRobloxUser(
                    pending.robloxUsername
                );


            if (!profile) {

                return interaction.editReply({

                    content:
                        "⚠️ Roblox is temporarily unavailable or the account could not be found. Verification was not completed."
                });
            }


            /*
             * IMPORTANT:
             *
             * We NEVER automatically verify the account
             * if Roblox does not return the public profile
             * description.
             */

            if (
                typeof profile.description !==
                    "string"
            ) {

                return interaction.editReply({

                    content:
                        "⚠️ I could not read the public Roblox profile bio right now. Verification was NOT completed. Please try again later."
                });
            }


            if (
                !verificationCodeIsInBio(
                    profile,
                    pending.code
                )
            ) {

                return interaction.editReply({

                    content:
                        "❌ Verification code not found in your Roblox profile About/Bio.\n\n" +
                        "Make sure you added the exact code to your public Roblox profile, then press **Complete Verification** again."
                });
            }


            const alreadyLinked =
                findVerifiedDiscordByRobloxId(
                    profile.robloxUserId
                );


            if (
                alreadyLinked &&
                alreadyLinked.discordId !==
                    interaction.user.id
            ) {

                delete verificationData.pending[
                    interaction.user.id
                ];

                saveVerificationData();


                return interaction.editReply({

                    content:
                        "❌ This Roblox account is already linked to another Discord account."
                });
            }


            /*
             * The account is now verified.
             */

            upsertVerification(
                interaction.user.id,
                profile
            );


            delete verificationData.pending[
                interaction.user.id
            ];

            saveVerificationData();


            const successEmbed =
                new EmbedBuilder()

                    .setTitle(
                        "✅ Verification Complete"
                    )

                    .setDescription(
                        "Your Roblox account has been successfully verified and linked to your Discord account."
                    )

                    .addFields(

                        {
                            name:
                                "👤 Username",

                            value:
                                profile.username,

                            inline:
                                true
                        },

                        {
                            name:
                                "✨ Display Name",

                            value:
                                profile.displayName,

                            inline:
                                true
                        },

                        {
                            name:
                                "🆔 Roblox User ID",

                            value:
                                String(
                                    profile.robloxUserId
                                ),

                            inline:
                                false
                        }
                    )

                    .setTimestamp();


            if (
                profile.avatarUrl
            ) {

                successEmbed.setThumbnail(
                    profile.avatarUrl
                );
            }


            return interaction.editReply({

                embeds: [
                    successEmbed
                ]
            });

        } catch (error) {

            console.error(
                "❌ Verification completion error:",
                error
            );


            return interaction.editReply({

                content:
                    "⚠️ Roblox is temporarily unavailable. Verification was NOT completed. Please try again later."
            });
        }
    }


    // =================================================
    // JOIN GIVEAWAY
    // =================================================

    if (
        interaction.customId.startsWith(
            "join_"
        )
    ) {

        const giveawayId =
            interaction.customId.substring(
                "join_".length
            );


        const giveaway =
            db.getGiveaway(
                giveawayId
            );


        if (!giveaway) {

            return interaction.reply({

                content:
                    "❌ This giveaway no longer exists.",

                ephemeral:
                    true
            });
        }


        if (
            giveaway.ended
        ) {

            return interaction.reply({

                content:
                    "❌ This giveaway has already ended.",

                ephemeral:
                    true
            });
        }


        if (
            Date.now() >=
            Number(
                giveaway.endTime
            )
        ) {

            await endGiveaway(
                giveawayId
            );


            return interaction.reply({

                content:
                    "❌ This giveaway has already ended.",

                ephemeral:
                    true
            });
        }


        // =================================================
        // REQUIRED ROBLOX VERIFICATION
        // =================================================

        const verified =
            getVerifiedUser(
                interaction.user.id
            );


        if (!verified) {

            return interaction.reply({

                content:
                    "🔐 You must verify your Roblox account before joining this giveaway.\n\nUse **/verify** first.",

                ephemeral:
                    true
            });
        }


        // =================================================
        // SPECIAL GIVEAWAY ROLE CHECK
        // =================================================

        if (
            giveaway.specialRoleId
        ) {

            const member =
                interaction.member;


            if (
                !member ||
                !member.roles ||
                !member.roles.cache ||
                !member.roles.cache.has(
                    giveaway.specialRoleId
                )
            ) {

                return interaction.reply({

                    content:
                        "❌ You do not have the required role to join this special giveaway.",

                    ephemeral:
                        true
                });
            }
        }


        // =================================================
        // CHECK EXISTING PARTICIPANT
        // =================================================

        let alreadyJoined =
            false;


        try {

            if (
                typeof db.hasParticipant ===
                "function"
            ) {

                alreadyJoined =
                    Boolean(
                        db.hasParticipant(
                            giveawayId,
                            interaction.user.id
                        )
                    );

            } else {

                const participants =
                    db.getParticipants(
                        giveawayId
                    );


                alreadyJoined =
                    participants.some(
                        participant =>
                            String(
                                participant.discordId
                            ) ===
                            String(
                                interaction.user.id
                            )
                    );
            }

        } catch (error) {

            console.error(
                "❌ Failed to check participant:",
                error
            );
        }


        if (
            alreadyJoined
        ) {

            return interaction.reply({

                content:
                    "⚠️ You have already joined this giveaway.",

                ephemeral:
                    true
            });
        }


        // =================================================
        // ADD VERIFIED USER
        // =================================================

        const participant = {

            discordId:
                interaction.user.id,

            discordTag:
                interaction.user.tag,

            robloxUsername:
                verified.robloxUsername,

            robloxUserId:
                verified.robloxUserId,

            robloxDisplayName:
                verified.displayName,

            joinedAt:
                Date.now()
        };


        try {

            /*
             * The database function accepts the participant
             * object. Older database implementations may only
             * store the fields they know, while newer versions
             * can store the complete Roblox verification data.
             */

            db.addParticipant(
                giveawayId,
                participant
            );

        } catch (error) {

            console.error(
                "❌ Failed to add giveaway participant:",
                error
            );


            return interaction.reply({

                content:
                    "❌ I could not add you to the giveaway. Please try again.",

                ephemeral:
                    true
            });
        }


        try {

            await updateGiveawayMessage(
                giveawayId
            );

        } catch (error) {

            console.error(
                "❌ Failed to update giveaway after join:",
                error
            );
        }


        return interaction.reply({

            content:
                `✅ You joined the giveaway!\n\n` +
                `🎮 Roblox: **${verified.robloxUsername}**\n` +
                `💰 Prize: **${Number(
                    giveaway.robux
                ).toLocaleString()} Robux**`,

            ephemeral:
                true
        });
    }


    // =================================================
    // PARTICIPANTS
    // =================================================

    if (
        interaction.customId.startsWith(
            "participants_"
        )
    ) {

        const parts =
            interaction.customId.split(
                "_"
            );


        /*
         * Normal button:
         * participants_GIVEAWAYID
         *
         * Navigation:
         * participants_prev_GIVEAWAYID_PAGE
         * participants_next_GIVEAWAYID_PAGE
         */

        let giveawayId =
            null;

        let page =
            0;


        if (
            parts[1] ===
                "prev" ||
            parts[1] ===
                "next"
        ) {

            const direction =
                parts[1];


            giveawayId =
                parts.slice(
                    2,
                    -1
                ).join("_");


            page =
                Number(
                    parts[
                        parts.length - 1
                    ]
                );


            if (
                direction ===
                "prev"
            ) {

                page--;

            } else {

                page++;
            }

        } else {

            giveawayId =
                parts
                    .slice(1)
                    .join("_");
        }


        const giveaway =
            db.getGiveaway(
                giveawayId
            );


        if (!giveaway) {

            return interaction.reply({

                content:
                    "❌ This giveaway no longer exists.",

                ephemeral:
                    true
            });
        }


        let participants = [];


        try {

            participants =
                db.getParticipants(
                    giveawayId
                );

        } catch (error) {

            console.error(
                "❌ Failed to load participants:",
                error
            );


            return interaction.reply({

                content:
                    "❌ Failed to load participants.",

                ephemeral:
                    true
            });
        }


        const pages =
            createParticipantPages(
                participants,
                10
            );


        page =
            Math.max(
                0,
                Math.min(
                    page,
                    pages.length - 1
                )
            );


        const currentPage =
            pages[page];


        let description;


        if (
            currentPage.length ===
            0
        ) {

            description =
                "No participants yet.";

        } else {

            description =
                currentPage
                    .map(
                        (
                            participant,
                            index
                        ) => {

                            const number =
                                page *
                                10 +
                                index +
                                1;


                            return (
                                `**${number}.** ` +
                                `<@${participant.discordId}>` +
                                ` — **${participantDisplayName(
                                    participant
                                )}**`
                            );
                        }
                    )
                    .join("\n");
        }


        const embed =
            new EmbedBuilder()

                .setTitle(
                    "👥 Giveaway Participants"
                )

                .setDescription(
                    description
                )

                .setFooter({
                    text:
                        `Page ${page + 1} / ${pages.length} • Total: ${participants.length}`
                });


        return interaction.reply({

            embeds: [
                embed
            ],

            components: [
                participantNavigationRow(
                    giveawayId,
                    page,
                    pages.length
                )
            ],

            ephemeral:
                true
        });
    }
}


// =====================================================
// SETUP GIVEAWAY
// =====================================================

if (
    interaction.isChatInputCommand() &&
    interaction.commandName ===
        "setup-giveaway"
) {

    if (
        !interaction.memberPermissions?.has(
            PermissionFlagsBits.ManageGuild
        )
    ) {

        return interaction.reply({

            content:
                "❌ You need **Manage Server** permission to use this command.",

            ephemeral:
                true
        });
    }


    const role =
        interaction.options.getRole(
            "staff_role"
        );


    if (!role) {

        return interaction.reply({

            content:
                "❌ Please select a staff role.",

            ephemeral:
                true
        });
    }


    if (
        role.id ===
        interaction.guild.roles.everyone.id
    ) {

        return interaction.reply({

            content:
                "❌ @everyone cannot be used as the giveaway staff role.",

            ephemeral:
                true
        });
    }


    try {

        if (
            typeof db.setGuildConfig ===
            "function"
        ) {

            db.setGuildConfig(
                interaction.guildId,
                {
                    staffRoleId:
                        role.id
                }
            );

        } else if (
            typeof db.setupGuild ===
            "function"
        ) {

            db.setupGuild(
                interaction.guildId,
                role.id
            );

        } else {

            throw new Error(
                "No guild configuration function exists in database.js"
            );
        }


        return interaction.reply({

            content:
                `✅ Giveaway staff role set to ${role}.`,

            ephemeral:
                true
        });

    } catch (error) {

        console.error(
            "❌ Failed to save giveaway setup:",
            error
        );


        return interaction.reply({

            content:
                "❌ Failed to save the giveaway configuration.",

            ephemeral:
                true
        });
    }
}


// =====================================================
// CANCEL GIVEAWAY
// =====================================================

if (
    interaction.isButton() &&
    interaction.customId.startsWith(
        "cancel_"
    )
) {

    const giveawayId =
        interaction.customId.substring(
            "cancel_".length
        );


    const giveaway =
        db.getGiveaway(
            giveawayId
        );


    if (!giveaway) {

        return interaction.reply({

            content:
                "❌ Giveaway not found.",

            ephemeral:
                true
        });
    }


    if (
        interaction.user.id !==
            giveaway.hostId &&
        !interaction.memberPermissions?.has(
            PermissionFlagsBits.ManageGuild
        )
    ) {

        return interaction.reply({

            content:
                "❌ You do not have permission to cancel this giveaway.",

            ephemeral:
                true
        });
    }


    if (
        giveaway.ended
    ) {

        return interaction.reply({

            content:
                "❌ This giveaway has already ended.",

            ephemeral:
                true
        });
    }


    try {

        if (
            giveawayTimers.has(
                giveawayId
            )
        ) {

            clearTimeout(
                giveawayTimers.get(
                    giveawayId
                )
            );


            giveawayTimers.delete(
                giveawayId
            );
        }


        if (
            typeof db.cancelGiveaway ===
            "function"
        ) {

            db.cancelGiveaway(
                giveawayId
            );

        } else {

            db.endGiveaway(
                giveawayId
            );
        }


        const embed =
            new EmbedBuilder()

                .setTitle(
                    "❌ GIVEAWAY CANCELLED"
                )

                .setDescription(
                    `The giveaway hosted by <@${giveaway.hostId}> has been cancelled.`
                )

                .setTimestamp();


        try {

            const channel =
                await interaction.guild.channels.fetch(
                    giveaway.channelId
                );


            const message =
                await channel.messages.fetch(
                    giveaway.messageId
                );


            await message.edit({

                embeds: [
                    embed
                ],

                components: []
            });

        } catch (error) {

            console.error(
                "❌ Failed to edit cancelled giveaway:",
                error
            );
        }


        return interaction.reply({

            content:
                "✅ Giveaway cancelled.",

            ephemeral:
                true
        });

    } catch (error) {

        console.error(
            "❌ Failed to cancel giveaway:",
            error
        );


        return interaction.reply({

            content:
                "❌ Failed to cancel giveaway.",

            ephemeral:
                true
        });
    }
}


// =====================================================
// END BUTTON
// =====================================================

if (
    interaction.isButton() &&
    interaction.customId.startsWith(
        "end_"
    )
) {

    const giveawayId =
        interaction.customId.substring(
            "end_".length
        );


    const giveaway =
        db.getGiveaway(
            giveawayId
        );


    if (!giveaway) {

        return interaction.reply({

            content:
                "❌ Giveaway not found.",

            ephemeral:
                true
        });
    }


    if (
        interaction.user.id !==
            giveaway.hostId &&
        !interaction.memberPermissions?.has(
            PermissionFlagsBits.ManageGuild
        )
    ) {

        return interaction.reply({

            content:
                "❌ You do not have permission to end this giveaway.",

            ephemeral:
                true
        });
    }


    if (
        giveaway.ended
    ) {

        return interaction.reply({

            content:
                "❌ This giveaway has already ended.",

            ephemeral:
                true
        });
    }


    await interaction.deferReply({
        ephemeral:
            true
    });


    try {

        await endGiveaway(
            giveawayId
        );


        return interaction.editReply({

            content:
                "✅ Giveaway ended successfully."
        });

    } catch (error) {

        console.error(
            "❌ Failed to manually end giveaway:",
            error
        );


        return interaction.editReply({

            content:
                "❌ Failed to end the giveaway."
        });
    }
}


// =====================================================
// KICK PARTICIPANT
// =====================================================

if (
    interaction.isButton() &&
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


    const discordId =
        parts.slice(
            2
        ).join("_");


    const giveaway =
        db.getGiveaway(
            giveawayId
        );


    if (!giveaway) {

        return interaction.reply({

            content:
                "❌ Giveaway not found.",

            ephemeral:
                true
        });
    }


    if (
        interaction.user.id !==
            giveaway.hostId &&
        !interaction.memberPermissions?.has(
            PermissionFlagsBits.ManageGuild
        )
    ) {

        return interaction.reply({

            content:
                "❌ You do not have permission to remove participants.",

            ephemeral:
                true
        });
    }


    try {

        if (
            typeof db.removeParticipant ===
            "function"
        ) {

            db.removeParticipant(
                giveawayId,
                discordId
            );

        } else if (
            typeof db.kickParticipant ===
            "function"
        ) {

            db.kickParticipant(
                giveawayId,
                discordId
            );

        } else {

            throw new Error(
                "No participant removal function exists in database.js"
            );
        }


        await updateGiveawayMessage(
            giveawayId
        );


        return interaction.reply({

            content:
                `✅ <@${discordId}> has been removed from the giveaway.`,

            ephemeral:
                true
        });

    } catch (error) {

        console.error(
            "❌ Failed to remove participant:",
            error
        );


        return interaction.reply({

            content:
                "❌ Failed to remove participant.",

            ephemeral:
                true
        });
    }
}


// =====================================================
// REROLL GIVEAWAY
// =====================================================

if (
    interaction.isButton() &&
    interaction.customId.startsWith(
        "reroll_"
    )
) {

    const giveawayId =
        interaction.customId.substring(
            "reroll_".length
        );


    const giveaway =
        db.getGiveaway(
            giveawayId
        );


    if (!giveaway) {

        return interaction.reply({

            content:
                "❌ Giveaway not found.",

            ephemeral:
                true
        });
    }


    if (
        interaction.user.id !==
            giveaway.hostId &&
        !interaction.memberPermissions?.has(
            PermissionFlagsBits.ManageGuild
        )
    ) {

        return interaction.reply({

            content:
                "❌ You do not have permission to reroll this giveaway.",

            ephemeral:
                true
        });
    }


    let participants =
        [];


    try {

        participants =
            db.getParticipants(
                giveawayId
            );

    } catch (error) {

        console.error(
            "❌ Failed to get participants for reroll:",
            error
        );
    }


    if (
        participants.length ===
        0
    ) {

        return interaction.reply({

            content:
                "❌ There are no participants to reroll.",

            ephemeral:
                true
        });
    }


    const winner =
        participants[
            Math.floor(
                Math.random() *
                participants.length
            )
        ];


    recordPayoutStatus(
        winner.discordId,
        giveawayId,
        giveaway.robux,
        "pending"
    );


    await sendWinnerToTicketBot({

        giveawayId,

        guildId:
            giveaway.guildId,

        discordId:
            winner.discordId,

        discordTag:
            winner.discordTag,

        robloxUsername:
            winner.robloxUsername,

        robloxUserId:
            winner.robloxUserId,

        robloxDisplayName:
            winner.robloxDisplayName,

        robux:
            giveaway.robux,

        hostId:
            giveaway.hostId,

        hostTag:
            giveaway.hostTag
    });


    return interaction.reply({

        content:
            `🔄 **Reroll Winner:** <@${winner.discordId}>\n` +
            `🎮 Roblox: **${winner.robloxUsername || "Unknown"}**\n` +
            `💰 Prize: **${Number(
                giveaway.robux
            ).toLocaleString()} Robux**`,

        ephemeral:
            false
    });
}

        // =====================================================
// HANDLE OLD / INVALID USERNAME MODALS
// =====================================================

if (
    interaction.isModalSubmit() &&
    interaction.customId.startsWith("username_")
) {

    return interaction.reply({

        content:
            "🔐 Roblox usernames are now taken from your verified Roblox account.\n\n" +
            "Please use **/verify** first, then join the giveaway.",

        ephemeral:
            true
    });
}


// =====================================================
// HANDLE UNKNOWN GIVEAWAY BUTTONS SAFELY
// =====================================================

if (
    interaction.isButton() &&
    interaction.customId.startsWith("join_")
) {

    /*
     * This section should normally never be reached because
     * the join button is handled above.
     *
     * It is kept as a safety fallback so an old giveaway
     * message cannot cause an unhandled interaction.
     */

    const giveawayId =
        interaction.customId.substring(
            "join_".length
        );


    const giveaway =
        db.getGiveaway(
            giveawayId
        );


    if (!giveaway) {

        return interaction.reply({

            content:
                "❌ This giveaway no longer exists.",

            ephemeral:
                true
        });
    }


    const verified =
        getVerifiedUser(
            interaction.user.id
        );


    if (!verified) {

        return interaction.reply({

            content:
                "🔐 You must verify your Roblox account first.\n\nUse **/verify**.",

            ephemeral:
                true
        });
    }


    return interaction.reply({

        content:
            "⚠️ Please use the Join Giveaway button again.",

        ephemeral:
            true
    });
}


// =====================================================
// SETUP SPECIAL GIVEAWAY
// =====================================================

if (
    interaction.isChatInputCommand() &&
    interaction.commandName ===
        "setup-special-giveaway"
) {

    if (
        !interaction.memberPermissions?.has(
            PermissionFlagsBits.ManageGuild
        )
    ) {

        return interaction.reply({

            content:
                "❌ You need **Manage Server** permission to use this command.",

            ephemeral:
                true
        });
    }


    const role =
        interaction.options.getRole(
            "staff_role"
        );


    if (!role) {

        return interaction.reply({

            content:
                "❌ Please select a staff role.",

            ephemeral:
                true
        });
    }


    if (
        role.id ===
        interaction.guild.roles.everyone.id
    ) {

        return interaction.reply({

            content:
                "❌ @everyone cannot be used as the special giveaway staff role.",

            ephemeral:
                true
        });
    }


    try {

        if (
            typeof db.setSpecialStaffRole ===
            "function"
        ) {

            db.setSpecialStaffRole(
                interaction.guildId,
                role.id
            );

        } else if (
            typeof db.setSpecialGiveawayRole ===
            "function"
        ) {

            db.setSpecialGiveawayRole(
                interaction.guildId,
                role.id
            );

        } else {

            /*
             * Some versions of the database only have one
             * staff-role configuration. In that case we keep
             * the normal configuration as a fallback.
             */

            if (
                typeof db.setGuildConfig ===
                "function"
            ) {

                const existing =
                    typeof db.getGuildConfig ===
                    "function"
                        ? db.getGuildConfig(
                            interaction.guildId
                        )
                        : {};


                db.setGuildConfig(

                    interaction.guildId,

                    {

                        ...(existing || {}),

                        specialStaffRoleId:
                            role.id
                    }
                );

            } else {

                throw new Error(
                    "No special giveaway configuration function exists."
                );
            }
        }


        return interaction.reply({

            content:
                `✅ Special giveaway staff role set to ${role}.`,

            ephemeral:
                true
        });

    } catch (error) {

        console.error(
            "❌ Failed to save special giveaway setup:",
            error
        );


        return interaction.reply({

            content:
                "❌ Failed to save the special giveaway configuration.",

            ephemeral:
                true
        });
    }
}


// =====================================================
// ERROR HANDLING FOR INTERACTIONS
// =====================================================

        } catch (error) {

            console.error(
                "❌ Interaction handler error:",
                error
            );


            try {

                if (
                    interaction.replied ||
                    interaction.deferred
                ) {

                    await interaction.followUp({

                        content:
                            "❌ Something went wrong while processing this interaction.",

                        ephemeral:
                            true
                    });

                } else {

                    await interaction.reply({

                        content:
                            "❌ Something went wrong while processing this interaction.",

                        ephemeral:
                            true
                    });
                }

            } catch {}
        }
    }
);


// =====================================================
// READY EVENT
// =====================================================

client.once(
    "clientReady",
    async () => {

        console.log(
            `🤖 Giveaway Bot logged in as ${client.user.tag}`
        );


        console.log(
            `🆔 Bot ID: ${client.user.id}`
        );


        try {

            await registerCommands();

        } catch (error) {

            console.error(
                "❌ Failed to register commands:",
                error
            );
        }


        try {

            await restoreGiveaways();

        } catch (error) {

            console.error(
                "❌ Failed to restore giveaways:",
                error
            );
        }
    }
);


// =====================================================
// CLIENT ERROR HANDLER
// =====================================================

client.on(
    "error",
    error => {

        console.error(
            "❌ Discord client error:",
            error
        );
    }
);


// =====================================================
// DISCONNECT / WARNINGS
// =====================================================

client.on(
    "warn",
    warning => {

        console.warn(
            "⚠️ Discord warning:",
            warning
        );
    }
);


// =====================================================
// PROCESS ERROR HANDLERS
// =====================================================

process.on(
    "unhandledRejection",
    error => {

        console.error(
            "❌ Unhandled Promise Rejection:",
            error
        );
    }
);


process.on(
    "uncaughtException",
    error => {

        console.error(
            "❌ Uncaught Exception:",
            error
        );
    }
);


// =====================================================
// START
// =====================================================

async function start() {

    console.log(
        "🚀 Starting Roblox Giveaway System..."
    );


    // =================================================
    // CHECK ENVIRONMENT
    // =================================================

    if (
        !process.env.GIVEAWAY_BOT_TOKEN
    ) {

        console.error(
            "❌ GIVEAWAY_BOT_TOKEN is missing."
        );

        process.exit(
            1
        );
    }


    if (
        !process.env.TICKET_API_URL
    ) {

        console.error(
            "❌ TICKET_API_URL is missing."
        );

        process.exit(
            1
        );
    }


    if (
        !process.env.TICKET_API_SECRET
    ) {

        console.error(
            "❌ TICKET_API_SECRET is missing."
        );

        process.exit(
            1
        );
    }


    // =================================================
    // DATABASE INITIALIZATION
    // =================================================

    try {

        if (
            typeof db.init ===
            "function"
        ) {

            db.init();
        }

    } catch (error) {

        console.error(
            "❌ Database initialization failed:",
            error
        );

        process.exit(
            1
        );
    }


    // =================================================
    // START INTERNAL API
    // =================================================

    try {

        startInternalServer();

    } catch (error) {

        console.error(
            "❌ Failed to start internal API:",
            error
        );
    }


    // =================================================
    // LOGIN
    // =================================================

    try {

        await client.login(
            process.env.GIVEAWAY_BOT_TOKEN
        );

    } catch (error) {

        console.error(
            "❌ Discord login failed:",
            error
        );

        process.exit(
            1
        );
    }
}


// =====================================================
// START APPLICATION
// =====================================================

start();
