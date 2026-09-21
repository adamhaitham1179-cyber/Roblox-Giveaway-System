const Database = require("better-sqlite3");

const db = new Database("giveaways.db");

db.pragma("journal_mode = WAL");

// =====================================================
// TABLES
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
        createdAt INTEGER NOT NULL,
        hostId TEXT,
        specialRoleId TEXT
    );

    CREATE TABLE IF NOT EXISTS participants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        giveawayId TEXT NOT NULL,
        discordId TEXT NOT NULL,
        discordTag TEXT NOT NULL,
        robloxUsername TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        UNIQUE(giveawayId, discordId)
    );

    CREATE TABLE IF NOT EXISTS winners (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        giveawayId TEXT NOT NULL,
        discordId TEXT NOT NULL,
        discordTag TEXT NOT NULL,
        robloxUsername TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        UNIQUE(giveawayId, discordId)
    );

    CREATE TABLE IF NOT EXISTS giveaway_configs (
        guildId TEXT PRIMARY KEY,
        staffRoleId TEXT NOT NULL,
        specialStaffRoleId TEXT
    );
`);

// =====================================================
// SAFE MIGRATION
// =====================================================

function addColumnIfMissing(table, column, definition) {

    const columns = db
        .prepare(`PRAGMA table_info(${table})`)
        .all();

    const exists = columns.some(
        columnInfo => columnInfo.name === column
    );

    if (!exists) {
        db.exec(
            `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`
        );
    }
}

// Existing databases may not have these columns.
addColumnIfMissing(
    "giveaways",
    "createdAt",
    "INTEGER"
);

addColumnIfMissing(
    "giveaways",
    "hostId",
    "TEXT"
);

addColumnIfMissing(
    "giveaways",
    "specialRoleId",
    "TEXT"
);

addColumnIfMissing(
    "giveaway_configs",
    "specialStaffRoleId",
    "TEXT"
);

// =====================================================
// GIVEAWAY CONFIG
// =====================================================

function setGiveawayConfig(
    guildId,
    staffRoleId
) {

    const existing = db.prepare(`
        SELECT guildId
        FROM giveaway_configs
        WHERE guildId = ?
    `).get(guildId);

    if (existing) {

        db.prepare(`
            UPDATE giveaway_configs
            SET staffRoleId = ?
            WHERE guildId = ?
        `).run(
            staffRoleId,
            guildId
        );

    } else {

        db.prepare(`
            INSERT INTO giveaway_configs (
                guildId,
                staffRoleId,
                specialStaffRoleId
            )
            VALUES (?, ?, NULL)
        `).run(
            guildId,
            staffRoleId
        );
    }
}

function getGiveawayConfig(
    guildId
) {

    return db.prepare(`
        SELECT *
        FROM giveaway_configs
        WHERE guildId = ?
    `).get(guildId);
}

function setSpecialGiveawayConfig(
    guildId,
    specialStaffRoleId
) {

    const existing = db.prepare(`
        SELECT guildId
        FROM giveaway_configs
        WHERE guildId = ?
    `).get(guildId);

    if (existing) {

        db.prepare(`
            UPDATE giveaway_configs
            SET specialStaffRoleId = ?
            WHERE guildId = ?
        `).run(
            specialStaffRoleId,
            guildId
        );

    } else {

        db.prepare(`
            INSERT INTO giveaway_configs (
                guildId,
                staffRoleId,
                specialStaffRoleId
            )
            VALUES (?, '', ?)
        `).run(
            guildId,
            specialStaffRoleId
        );
    }
}

// =====================================================
// GIVEAWAYS
// =====================================================

function createGiveaway(data) {

    db.prepare(`
        INSERT INTO giveaways (
            id,
            guildId,
            channelId,
            messageId,
            robux,
            winners,
            endTime,
            ended,
            createdAt,
            hostId,
            specialRoleId
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(
        data.id,
        data.guildId,
        data.channelId,
        data.messageId || null,
        Number(data.robux),
        Number(data.winners),
        Number(data.endTime),
        Date.now(),
        data.hostId || null,
        data.specialRoleId || null
    );
}

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

function getGiveaway(
    id
) {

    return db.prepare(`
        SELECT *
        FROM giveaways
        WHERE id = ?
    `).get(id);
}

function endGiveaway(
    id
) {

    db.prepare(`
        UPDATE giveaways
        SET ended = 1
        WHERE id = ?
    `).run(id);
}

function getActiveGiveaways() {

    return db.prepare(`
        SELECT *
        FROM giveaways
        WHERE ended = 0
        ORDER BY endTime ASC
    `).all();
}

// =====================================================
// PARTICIPANTS
// =====================================================

function addParticipant(data) {

    db.prepare(`
        INSERT OR IGNORE INTO participants (
            giveawayId,
            discordId,
            discordTag,
            robloxUsername,
            createdAt
        )
        VALUES (?, ?, ?, ?, ?)
    `).run(
        data.giveawayId,
        data.discordId,
        data.discordTag,
        data.robloxUsername,
        Date.now()
    );
}

function getParticipants(
    giveawayId
) {

    return db.prepare(`
        SELECT *
        FROM participants
        WHERE giveawayId = ?
        ORDER BY id ASC
    `).all(giveawayId);
}

// =====================================================
// WINNERS
// =====================================================

function addWinner(data) {

    db.prepare(`
        INSERT OR IGNORE INTO winners (
            giveawayId,
            discordId,
            discordTag,
            robloxUsername,
            createdAt
        )
        VALUES (?, ?, ?, ?, ?)
    `).run(
        data.giveawayId,
        data.discordId,
        data.discordTag,
        data.robloxUsername,
        Date.now()
    );
}

function getWinners(
    giveawayId
) {

    return db.prepare(`
        SELECT *
        FROM winners
        WHERE giveawayId = ?
        ORDER BY id ASC
    `).all(giveawayId);
}

// =====================================================
// EXPORTS
// =====================================================

module.exports = {

    setGiveawayConfig,
    getGiveawayConfig,

    setSpecialGiveawayConfig,

    createGiveaway,
    updateMessageId,
    getGiveaway,
    endGiveaway,
    getActiveGiveaways,

    addParticipant,
    getParticipants,

    addWinner,
    getWinners
};
