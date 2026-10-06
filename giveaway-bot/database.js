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

    -- =================================================
    -- ROBLOX VERIFICATION
    -- =================================================

    CREATE TABLE IF NOT EXISTS verified_users (

        discordId TEXT PRIMARY KEY,

        robloxUserId TEXT NOT NULL UNIQUE,

        robloxUsername TEXT NOT NULL,

        robloxDisplayName TEXT,

        robloxAvatarUrl TEXT,

        verifiedAt INTEGER NOT NULL,

        verificationCode TEXT,

        verificationCodeExpiresAt INTEGER,

        lastVerificationAttempt INTEGER DEFAULT 0,

        verificationAttempts INTEGER DEFAULT 0
    );

    -- =================================================
    -- VERIFICATION ATTEMPTS / SECURITY LOG
    -- =================================================

    CREATE TABLE IF NOT EXISTS verification_logs (

        id INTEGER PRIMARY KEY AUTOINCREMENT,

        discordId TEXT NOT NULL,

        robloxUserId TEXT,

        robloxUsername TEXT,

        action TEXT NOT NULL,

        success INTEGER NOT NULL DEFAULT 0,

        reason TEXT,

        createdAt INTEGER NOT NULL
    );

    -- =================================================
    -- USER STATS
    -- =================================================

    CREATE TABLE IF NOT EXISTS user_stats (

        discordId TEXT PRIMARY KEY,

        giveawaysWon INTEGER NOT NULL DEFAULT 0,

        totalPrize INTEGER NOT NULL DEFAULT 0,

        totalPaid INTEGER NOT NULL DEFAULT 0,

        pendingAmount INTEGER NOT NULL DEFAULT 0,

        updatedAt INTEGER NOT NULL
    );

    -- =================================================
    -- PRIZE LEDGER
    -- =================================================

    CREATE TABLE IF NOT EXISTS prize_ledger (

        id INTEGER PRIMARY KEY AUTOINCREMENT,

        giveawayId TEXT NOT NULL,

        discordId TEXT NOT NULL,

        robloxUserId TEXT,

        robloxUsername TEXT,

        amount INTEGER NOT NULL,

        status TEXT NOT NULL DEFAULT 'pending',

        ticketId TEXT,

        paidBy TEXT,

        paidAt INTEGER,

        createdAt INTEGER NOT NULL,

        UNIQUE(giveawayId, discordId)
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
// ROBLOX VERIFICATION
// =====================================================

function getVerifiedUser(
    discordId
) {

    return db.prepare(`

        SELECT *

        FROM verified_users

        WHERE discordId = ?

        LIMIT 1

    `).get(discordId);
}

function getVerifiedUserByRobloxId(
    robloxUserId
) {

    return db.prepare(`

        SELECT *

        FROM verified_users

        WHERE robloxUserId = ?

        LIMIT 1

    `).get(
        String(robloxUserId)
    );
}

function isVerified(
    discordId
) {

    return !!getVerifiedUser(
        discordId
    );
}

function saveVerification(
    data
) {

    const existing =
        getVerifiedUser(
            data.discordId
        );

    const alreadyLinked =
        getVerifiedUserByRobloxId(
            data.robloxUserId
        );

    // Same Roblox account is already linked
    // to another Discord account.
    if (
        alreadyLinked &&
        alreadyLinked.discordId !==
            data.discordId
    ) {

        throw new Error(
            "ROBLOX_ACCOUNT_ALREADY_LINKED"
        );
    }

    // A verified Discord account cannot
    // silently change its Roblox account.
    if (
        existing &&
        String(existing.robloxUserId) !==
            String(data.robloxUserId)
    ) {

        throw new Error(
            "DISCORD_ACCOUNT_ALREADY_VERIFIED"
        );
    }

    db.prepare(`

        INSERT INTO verified_users (

            discordId,
            robloxUserId,
            robloxUsername,
            robloxDisplayName,
            robloxAvatarUrl,
            verifiedAt,
            verificationCode,
            verificationCodeExpiresAt,
            lastVerificationAttempt,
            verificationAttempts

        )

        VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)

        ON CONFLICT(discordId)
        DO UPDATE SET

            robloxUserId =
                excluded.robloxUserId,

            robloxUsername =
                excluded.robloxUsername,

            robloxDisplayName =
                excluded.robloxDisplayName,

            robloxAvatarUrl =
                excluded.robloxAvatarUrl,

            verifiedAt =
                excluded.verifiedAt

    `).run(

        data.discordId,

        String(data.robloxUserId),

        data.robloxUsername,

        data.robloxDisplayName ||
            null,

        data.robloxAvatarUrl ||
            null,

        data.verifiedAt ||
            Date.now(),

        data.lastVerificationAttempt ||
            0,

        data.verificationAttempts ||
            0
    );

    return getVerifiedUser(
        data.discordId
    );
}

function createVerificationCode(
    discordId,
    code,
    expiresAt
) {

    const now =
        Date.now();

    const existing =
        getVerifiedUser(
            discordId
        );

    if (existing) {

        return false;
    }

    db.prepare(`

        INSERT INTO verified_users (

            discordId,
            robloxUserId,
            robloxUsername,
            robloxDisplayName,
            robloxAvatarUrl,
            verifiedAt,
            verificationCode,
            verificationCodeExpiresAt,
            lastVerificationAttempt,
            verificationAttempts

        )

        VALUES (
            ?,
            ?,
            ?,
            NULL,
            NULL,
            0,
            ?,
            ?,
            ?,
            0
        )

        ON CONFLICT(discordId)
        DO UPDATE SET

            verificationCode =
                excluded.verificationCode,

            verificationCodeExpiresAt =
                excluded.verificationCodeExpiresAt

    `).run(

        discordId,

        `pending_${discordId}`,

        `pending_${discordId}`,

        code,

        expiresAt,

        now
    );

    return true;
}

function getPendingVerification(
    discordId
) {

    return db.prepare(`

        SELECT *

        FROM verified_users

        WHERE discordId = ?

        AND verificationCode IS NOT NULL

        AND verificationCodeExpiresAt > ?

        AND verifiedAt = 0

        LIMIT 1

    `).get(
        discordId,
        Date.now()
    );
}

function clearVerificationCode(
    discordId
) {

    db.prepare(`

        UPDATE verified_users

        SET
            verificationCode = NULL,
            verificationCodeExpiresAt = NULL

        WHERE discordId = ?

    `).run(discordId);
}

function recordVerificationAttempt(
    discordId,
    success,
    reason,
    robloxUserId,
    robloxUsername
) {

    const now =
        Date.now();

    const existing =
        getVerifiedUser(
            discordId
        );

    if (existing) {

        db.prepare(`

            UPDATE verified_users

            SET
                lastVerificationAttempt = ?,
                verificationAttempts =
                    COALESCE(
                        verificationAttempts,
                        0
                    ) + 1

            WHERE discordId = ?

        `).run(
            now,
            discordId
        );

    } else {

        db.prepare(`

            INSERT OR IGNORE INTO verified_users (

                discordId,
                robloxUserId,
                robloxUsername,
                verifiedAt,
                lastVerificationAttempt,
                verificationAttempts

            )

            VALUES (
                ?,
                ?,
                ?,
                0,
                ?,
                1
            )

        `).run(

            discordId,

            robloxUserId ||
                `pending_${discordId}`,

            robloxUsername ||
                `pending_${discordId}`,

            now
        );
    }

    db.prepare(`

        INSERT INTO verification_logs (

            discordId,
            robloxUserId,
            robloxUsername,
            action,
            success,
            reason,
            createdAt

        )

        VALUES (?, ?, ?, ?, ?, ?, ?)

    `).run(

        discordId,

        robloxUserId ||
            null,

        robloxUsername ||
            null,

        "verification_attempt",

        success
            ? 1
            : 0,

        reason ||
            null,

        now
    );
}

function getVerificationAttempts(
    discordId
) {

    const row =
        db.prepare(`

            SELECT
                verificationAttempts,
                lastVerificationAttempt

            FROM verified_users

            WHERE discordId = ?

            LIMIT 1

        `).get(discordId);

    return row || {

        verificationAttempts: 0,

        lastVerificationAttempt: 0
    };
}

function deletePendingVerification(
    discordId
) {

    db.prepare(`

        DELETE FROM verified_users

        WHERE discordId = ?

        AND verifiedAt = 0

    `).run(discordId);
}

// =====================================================
// USER STATS
// =====================================================

function ensureUserStats(
    discordId
) {

    db.prepare(`

        INSERT OR IGNORE INTO user_stats (

            discordId,
            giveawaysWon,
            totalPrize,
            totalPaid,
            pendingAmount,
            updatedAt

        )

        VALUES (?, 0, 0, 0, 0, ?)

    `).run(
        discordId,
        Date.now()
    );
}

function getUserStats(
    discordId
) {

    ensureUserStats(
        discordId
    );

    return db.prepare(`

        SELECT *

        FROM user_stats

        WHERE discordId = ?

        LIMIT 1

    `).get(discordId);
}

function updateUserStats(
    discordId,
    values
) {

    ensureUserStats(
        discordId
    );

    const current =
        getUserStats(
            discordId
        );

    const giveawaysWon =
        values.giveawaysWon !== undefined
            ? values.giveawaysWon
            : current.giveawaysWon;

    const totalPrize =
        values.totalPrize !== undefined
            ? values.totalPrize
            : current.totalPrize;

    const totalPaid =
        values.totalPaid !== undefined
            ? values.totalPaid
            : current.totalPaid;

    const pendingAmount =
        values.pendingAmount !== undefined
            ? values.pendingAmount
            : current.pendingAmount;

    db.prepare(`

        UPDATE user_stats

        SET

            giveawaysWon = ?,

            totalPrize = ?,

            totalPaid = ?,

            pendingAmount = ?,

            updatedAt = ?

        WHERE discordId = ?

    `).run(

        Math.max(
            0,
            Number(giveawaysWon) || 0
        ),

        Math.max(
            0,
            Number(totalPrize) || 0
        ),

        Math.max(
            0,
            Number(totalPaid) || 0
        ),

        Math.max(
            0,
            Number(pendingAmount) || 0
        ),

        Date.now(),

        discordId
    );

    return getUserStats(
        discordId
    );
}

// =====================================================
// PRIZE LEDGER
// =====================================================

function createPrize(
    data
) {

    const amount =
        Number(data.amount);

    if (
        !Number.isInteger(amount) ||
        amount <= 0
    ) {

        throw new Error(
            "INVALID_PRIZE_AMOUNT"
        );
    }

    const existing =
        getPrize(
            data.giveawayId,
            data.discordId
        );

    if (existing) {

        return existing;
    }

    const now =
        Date.now();

    db.prepare(`

        INSERT INTO prize_ledger (

            giveawayId,
            discordId,
            robloxUserId,
            robloxUsername,
            amount,
            status,
            ticketId,
            paidBy,
            paidAt,
            createdAt

        )

        VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL, NULL, ?)

    `).run(

        data.giveawayId,

        data.discordId,

        data.robloxUserId ||
            null,

        data.robloxUsername ||
            null,

        amount,

        data.ticketId ||
            null,

        now
    );

    ensureUserStats(
        data.discordId
    );

    db.prepare(`

        UPDATE user_stats

        SET

            giveawaysWon =
                giveawaysWon + 1,

            totalPrize =
                totalPrize + ?,

            pendingAmount =
                pendingAmount + ?,

            updatedAt = ?

        WHERE discordId = ?

    `).run(

        amount,

        amount,

        now,

        data.discordId
    );

    return getPrize(
        data.giveawayId,
        data.discordId
    );
}

function getPrize(
    giveawayId,
    discordId
) {

    return db.prepare(`

        SELECT *

        FROM prize_ledger

        WHERE giveawayId = ?

        AND discordId = ?

        LIMIT 1

    `).get(
        giveawayId,
        discordId
    );
}

function getPrizeById(
    id
) {

    return db.prepare(`

        SELECT *

        FROM prize_ledger

        WHERE id = ?

        LIMIT 1

    `).get(id);
}

function getPendingPrizes(
    discordId
) {

    return db.prepare(`

        SELECT *

        FROM prize_ledger

        WHERE discordId = ?

        AND status = 'pending'

        ORDER BY createdAt DESC

    `).all(discordId);
}

function getUserPrizes(
    discordId
) {

    return db.prepare(`

        SELECT *

        FROM prize_ledger

        WHERE discordId = ?

        ORDER BY createdAt DESC

    `).all(discordId);
}

function markPrizePaid(
    giveawayId,
    discordId,
    paidBy,
    ticketId
) {

    const prize =
        getPrize(
            giveawayId,
            discordId
        );

    if (!prize) {

        throw new Error(
            "PRIZE_NOT_FOUND"
        );
    }

    if (
        prize.status ===
        "paid"
    ) {

        return prize;
    }

    if (
        prize.status !==
        "pending"
    ) {

        throw new Error(
            "PRIZE_NOT_PENDING"
        );
    }

    const now =
        Date.now();

    const transaction =
        db.transaction(() => {

            db.prepare(`

                UPDATE prize_ledger

                SET

                    status = 'paid',

                    paidBy = ?,

                    paidAt = ?,

                    ticketId =
                        COALESCE(?, ticketId)

                WHERE giveawayId = ?

                AND discordId = ?

            `).run(

                paidBy ||
                    null,

                now,

                ticketId ||
                    null,

                giveawayId,

                discordId
            );

            ensureUserStats(
                discordId
            );

            db.prepare(`

                UPDATE user_stats

                SET

                    totalPaid =
                        totalPaid + ?,

                    pendingAmount =
                        MAX(
                            0,
                            pendingAmount - ?
                        ),

                    updatedAt = ?

                WHERE discordId = ?

            `).run(

                prize.amount,

                prize.amount,

                now,

                discordId
            );
        });

    transaction();

    return getPrize(
        giveawayId,
        discordId
    );
}

function markPrizeUnpaid(
    giveawayId,
    discordId
) {

    const prize =
        getPrize(
            giveawayId,
            discordId
        );

    if (!prize) {

        throw new Error(
            "PRIZE_NOT_FOUND"
        );
    }

    if (
        prize.status ===
        "pending"
    ) {

        return prize;
    }

    if (
        prize.status !==
        "paid"
    ) {

        throw new Error(
            "INVALID_PRIZE_STATUS"
        );
    }

    const now =
        Date.now();

    const transaction =
        db.transaction(() => {

            db.prepare(`

                UPDATE prize_ledger

                SET

                    status = 'pending',

                    paidBy = NULL,

                    paidAt = NULL

                WHERE giveawayId = ?

                AND discordId = ?

            `).run(

                giveawayId,

                discordId
            );

            ensureUserStats(
                discordId
            );

            db.prepare(`

                UPDATE user_stats

                SET

                    totalPaid =
                        MAX(
                            0,
                            totalPaid - ?
                        ),

                    pendingAmount =
                        pendingAmount + ?,

                    updatedAt = ?

                WHERE discordId = ?

            `).run(

                prize.amount,

                prize.amount,

                now,

                discordId
            );
        });

    transaction();

    return getPrize(
        giveawayId,
        discordId
    );
}

// =====================================================
// PRIZE HELPERS
// =====================================================

function getPendingAmount(
    discordId
) {

    const stats =
        getUserStats(
            discordId
        );

    return stats
        ? stats.pendingAmount
        : 0;
}

function getTotalPrize(
    discordId
) {

    const stats =
        getUserStats(
            discordId
        );

    return stats
        ? stats.totalPrize
        : 0;
}

function getTotalPaid(
    discordId
) {

    const stats =
        getUserStats(
            discordId
        );

    return stats
        ? stats.totalPaid
        : 0;
}

function getGiveawaysWon(
    discordId
) {

    const stats =
        getUserStats(
            discordId
        );

    return stats
        ? stats.giveawaysWon
        : 0;
}

// =====================================================
// GIVEAWAY WINNER + PRIZE
// =====================================================

function createWinnerAndPrize(
    data
) {

    const transaction =
        db.transaction(() => {

            addWinner({
                giveawayId:
                    data.giveawayId,

                discordId:
                    data.discordId,

                discordTag:
                    data.discordTag,

                robloxUsername:
                    data.robloxUsername
            });

            createPrize({
                giveawayId:
                    data.giveawayId,

                discordId:
                    data.discordId,

                robloxUserId:
                    data.robloxUserId,

                robloxUsername:
                    data.robloxUsername,

                amount:
                    data.amount,

                ticketId:
                    data.ticketId
            });
        });

    transaction();

    return {
        winner:
            getWinner(
                data.giveawayId,
                data.discordId
            ),

        prize:
            getPrize(
                data.giveawayId,
                data.discordId
            )
    };
}

// =====================================================
// ROBLOX ACCOUNT LOOKUP
// =====================================================

function isRobloxAccountLinked(
    robloxUserId,
    exceptDiscordId = null
) {

    let query = `

        SELECT *

        FROM verified_users

        WHERE robloxUserId = ?

    `;

    const params = [
        String(robloxUserId)
    ];

    if (exceptDiscordId) {

        query += `
            AND discordId != ?
        `;

        params.push(
            exceptDiscordId
        );
    }

    query += `
        LIMIT 1
    `;

    return db
        .prepare(query)
        .get(...params);
}

// =====================================================
// CLEANUP
// =====================================================

function cleanupExpiredVerificationCodes() {

    const result =
        db.prepare(`

            DELETE FROM verified_users

            WHERE verifiedAt = 0

            AND verificationCodeExpiresAt IS NOT NULL

            AND verificationCodeExpiresAt <= ?

        `).run(
            Date.now()
        );

    return result.changes;
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
    getWinner,

    // Verification
    getVerifiedUser,
    getVerifiedUserByRobloxId,
    isVerified,
    saveVerification,
    createVerificationCode,
    getPendingVerification,
    clearVerificationCode,
    recordVerificationAttempt,
    getVerificationAttempts,
    deletePendingVerification,
    isRobloxAccountLinked,
    cleanupExpiredVerificationCodes,

    // Stats
    ensureUserStats,
    getUserStats,
    updateUserStats,
    getGiveawaysWon,
    getTotalPrize,
    getTotalPaid,
    getPendingAmount,

    // Prize ledger
    createPrize,
    getPrize,
    getPrizeById,
    getPendingPrizes,
    getUserPrizes,
    markPrizePaid,
    markPrizeUnpaid,

    // Winner + prize
    createWinnerAndPrize
};
