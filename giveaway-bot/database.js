const Database = require("better-sqlite3");

// =====================================================
// DATABASE
// =====================================================

const db = new Database("giveaways.db");

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// =====================================================
// HELPERS
// =====================================================

function hasColumn(tableName, columnName) {

    const columns = db
        .prepare(`PRAGMA table_info(${tableName})`)
        .all();

    return columns.some(
        column => column.name === columnName
    );
}

function addColumnIfMissing(
    tableName,
    columnName,
    definition
) {

    if (!hasColumn(tableName, columnName)) {

        db.exec(`
            ALTER TABLE ${tableName}
            ADD COLUMN ${columnName} ${definition}
        `);
    }
}

// =====================================================
// GIVEAWAY CONFIG
// =====================================================

db.exec(`
    CREATE TABLE IF NOT EXISTS giveaway_configs (

        guildId TEXT PRIMARY KEY,

        staffRoleId TEXT,

        specialStaffRoleId TEXT
    );
`);

// Migrate old giveaway_configs tables

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
// GIVEAWAYS
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

        hostId TEXT,

        specialRoleId TEXT,

        ended INTEGER NOT NULL DEFAULT 0,

        createdAt INTEGER
    );
`);

// Migrate old giveaways tables

addColumnIfMissing(
    "giveaways",
    "guildId",
    "TEXT"
);

addColumnIfMissing(
    "giveaways",
    "channelId",
    "TEXT"
);

addColumnIfMissing(
    "giveaways",
    "messageId",
    "TEXT"
);

addColumnIfMissing(
    "giveaways",
    "robux",
    "INTEGER"
);

addColumnIfMissing(
    "giveaways",
    "winners",
    "INTEGER"
);

addColumnIfMissing(
    "giveaways",
    "endTime",
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
    "giveaways",
    "ended",
    "INTEGER DEFAULT 0"
);

addColumnIfMissing(
    "giveaways",
    "createdAt",
    "INTEGER"
);

// =====================================================
// PARTICIPANTS
// =====================================================

db.exec(`
    CREATE TABLE IF NOT EXISTS participants (

        giveawayId TEXT NOT NULL,

        discordId TEXT NOT NULL,

        discordTag TEXT,

        robloxUsername TEXT NOT NULL,

        createdAt INTEGER NOT NULL,

        PRIMARY KEY (
            giveawayId,
            discordId
        )
    );
`);

// =====================================================
// WINNERS
// =====================================================

db.exec(`
    CREATE TABLE IF NOT EXISTS winners (

        giveawayId TEXT NOT NULL,

        discordId TEXT NOT NULL,

        discordTag TEXT,

        robloxUsername TEXT NOT NULL,

        createdAt INTEGER NOT NULL,

        PRIMARY KEY (
            giveawayId,
            discordId
        )
    );
`);

// =====================================================
// OLD WINNERS MIGRATION
// =====================================================
//
// If an older database used giveaway_winners,
// copy the data into the new winners table.
// =====================================================

try {

    const oldTable =
        db.prepare(`
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
            AND name = 'giveaway_winners'
        `).get();

    if (oldTable) {

        const oldColumns =
            db
                .prepare(
                    `PRAGMA table_info(giveaway_winners)`
                )
                .all();

        const columnNames =
            oldColumns.map(
                column => column.name
            );

        const hasGiveawayId =
            columnNames.includes(
                "giveawayId"
            );

        const hasDiscordId =
            columnNames.includes(
                "discordId"
            );

        const hasDiscordTag =
            columnNames.includes(
                "discordTag"
            );

        const hasRobloxUsername =
            columnNames.includes(
                "robloxUsername"
            );

        if (
            hasGiveawayId &&
            hasDiscordId &&
            hasRobloxUsername
        ) {

            const discordTagColumn =
                hasDiscordTag
                    ? "discordTag"
                    : "NULL";

            db.exec(`
                INSERT OR IGNORE INTO winners (
                    giveawayId,
                    discordId,
                    discordTag,
                    robloxUsername,
                    createdAt
                )

                SELECT
                    giveawayId,
                    discordId,
                    ${discordTagColumn},
                    robloxUsername,
                    ${hasColumn("giveaway_winners", "createdAt")
                        ? "createdAt"
                        : "strftime('%s','now') * 1000"}

                FROM giveaway_winners;
            `);
        }
    }

} catch (error) {

    console.error(
        "⚠️ Old winners migration warning:",
        error.message
    );
}

// =====================================================
// GIVEAWAY CONFIG
// =====================================================

function setGiveawayConfig(
    guildId,
    staffRoleId
) {

    const existing =
        db.prepare(`
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

// =====================================================
// GET GIVEAWAY CONFIG
// =====================================================

function getGiveawayConfig(
    guildId
) {

    return db.prepare(`
        SELECT *

        FROM giveaway_configs

        WHERE guildId = ?
    `).get(guildId);
}

// =====================================================
// SPECIAL GIVEAWAY CONFIG
// =====================================================

function setSpecialGiveawayConfig(
    guildId,
    specialStaffRoleId
) {

    const existing =
        db.prepare(`
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

            VALUES (?, NULL, ?)
        `).run(
            guildId,
            specialStaffRoleId
        );
    }
}

// =====================================================
// CREATE GIVEAWAY
// =====================================================

function createGiveaway(
    data
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
            hostId,
            specialRoleId,
            ended,
            createdAt
        )

        VALUES (
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?
        )
    `).run(

        data.id,

        data.guildId,

        data.channelId,

        data.messageId || null,

        data.robux,

        data.winners,

        data.endTime,

        data.hostId || null,

        data.specialRoleId || null,

        0,

        data.createdAt || Date.now()
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

// =====================================================
// GET PARTICIPANTS
// =====================================================
//
// IMPORTANT:
// Do NOT use ORDER BY id here.
// The participants table does NOT have an id column.
// =====================================================

function getParticipants(
    giveawayId
) {

    return db.prepare(`
        SELECT *

        FROM participants

        WHERE giveawayId = ?

        ORDER BY createdAt ASC, discordId ASC
    `).all(
        giveawayId
    );
}

// =====================================================
// WINNERS
// =====================================================

function addWinner(
    data
) {

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

// =====================================================
// GET WINNERS
// =====================================================
//
// IMPORTANT:
// Do NOT use ORDER BY id here.
// The winners table does NOT have an id column.
// =====================================================

function getWinners(
    giveawayId
) {

    return db.prepare(`
        SELECT *

        FROM winners

        WHERE giveawayId = ?

        ORDER BY createdAt ASC, discordId ASC
    `).all(
        giveawayId
    );
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
    getWinners
};
