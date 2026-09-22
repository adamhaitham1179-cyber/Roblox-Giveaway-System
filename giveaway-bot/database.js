const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(
    path.join(__dirname, "giveaways.db")
);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// =====================================================
// HELPERS
// =====================================================

function getColumns(tableName) {
    return db
        .prepare(`PRAGMA table_info(${tableName})`)
        .all();
}

function hasColumn(tableName, columnName) {
    return getColumns(tableName).some(
        column => column.name === columnName
    );
}

function tableExists(tableName) {
    return !!db
        .prepare(`
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
            AND name = ?
        `)
        .get(tableName);
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

        console.log(
            `✅ Added missing column ${columnName} to ${tableName}`
        );
    }
}

// =====================================================
// INITIAL TABLES
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

        ended INTEGER NOT NULL DEFAULT 0,

        createdAt INTEGER,

        hostId TEXT,

        specialRoleId TEXT
    );

    CREATE TABLE IF NOT EXISTS participants (

        id INTEGER PRIMARY KEY AUTOINCREMENT,

        giveawayId TEXT NOT NULL,

        discordId TEXT NOT NULL,

        discordTag TEXT,

        robloxUsername TEXT NOT NULL,

        createdAt INTEGER
    );

    CREATE TABLE IF NOT EXISTS winners (

        id INTEGER PRIMARY KEY AUTOINCREMENT,

        giveawayId TEXT NOT NULL,

        discordId TEXT NOT NULL,

        discordTag TEXT,

        robloxUsername TEXT NOT NULL,

        createdAt INTEGER
    );

    CREATE TABLE IF NOT EXISTS giveaway_configs (

        guildId TEXT PRIMARY KEY,

        staffRoleId TEXT,

        specialStaffRoleId TEXT
    );

    CREATE TABLE IF NOT EXISTS kicked_participants (

        id INTEGER PRIMARY KEY AUTOINCREMENT,

        giveawayId TEXT NOT NULL,

        discordId TEXT NOT NULL,

        discordTag TEXT,

        robloxUsername TEXT,

        reason TEXT NOT NULL,

        kickedBy TEXT NOT NULL,

        createdAt INTEGER
    );

