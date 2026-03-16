const Schema = require('globaloffensive/protobufs/generated/cstrike15_gcmessages');

const STEAMID64_BASE = BigInt('76561197960265728');

/**
 * Decodes a masked CS2 inspect link hex string into item info.
 *
 * Format:
 *   - XOR every byte with buffer[0] (the key)
 *   - After XOR, byte[0] should be 0x00
 *   - Strip byte[0] and trailing 4 checksum bytes
 *   - Remaining bytes are a protobuf-encoded CEconItemPreviewDataBlock
 *
 * @param {string} hex - Hex string from the new steam://run/730// inspect link
 * @returns {object|null} Item info in standard API format, or null on failure
 */
function decodeMaskedHex(hex) {
    try {
        const buffer = Buffer.from(hex, 'hex');
        if (buffer.length < 6) return null;

        const key = buffer[0];
        const unmasked = Buffer.from(buffer.map(b => b ^ key));

        if (unmasked[0] !== 0x00) return null;

        // Strip leading null byte and trailing 4-byte checksum
        const payload = unmasked.slice(1, -4);
        if (payload.length === 0) return null;

        const decoded = Schema.CEconItemPreviewDataBlock.decode(payload);

        // Convert paintwear uint32 bit pattern to JS float (matches globaloffensive/handlers.js)
        const paintwearBuf = Buffer.allocUnsafe(4);
        paintwearBuf.writeUInt32BE(decoded.paintwear || 0, 0);
        const floatvalue = paintwearBuf.readFloatBE(0);

        // Reconstruct SteamID64 from accountid (uint32 → SteamID64)
        const s = decoded.accountid
            ? (STEAMID64_BASE + BigInt(decoded.accountid)).toString()
            : '0';

        // itemid (uint64) → string
        const a = decoded.itemid ? decoded.itemid.toString() : '0';

        // Map stickers to match existing GC response format (sticker_id → stickerId)
        const stickers = (decoded.stickers || []).map(st => ({
            stickerId: st.sticker_id,
            slot: st.slot,
            wear: st.wear,
            scale: st.scale,
            rotation: st.rotation,
            offset_x: st.offset_x,
            offset_y: st.offset_y,
        }));

        // Map keychains (same sticker sub-message, keep sticker_id field name)
        const keychains = (decoded.keychains || []).map(k => ({
            sticker_id: k.sticker_id,
            slot: k.slot,
            wear: k.wear,
            scale: k.scale,
            rotation: k.rotation,
            tint_id: k.tint_id,
            offset_x: k.offset_x,
            offset_y: k.offset_y,
            offset_z: k.offset_z,
            pattern: k.pattern,
        }));

        return {
            s,
            a,
            d: '0',
            m: '0',
            floatvalue,
            paintseed: decoded.paintseed || 0,
            defindex: decoded.defindex || 0,
            paintindex: decoded.paintindex || 0,
            rarity: decoded.rarity || 0,
            quality: decoded.quality || 0,
            origin: decoded.origin || 0,
            // killeaterscoretype > 0 means this is a StatTrak item (1 = kills, etc.)
            // Non-StatTrak items have this field absent; proto3 returns 0 for absent uint32.
            // Gate killeatervalue on killeaterscoretype to avoid false StatTrak detection.
            killeaterscoretype: decoded.killeaterscoretype || undefined,
            killeatervalue: decoded.killeaterscoretype
                ? (decoded.killeatervalue != null ? decoded.killeatervalue : 0)
                : null,
            customname: decoded.customname || undefined,
            stickers,
            keychains,
        };
    } catch (e) {
        return null;
    }
}

module.exports = { decodeMaskedHex };
