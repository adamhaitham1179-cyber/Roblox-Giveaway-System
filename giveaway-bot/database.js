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

function tableExists(tableName) {

    return !!db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
        AND name = ?
    `).get(tableName);
}

function hasColumn(
    tableName,
    columnName
) {

    if (!tableExists(tableName)) {
        return false;
    }

    const columns =
        db.prepare(
            `PRAGMA table_info(${tableName})`
        ).all();

    return columns.some(
        column =>
            column.name === columnName
    );
}

function addColumnIfMissing(
    tableName,
    columnName,
    definition
) {

    if (
        tableExists(tableName) &&
        !hasColumn(
            tableName,
            columnName
        )
    ) {

        db.exec(`
            ALTER TABLE ${tableName}
            ADD COLUMN ${columnName} ${definition}
        `);

        console.log(
            `✅ Added missing column ${columnName} to ${tableName}`
        );
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

// IMPORTANT:
// Existing databases may have participants table
// without createdAt.

addColumnIfMissing(
    "participants",
    "createdAt",
    "INTEGER"
);

// Fill createdAt for old participants
// that existed before this column was added.

try {

    if (
        tableExists("participants") &&
        hasColumn(
            "participants",
            "createdAt"
        )
    ) {

        db.prepare(`
            UPDATE participants

            SET createdAt = ?

            WHERE createdAt IS NULL
        `).run(
            Date.now()
        );
    }

} catch (error) {

    console.error(
        "⚠️ Participants migration warning:",
        error.message
    );
}

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

addColumnIfMissing(
    "winners",
    "createdAt",
    "INTEGER"
);

// Fill createdAt for old winners.

try {

    if (
        tableExists("winners") &&
        hasColumn(
            "winners",
            "createdAt"
        )
    ) {

        db.prepare(`
            UPDATE winners

            SET createdAt = ?

            WHERE createdAt IS NULL
        `).run(
            Date.now()
        );
    }

} catch (error) {

    console.error(
        "⚠️ Winners migration warning:",
        error.message
    );
}

// =====================================================
// OLD WINNERS TABLE MIGRATION
// =====================================================

try {

    if (
        tableExists(
            "giveaway_winners"
        )
    ) {

        const oldColumns =
            db.prepare(
                `PRAGMA table_info(giveaway_winners)`
            ).all();

        const columnNames =
            oldColumns.map(
                column =>
                    column.name
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

            const tagValue =
                hasDiscordTag
                    ? "discordTag"
                    : "NULL";

            const createdValue =
                columnNames.includes(
                    "createdAt"
                )
                    ? "createdAt"
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

                    ${tagValue},

                    robloxUsername,

                    ${createdValue}

                FROM giveaway_winners;
            `);

            // Make sure migrated rows have a date.

            db.prepare(`
                UPDATE winners

                SET createdAt = ?

                WHERE createdAt IS NULL
            `).run(
                Date.now()
            );
        }
    }

} catch (error) {

    console.error(
        "⚠️ Old winners migration warning:",
        error.message
    );
}

// =====================================================
// CONFIG
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
        `).get(
            guildId
        );

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
// GET CONFIG
// =====================================================

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
        `).get(
            guildId
        );

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

        data.createdAt ||
        Date.now()
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
    `).get(
        id
    );
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
// ADD PARTICIPANT
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
// ADD WINNER
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