`);

// =====================================================
// GIVEAWAYS MIGRATION
// =====================================================

if (tableExists("giveaways")) {

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
        "giveaways",
        "ended",
        "INTEGER NOT NULL DEFAULT 0"
    );
}

// =====================================================
// PARTICIPANTS MIGRATION
// =====================================================

if (tableExists("participants")) {

    const columns =
        getColumns("participants");

    const hasId =
        columns.some(
            column =>
                column.name === "id"
        );

    const hasCreatedAt =
        columns.some(
            column =>
                column.name === "createdAt"
        );

    const hasDiscordTag =
        columns.some(
            column =>
                column.name === "discordTag"
        );

    if (!hasId) {

        console.log(
            "⚠️ Participants table is missing id. Migrating table..."
        );

        db.exec(`
            ALTER TABLE participants
            RENAME TO participants_old;
        `);

        db.exec(`

            CREATE TABLE participants (

                id INTEGER PRIMARY KEY AUTOINCREMENT,

                giveawayId TEXT NOT NULL,

                discordId TEXT NOT NULL,

                discordTag TEXT,

                robloxUsername TEXT NOT NULL,

                createdAt INTEGER
            );

        `);

        const oldColumns =
            getColumns("participants_old")
                .map(column => column.name);

        const oldHasCreatedAt =
            oldColumns.includes(
                "createdAt"
            );

        const oldHasDiscordTag =
            oldColumns.includes(
                "discordTag"
            );

        if (
            oldHasCreatedAt &&
            oldHasDiscordTag
        ) {

            db.exec(`

                INSERT INTO participants (
                    giveawayId,
                    discordId,
                    discordTag,
                    robloxUsername,
                    createdAt
                )

                SELECT
                    giveawayId,
                    discordId,
                    discordTag,
                    robloxUsername,
                    createdAt

                FROM participants_old;

            `);

        } else if (oldHasDiscordTag) {

            db.exec(`

                INSERT INTO participants (
                    giveawayId,
                    discordId,
                    discordTag,
                    robloxUsername
                )

                SELECT
                    giveawayId,
                    discordId,
                    discordTag,
                    robloxUsername

                FROM participants_old;

            `);

        } else {

            db.exec(`

                INSERT INTO participants (
                    giveawayId,
                    discordId,
                    robloxUsername
                )

                SELECT
                    giveawayId,
                    discordId,
                    robloxUsername

                FROM participants_old;

            `);
        }

        db.exec(`
            DROP TABLE participants_old;
        `);

        console.log(
            "✅ Participants table migrated."
        );

    } else {

        if (!hasDiscordTag) {

            addColumnIfMissing(
                "participants",
                "discordTag",
                "TEXT"
            );
        }

        if (!hasCreatedAt) {

            addColumnIfMissing(
                "participants",
                "createdAt",
                "INTEGER"
            );
        }
    }
}

// =====================================================
// WINNERS MIGRATION
// =====================================================

if (tableExists("winners")) {

    const columns =
        getColumns("winners");

    const hasId =
        columns.some(
            column =>
                column.name === "id"
        );

    const hasCreatedAt =
        columns.some(
            column =>
                column.name === "createdAt"
        );

    const hasDiscordTag =
        columns.some(
            column =>
                column.name === "discordTag"
        );

    if (!hasId) {

        console.log(
            "⚠️ Winners table is missing id. Migrating table..."
        );

        db.exec(`
            ALTER TABLE winners
            RENAME TO winners_old;
        `);

        db.exec(`

            CREATE TABLE winners (

                id INTEGER PRIMARY KEY AUTOINCREMENT,

                giveawayId TEXT NOT NULL,

                discordId TEXT NOT NULL,

                discordTag TEXT,

                robloxUsername TEXT NOT NULL,

                createdAt INTEGER
            );

        `);

        const oldColumns =
            getColumns("winners_old")
                .map(column => column.name);

        const oldHasCreatedAt =
            oldColumns.includes(
                "createdAt"
            );

        const oldHasDiscordTag =
            oldColumns.includes(
                "discordTag"
            );

        if (
            oldHasCreatedAt &&
            oldHasDiscordTag
        ) {

            db.exec(`

                INSERT INTO winners (
                    giveawayId,
                    discordId,
                    discordTag,
                    robloxUsername,
                    createdAt
                )

                SELECT
                    giveawayId,
                    discordId,
                    discordTag,
                    robloxUsername,
                    createdAt

                FROM winners_old;

            `);

        } else if (oldHasDiscordTag) {

            db.exec(`

                INSERT INTO winners (
                    giveawayId,
                    discordId,
                    discordTag,
                    robloxUsername
                )

                SELECT
                    giveawayId,
                    discordId,
                    discordTag,
                    robloxUsername

                FROM winners_old;

            `);

        } else {

            db.exec(`

                INSERT INTO winners (
                    giveawayId,
                    discordId,
                    robloxUsername
                )

                SELECT
                    giveawayId,
                    discordId,
                    robloxUsername

                FROM winners_old;

            `);
        }

        db.exec(`
            DROP TABLE winners_old;
        `);

        console.log(
            "✅ Winners table migrated."
        );

    } else {

        if (!hasDiscordTag) {

            addColumnIfMissing(
                "winners",
                "discordTag",
                "TEXT"
            );
        }

        if (!hasCreatedAt) {

            addColumnIfMissing(
                "winners",
                "createdAt",
                "INTEGER"
            );
        }
    }
}

// =====================================================
// GIVEAWAY CONFIG MIGRATION
// =====================================================

if (tableExists("giveaway_configs")) {

    const columns =
        getColumns("giveaway_configs");

    const staffColumn =
        columns.find(
            column =>
                column.name === "staffRoleId"
        );

    if (
        staffColumn &&
        staffColumn.notnull === 1
    ) {

        console.log(
            "⚠️ giveaway_configs has NOT NULL staffRoleId. Migrating table..."
        );

        db.exec(`
            ALTER TABLE giveaway_configs
            RENAME TO giveaway_configs_old;
        `);

        db.exec(`

            CREATE TABLE giveaway_configs (

                guildId TEXT PRIMARY KEY,

                staffRoleId TEXT,

                specialStaffRoleId TEXT
            );

        `);

        const oldColumns =
            getColumns("giveaway_configs_old")
                .map(column => column.name);

        const hasOldSpecialRole =
            oldColumns.includes(
                "specialStaffRoleId"
            );

        if (hasOldSpecialRole) {

            db.exec(`

                INSERT INTO giveaway_configs (
                    guildId,
                    staffRoleId,
                    specialStaffRoleId
                )

                SELECT
                    guildId,
                    staffRoleId,
                    specialStaffRoleId

                FROM giveaway_configs_old;

            `);

        } else {

            db.exec(`

                INSERT INTO giveaway_configs (
                    guildId,
                    staffRoleId
                )

                SELECT
                    guildId,
                    staffRoleId

                FROM giveaway_configs_old;

            `);
        }

        db.exec(`
            DROP TABLE giveaway_configs_old;
        `);

        console.log(
            "✅ giveaway_configs table migrated."
        );

    } else {

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
    }
}

// =====================================================
// GIVEAWAY CONFIG
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

function setGiveawayConfig(
    guildId,
    staffRoleId
) {

    const existing =
        getGiveawayConfig(
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

function setSpecialGiveawayConfig(
    guildId,
    specialStaffRoleId
) {

    const existing =
        getGiveawayConfig(
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
// GIVEAWAYS
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
            createdAt,
            hostId,
            specialRoleId

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

        giveaway.ended
            ? 1
            : 0,

        giveaway.createdAt ||
            Date.now(),

        giveaway.hostId ||
            null,

        giveaway.specialRoleId ||
            null
    );
}

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

function cancelGiveaway(
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

        data.discordTag ||
            null,

        data.robloxUsername,

        data.createdAt ||
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

function getParticipant(
    giveawayId,
    discordId
) {

    return db.prepare(`

        SELECT *

        FROM participants

        WHERE giveawayId = ?

        AND discordId = ?

        LIMIT 1

    `).get(
        giveawayId,
        discordId
    );
}

function isParticipant(
    giveawayId,
    discordId
) {

    return !!getParticipant(
        giveawayId,
        discordId
    );
}

function removeParticipant(
    giveawayId,
    discordId
) {

    const result =
        db.prepare(`

            DELETE FROM participants

            WHERE giveawayId = ?

            AND discordId = ?

        `).run(
            giveawayId,
            discordId
        );

    return result.changes > 0;
}

function removeAllParticipants(
    giveawayId
) {

    db.prepare(`

        DELETE FROM participants

        WHERE giveawayId = ?

    `).run(giveawayId);
}

// =====================================================
// KICKED PARTICIPANTS
// =====================================================

function addKickedParticipant(
    data
) {

    db.prepare(`

        INSERT INTO kicked_participants (

            giveawayId,
            discordId,
            discordTag,
            robloxUsername,
            reason,
            kickedBy,
            createdAt

        )

        VALUES (?, ?, ?, ?, ?, ?, ?)

    `).run(

        data.giveawayId,

        data.discordId,

        data.discordTag ||
            null,

        data.robloxUsername ||
            null,

        data.reason,

        data.kickedBy,

        data.createdAt ||
            Date.now()
    );
}

function getKickedParticipant(
    giveawayId,
    discordId
) {

    return db.prepare(`

        SELECT *

        FROM kicked_participants

        WHERE giveawayId = ?

        AND discordId = ?

        ORDER BY id DESC

        LIMIT 1

    `).get(
        giveawayId,
        discordId
    );
}

function isKickedParticipant(
    giveawayId,
    discordId
) {

    return !!getKickedParticipant(
        giveawayId,
        discordId
    );
}

function removeKickedParticipant(
    giveawayId,
    discordId
) {

    db.prepare(`

        DELETE FROM kicked_participants

        WHERE giveawayId = ?

        AND discordId = ?

    `).run(
        giveawayId,
        discordId
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

        data.discordTag ||
            null,

        data.robloxUsername,

        data.createdAt ||
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

function getWinner(
    giveawayId,
    discordId
) {

    return db.prepare(`

        SELECT *

        FROM winners

        WHERE giveawayId = ?

        AND discordId = ?

        LIMIT 1

    `).get(
        giveawayId,
        discordId
    );
}

// =====================================================
// EXPORTS
// =====================================================

module.exports = {

    // Config
    getGiveawayConfig,
    setGiveawayConfig,
    setSpecialGiveawayConfig,

    // Giveaways
    createGiveaway,
    updateMessageId,
    getGiveaway,
    endGiveaway,
    cancelGiveaway,
    getActiveGiveaways,

    // Participants
    addParticipant,
    getParticipants,
    getParticipant,
    isParticipant,
    removeParticipant,
    removeAllParticipants,

    // Kicked participants
    addKickedParticipant,
    getKickedParticipant,
    isKickedParticipant,
    removeKickedParticipant,

    // Winners
    addWinner,
    getWinners,
    getWinner
};
