const Database = require("better-sqlite3");

const db = new Database("giveaways.db");

db.pragma("journal_mode = WAL");

db.exec(`
    CREATE TABLE IF NOT EXISTS giveaways (
        id TEXT PRIMARY KEY,
        guildId TEXT NOT NULL,
        channelId TEXT NOT NULL,
        messageId TEXT,
        robux INTEGER NOT NULL,
        winners INTEGER NOT NULL,
        endTime INTEGER NOT NULL,
        ended INTEGER DEFAULT 0
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


// ==========================================
// Giveaway Configuration
// ==========================================

function setGiveawayConfig(guildId, staffRoleId) {

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


function getGiveawayConfig(guildId) {

    return db.prepare(`
        SELECT *
        FROM giveaway_configs
        WHERE guildId = ?
    `).get(guildId);
}


// ==========================================
// Giveaway Functions
// ==========================================

function createGiveaway(data) {

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
            ended
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `);

    stmt.run(
        data.id,
        data.guildId,
        data.channelId,
        data.messageId || null,
        data.robux,
        data.winners,
        data.endTime
    );
}


// ==========================================
// Update Message ID
// ==========================================

function updateMessageId(id, messageId) {

    db.prepare(`
        UPDATE giveaways
        SET messageId = ?
        WHERE id = ?
    `).run(
        messageId,
        id
    );
}


// ==========================================
// Add Participant
// ==========================================

function addParticipant(data) {

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


// ==========================================
// Get Participants
// ==========================================

function getParticipants(giveawayId) {

    return db.prepare(`
        SELECT
            discordId,
            discordTag,
            robloxUsername
        FROM participants
        WHERE giveawayId = ?
    `).all(giveawayId);
}


// ==========================================
// Get Giveaway
// ==========================================

function getGiveaway(id) {

    return db.prepare(`
        SELECT *
        FROM giveaways
        WHERE id = ?
    `).get(id);
}


// ==========================================
// Get Active Giveaways
// ==========================================

function getActiveGiveaways() {

    return db.prepare(`
        SELECT *
        FROM giveaways
        WHERE ended = 0
    `).all();
}


// ==========================================
// End Giveaway
// ==========================================

function endGiveaway(id) {

    db.prepare(`
        UPDATE giveaways
        SET ended = 1
        WHERE id = ?
    `).run(id);
}


// ==========================================
// Save Winner
// ==========================================

function addWinner(data) {

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


// ==========================================
// Get Winners
// ==========================================

function getWinners(giveawayId) {

    return db.prepare(`
        SELECT
            discordId,
            discordTag,
            robloxUsername
        FROM giveaway_winners
        WHERE giveawayId = ?
    `).all(giveawayId);
}


// ==========================================
// Export
// ==========================================

module.exports = {

    // Giveaway configuration
    setGiveawayConfig,
    getGiveawayConfig,

    // Giveaway
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