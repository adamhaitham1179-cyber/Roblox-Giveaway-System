const Database = require("better-sqlite3");

// =====================================================
// DATABASE
// =====================================================

const db = new Database("giveaways.db");

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = OFF");

// =====================================================
// HELPERS
// =====================================================

function getColumns(tableName) {
    return db.prepare(`
        PRAGMA table_info(${tableName})
    `).all();
}

function hasColumn(tableName, columnName) {
    return getColumns(tableName).some(
        column => column.name === columnName
    );
}

function addColumnIfMissing(
    tableName,
    columnName,
    definition
) {
    if (!hasColumn(tableName, columnName)) {

        db.prepare(`
            ALTER TABLE ${tableName}
            ADD COLUMN ${columnName} ${definition}
        `).run();

        console.log(
            `✅ Added missing column ${columnName} to ${tableName}`
        );
    }
}

// =====================================================
// BASE TABLES
// =====================================================

db.exec(`
    CREATE TABLE IF NOT EXISTS giveaway_configs (
        guildId TEXT PRIMARY KEY,
        staffRoleId TEXT,
        specialStaffRoleId TEXT
    );

    CREATE TABLE IF NOT EXISTS giveaways (
        id TEXT PRIMARY KEY,
        guildId TEXT NOT NULL,
        channelId TEXT NOT NULL,
        messageId TEXT,
        robux INTEGER NOT NULL,
        winners INTEGER NOT NULL,
        endTime INTEGER NOT NULL,
        ended INTEGER NOT NULL DEFAULT 0,
        hostId TEXT,
        specialRoleId TEXT,
        createdAt INTEGER
    );

    CREATE TABLE IF NOT EXISTS participants (
        giveawayId TEXT NOT NULL,
        discordId TEXT NOT NULL,
        discordTag TEXT NOT NULL,
        robloxUsername TEXT NOT NULL,
        createdAt INTEGER
    );

    CREATE TABLE IF NOT EXISTS winners (
        giveawayId TEXT NOT NULL,
        discordId TEXT NOT NULL,
        discordTag TEXT NOT NULL,
        robloxUsername TEXT NOT NULL,
        createdAt INTEGER
    );
`);

// =====================================================
// GIVEAWAY CONFIG MIGRATION
// =====================================================

addColumnIfMissing(
    "giveaway_configs",
    "staffRoleId",
    "TEXT"
);

addColumnIfMissing(
    "giveaway_configs",
    "specialStaffRoleId",
    "TEXT"
);

// =====================================================
// GIVEAWAYS MIGRATION
// =====================================================

addColumnIfMissing(
    "giveaways",
    "messageId",
    "TEXT"
);

addColumnIfMissing(
    "giveaways",
    "ended",
    "INTEGER NOT NULL DEFAULT 0"
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
    "giveaways",
    "createdAt",
    "INTEGER"
);

// Fill missing createdAt values
try {

    db.prepare(`
        UPDATE giveaways
        SET createdAt = ?
        WHERE createdAt IS NULL
    `).run(Date.now());

} catch (error) {

    console.error(
        "⚠️ Could not update giveaway createdAt:",
        error.message
    );
}

// =====================================================
// PARTICIPANTS MIGRATION
// =====================================================

addColumnIfMissing(
    "participants",
    "discordTag",
    "TEXT"
);

addColumnIfMissing(
    "participants",
    "robloxUsername",
    "TEXT"
);

addColumnIfMissing(
    "participants",
    "createdAt",
    "INTEGER"
);

// =====================================================
// WINNERS MIGRATION
// =====================================================

addColumnIfMissing(
    "winners",
    "discordTag",
    "TEXT"
);

addColumnIfMissing(
    "winners",
    "robloxUsername",
    "TEXT"
);

addColumnIfMissing(
    "winners",
    "createdAt",
    "INTEGER"
);

// =====================================================
// DEFAULT VALUES
// =====================================================

try {

    db.prepare(`
        UPDATE participants
        SET createdAt = ?
        WHERE createdAt IS NULL
    `).run(Date.now());

} catch {}

try {

    db.prepare(`
        UPDATE winners
        SET createdAt = ?
        WHERE createdAt IS NULL
    `).run(Date.now());

} catch {}

