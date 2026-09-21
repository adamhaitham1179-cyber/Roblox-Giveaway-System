const Database = require("better-sqlite3");

const db = new Database("giveaways.db");

db.pragma("journal_mode = WAL");

// =====================================================
// DATABASE TABLES
// =====================================================

db.exec(`
    CREATE TABLE IF NOT EXISTS giveaways (
        id TEXT PRIMARY KEY,
        guildId TEXT NOT NULL,
        channelId TEXT NOT NULL,
        messageId TEXT,
        robux INTEGER NOT NULL,
        winners INTEGER NOT NULL,
        endTime INTEGER NOT NULL,
        ended INTEGER DEFAULT 0,
        hostId TEXT,
        specialRoleId TEXT
    );

    CREATE TABLE IF NOT EXISTS participants (
        giveawayId TEXT NOT NULL,
        discordId TEXT NOT NULL,
        discordTag TEXT,
        robloxUsername TEXT NOT NULL,

        PRIMARY KEY (giveawayId, discordId),

        FOREIGN KEY (giveawayId)
        REFERENCES giveaways(id)
        ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS giveaway_winners (
        giveawayId TEXT NOT NULL,
        discordId TEXT NOT NULL,
        discordTag TEXT,
        robloxUsername TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS giveaway_configs (
        guildId TEXT PRIMARY KEY,
        staffRoleId TEXT NOT NULL
    );
`);

// =====================================================
// DATABASE MIGRATIONS
// =====================================================

// Add hostId to old databases if it does not exist.
try {
    db.exec(`
        ALTER TABLE giveaways
        ADD COLUMN hostId TEXT;
    `);
} catch (error) {
    // Column already exists.
}

// Add specialRoleId to old databases if it does not exist.
try {
    db.exec(`
        ALTER TABLE giveaways
        ADD COLUMN specialRoleId TEXT;
    `);
} catch (error) {
    // Column already exists.
}

// =====================================================
// GIVEAWAY CONFIG
// =====================================================

function setGiveawayConfig(
    guildId,
    staffRoleId
) {

    db.prepare(`
        INSERT INTO giveaway_configs
        (
            guildId,
            staffRoleId
        )
        VALUES (?, ?)

        ON CONFLICT(guildId)
        DO UPDATE SET
            staffRoleId = excluded.staffRoleId
    `).run(
        guildId,
        staffRoleId
    );
}


function getGiveawayConfig(
    guildId
) {

    return db.prepare(`
        SELECT *
        FROM giveaway_configs
        WHERE guildId = ?
    `).get(
        guildId
    );
}

// =====================================================
// CREATE GIVEAWAY
// =====================================================

function createGiveaway(
    data
) {

    const stmt = db.prepare(`
        INSERT INTO giveaways
        (
            id,
            guildId,
            channelId,
            messageId,
            robux,
            winners,
            endTime,
            ended,
            hostId,
            specialRoleId
        )

        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `);

    stmt.run(
        data.id,
        data.guildId,
        data.channelId,
        data.messageId || null,
        data.robux,
        data.winners,
        data.endTime,
        data.hostId || null,
        data.specialRoleId || null
    );
}

// =====================================================
// UPDATE MESSAGE ID
// =====================================================

function updateMessageId(
    id,
    messageId
) {

    db.prepare(`
        UPDATE giveaways
        SET messageId = ?
        WHERE id = ?
    `).run(
        messageId,
        id
    );
}

// =====================================================
// PARTICIPANTS
// =====================================================

function addParticipant(
    data
) {

    db.prepare(`
        INSERT OR IGNORE INTO participants
        (
            giveawayId,
            discordId,
            discordTag,
            robloxUsername
        )

        VALUES (?, ?, ?, ?)
    `).run(
        data.giveawayId,
        data.discordId,
        data.discordTag,
        data.robloxUsername
    );
}


function getParticipants(
    giveawayId
) {

    return db.prepare(`
        SELECT
            discordId,
            discordTag,
            robloxUsername
        FROM participants
        WHERE giveawayId = ?
    `).all(
        giveawayId
    );
}

// =====================================================
// GET GIVEAWAY
// =====================================================

function getGiveaway(
    id
) {

    return db.prepare(`
        SELECT *
        FROM giveaways
        WHERE id = ?
    `).get(
        id
    );
}

// =====================================================
// GET ACTIVE GIVEAWAYS
// =====================================================

function getActiveGiveaways() {

    return db.prepare(`
        SELECT *
        FROM giveaways
        WHERE ended = 0
    `).all();
}

// =====================================================
// END GIVEAWAY
// =====================================================

function endGiveaway(
    id
) {

    db.prepare(`
        UPDATE giveaways
        SET ended = 1
        WHERE id = ?
    `).run(
        id
    );
}

// =====================================================
// WINNERS
// =====================================================

function addWinner(
    data
) {

    db.prepare(`
        INSERT INTO giveaway_winners
        (
            giveawayId,
            discordId,
            discordTag,
            robloxUsername
        )

        VALUES (?, ?, ?, ?)
    `).run(
        data.giveawayId,
        data.discordId,
        data.discordTag,
        data.robloxUsername
    );
}


function getWinners(
    giveawayId
) {

    return db.prepare(`
        SELECT
            discordId,
            discordTag,
            robloxUsername
        FROM giveaway_winners
        WHERE giveawayId = ?
    `).all(
        giveawayId
    );
}

// =====================================================
// EXPORTS
// =====================================================

module.exports = {

    setGiveawayConfig,
    getGiveawayConfig,

    createGiveaway,
    updateMessageId,

    addParticipant,
    getParticipants,

    getGiveaway,
    getActiveGiveaways,

    endGiveaway,

    addWinner,
    getWinners
};