try {

    db.prepare(`
        UPDATE giveaways
        SET ended = 0
        WHERE ended IS NULL
    `).run();

} catch {}

// =====================================================
// CONFIG
// =====================================================

function getGiveawayConfig(
    guildId
) {

    return db.prepare(`
        SELECT
            guildId,
            staffRoleId,
            specialStaffRoleId
        FROM giveaway_configs
        WHERE guildId = ?
    `).get(guildId);
}

// =====================================================
// SET NORMAL GIVEAWAY STAFF
// =====================================================

function setGiveawayConfig(
    guildId,
    staffRoleId
) {

    const existing =
        db.prepare(`
            SELECT *
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

        // specialStaffRoleId can stay NULL
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

    console.log(
        `✅ Normal Giveaway Staff configured for ${guildId}: ${staffRoleId}`
    );
}

// =====================================================
// SET SPECIAL GIVEAWAY STAFF
// =====================================================

function setSpecialGiveawayConfig(
    guildId,
    specialStaffRoleId
) {

    const existing =
        db.prepare(`
            SELECT *
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

        /*
         * IMPORTANT:
         *
         * Some old databases had staffRoleId
         * as NOT NULL.
         *
         * We therefore store an empty string
         * instead of NULL when only the special
         * giveaway role has been configured.
         *
         * The bot treats "" as "not configured".
         */

        db.prepare(`
            INSERT INTO giveaway_configs (
                guildId,
                staffRoleId,
                specialStaffRoleId
            )
            VALUES (?, ?, ?)
        `).run(
            guildId,
            "",
            specialStaffRoleId
        );
    }

    console.log(
        `✅ Special Giveaway Staff configured for ${guildId}: ${specialStaffRoleId}`
    );
}

// =====================================================
// CREATE GIVEAWAY
// =====================================================

function createGiveaway(
    giveaway
) {

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
            hostId,
            specialRoleId,
            createdAt
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(

        giveaway.id,

        giveaway.guildId,

        giveaway.channelId,

        giveaway.messageId || null,

        giveaway.robux,

        giveaway.winners,

        giveaway.endTime,

        0,

        giveaway.hostId || null,

        giveaway.specialRoleId || null,

        Date.now()
    );
}

// =====================================================
// UPDATE MESSAGE ID
// =====================================================

function updateMessageId(
    giveawayId,
    messageId
) {

    db.prepare(`
        UPDATE giveaways
        SET messageId = ?
        WHERE id = ?
    `).run(
        messageId,
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
    `).get(id);
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
    `).run(id);
}

// =====================================================
// ACTIVE GIVEAWAYS
// =====================================================

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

function addParticipant(
    data
) {

    /*
     * We intentionally do NOT use "id"
     * because older databases may not have
     * an id column.
     */

    db.prepare(`
        INSERT INTO participants (
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

// =====================================================
// GET PARTICIPANTS
// =====================================================

function getParticipants(
    giveawayId
) {

    /*
     * rowid exists automatically in normal
     * SQLite tables and works even if the old
     * table does not have an "id" column.
     */

    return db.prepare(`
        SELECT *
        FROM participants
        WHERE giveawayId = ?
        ORDER BY rowid ASC
    `).all(giveawayId);
}

// =====================================================
// WINNERS
// =====================================================

function addWinner(
    data
) {

    db.prepare(`
        INSERT INTO winners (
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

// =====================================================
// GET WINNERS
// =====================================================

function getWinners(
    giveawayId
) {

    return db.prepare(`
        SELECT *
        FROM winners
        WHERE giveawayId = ?
        ORDER BY rowid ASC
    `).all(giveawayId);
}

// =====================================================
// CLOSE DATABASE
// =====================================================

function closeDatabase() {

    try {

        db.close();

    } catch {}
}

// =====================================================
// EXPORTS
// =====================================================

module.exports = {

    // Config
    setGiveawayConfig,
    getGiveawayConfig,
    setSpecialGiveawayConfig,

    // Giveaways
    createGiveaway,
    updateMessageId,
    getGiveaway,
    endGiveaway,
    getActiveGiveaways,

    // Participants
    addParticipant,
    getParticipants,

    // Winners
    addWinner,
    getWinners,

    // Database
    closeDatabase
};
