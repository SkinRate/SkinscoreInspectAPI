const fs = require('fs'),
  winston = require('winston'),
  vdf = require('simple-vdf'),
  utils = require('./utils');

const IMAGE_TRACKER_BASE = 'https://i.skinscore.app/panorama/images/econ';

const IMAGE_TRACKER_REPO =
  'https://github.com/ByMykel/counter-strike-image-tracker';

function pickFirstString(...vals) {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return null;
}

function pickFirstNumber(...vals) {
  for (const v of vals) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim().length > 0) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/**
 * Build a ByMykel image URL for weapons/skins (default_generated) or base weapons.
 */
function buildImageTrackerWeaponUrl(weaponToken, paintkitToken) {
  if (!weaponToken) return null;
  if (paintkitToken && paintkitToken !== 'default') {
    return `${IMAGE_TRACKER_BASE}/default_generated/${weaponToken}_${paintkitToken}_light_png.png`;
  }
  return `${IMAGE_TRACKER_BASE}/weapons/base_weapons/${weaponToken}_png.png`;
}

/**
 * Stickers live under: /stickers/<major-or-folder>/<material>_png.png
 */
function buildImageTrackerStickerUrl(materialPath) {
  if (!materialPath) return null;
  return `${IMAGE_TRACKER_BASE}/stickers/${materialPath}_png.png`;
}

/**
 * Agents: stored under /characters/<characterToken>_png.png
 */
function buildImageTrackerAgentUrl(characterToken) {
  if (!characterToken) return null;
  return `${IMAGE_TRACKER_BASE}/characters/${characterToken}_png.png`;
}

/**
 * Charms/Keychains:
 * image_inventory example: "econ/keychains/missinglink/kc_missinglink_ava"
 * Final: https://i.skinscore.app/panorama/images/econ/keychains/missinglink/kc_missinglink_ava_png.png
 */
function buildImageTrackerKeychainUrl(imageInventoryPath) {
  if (!imageInventoryPath) return null;

  let p = String(imageInventoryPath).trim();

  const idx = p.indexOf('econ/');
  if (idx >= 0) p = p.slice(idx);

  p = p.replace(/^econ\//, '');
  p = p.replace(/^\/+/, '');

  p = p.replace(/(_png)?\.png$/i, '');
  if (p.endsWith('_png')) p = p.slice(0, -4);

  return `${IMAGE_TRACKER_BASE}/${p}_png.png`;
}

const floatNames = [
  { range: [0, 0.07], name: 'SFUI_InvTooltip_Wear_Amount_0' },
  { range: [0.07, 0.15], name: 'SFUI_InvTooltip_Wear_Amount_1' },
  { range: [0.15, 0.38], name: 'SFUI_InvTooltip_Wear_Amount_2' },
  { range: [0.38, 0.45], name: 'SFUI_InvTooltip_Wear_Amount_3' },
  { range: [0.45, 1.0], name: 'SFUI_InvTooltip_Wear_Amount_4' }
];

const LanguageHandler = {
  get: function (obj, prop) {
    return obj[prop.toLowerCase()];
  },
  has: function (obj, prop) {
    return prop.toLowerCase() in obj;
  }
};

class GameData {
  constructor(update_interval, enable_update) {
    this.items_game_url =
      'https://raw.githubusercontent.com/SteamDatabase/GameTracking-CS2/master/game/csgo/pak01_dir/scripts/items/items_game.txt';
    this.csgo_english_url =
      'https://raw.githubusercontent.com/SteamDatabase/GameTracking-CS2/master/game/csgo/pak01_dir/resource/csgo_english.txt';
    this.schema_url =
      'https://raw.githubusercontent.com/SteamDatabase/SteamTracking/b5cba7a22ab899d6d423380cff21cec707b7c947/ItemSchema/CounterStrikeGlobalOffensive.json';

    this.items_game = false;
    this.csgo_english = false;
    this.schema = false;

    if (!utils.isValidDir('game_files')) {
      winston.info('Creating game files directory');
      fs.mkdirSync('game_files');
    } else {
      this.loadFiles();
    }

    if (enable_update) {
      this.update();

      if (update_interval && update_interval > 0)
        setInterval(() => {
          this.update();
        }, update_interval * 1000);
    }
  }

  loadFiles() {
    if (fs.existsSync('game_files/items_game.txt')) {
      this.items_game = vdf.parse(
        fs.readFileSync('game_files/items_game.txt', 'utf8')
      )['items_game'];
    }

    if (fs.existsSync('game_files/csgo_english.txt')) {
      const f = fs.readFileSync('game_files/csgo_english.txt', 'utf8');
      this.csgo_english = this.objectKeysToLowerCase(
        vdf.parse(f)['lang']['Tokens']
      );
      this.csgo_english = new Proxy(this.csgo_english, LanguageHandler);
    }

    if (fs.existsSync('game_files/schema.json')) {
      let data = fs.readFileSync('game_files/schema.json', 'utf8');
      this.schema = JSON.parse(data)['result'];
    }
  }

  objectKeysToLowerCase(obj) {
    const keys = Object.keys(obj);
    let n = keys.length;
    while (n--) {
      const key = keys[n];
      const lower = key.toLowerCase();
      if (key !== lower) {
        obj[lower] = obj[key];
        delete obj[key];
      }
    }

    return obj;
  }

  update() {
    winston.info('Updating Game Files...');

    utils.downloadFile(this.items_game_url, (data) => {
      if (data) {
        winston.debug('Fetched items_game.txt');
        this.items_game = vdf.parse(data)['items_game'];
        fs.writeFileSync('game_files/items_game.txt', data, 'utf8');
      } else winston.error('Failed to fetch items_game.txt');
    });

    utils.downloadFile(this.csgo_english_url, (data) => {
      if (data) {
        winston.debug('Fetched csgo_english.txt');
        this.csgo_english = this.objectKeysToLowerCase(
          vdf.parse(data)['lang']['Tokens']
        );
        this.csgo_english = new Proxy(this.csgo_english, LanguageHandler);

        fs.writeFileSync('game_files/csgo_english.txt', data, 'utf8');
      } else winston.error('Failed to fetch csgo_english.txt');
    });

    utils.downloadFile(this.schema_url, (data) => {
      if (data) {
        winston.debug('Fetched schema.json');
        this.schema = JSON.parse(data)['result'];
        fs.writeFileSync('game_files/schema.json', data, 'utf8');
      } else winston.error('Failed to fetch schema.json');
    });
  }

  addAdditionalItemProperties(iteminfo) {
    if (!this.items_game || !this.csgo_english) return;

    const stickerKits = this.items_game.sticker_kits;

    for (const sticker of iteminfo.stickers || []) {
      const kit = stickerKits[sticker.stickerId];
      if (!kit) continue;

      sticker.codename = kit.name;
      sticker.material = kit.sticker_material;

      let name = this.csgo_english[kit.item_name.replace('#', '')];

      if (sticker.tintId) {
        name += ` (${this.csgo_english[`Attrib_SprayTintValue_${sticker.tintId}`]})`;
      }

      if (name) sticker.name = name;

      if (sticker.material) {
        const stickerUrl = buildImageTrackerStickerUrl(sticker.material);
        if (stickerUrl) {
          sticker.imageurl = stickerUrl;
          sticker.image_repo = IMAGE_TRACKER_REPO;
        }
      }
    }

    // Keychains/Charms
    const keychainDefinitions = this.items_game.keychain_definitions;
    for (const keychain of iteminfo.keychains || []) {
      const keychainId = pickFirstNumber(
        keychain.sticker_id,
        keychain.stickerId,
        keychain.keychain_id,
        keychain.keychainId
      );

      if (keychainId == null) continue;

      const kit = keychainDefinitions[keychainId];
      if (!kit) continue;

      const locName = kit.loc_name ? kit.loc_name.replace('#', '') : null;
      const name = locName ? this.csgo_english[locName] : null;
      if (name) keychain.name = name;

      const invPath = pickFirstString(
        kit.image_inventory,
        kit.imageInventory,
        kit.inventory_image,
        kit.inventoryImage,
        kit.image
      );

      const keychainUrl = buildImageTrackerKeychainUrl(invPath);
      if (keychainUrl) {
        keychain.imageurl = keychainUrl;
        keychain.image_repo = IMAGE_TRACKER_REPO;
      }
    }

    // Weapon/character token
    let weapon_name;
    if (iteminfo.defindex in this.items_game['items']) {
      weapon_name = this.items_game['items'][iteminfo.defindex]['name'];
    }

    const paintkit =
      iteminfo.paintindex in this.items_game['paint_kits']
        ? this.items_game['paint_kits'][iteminfo.paintindex]
        : null;

    const paintkitToken = paintkit ? paintkit.name : null;
    const weaponToken = weapon_name || null;

    const looksLikeAgentToken =
      typeof weaponToken === 'string' && weaponToken.startsWith('customplayer_');

    if (looksLikeAgentToken || iteminfo.weapon_type === 'Agent') {
      const agentUrl = buildImageTrackerAgentUrl(weaponToken);
      if (agentUrl) {
        iteminfo.imageurl = agentUrl;
        iteminfo.image_repo = IMAGE_TRACKER_REPO;
      }
    } else if (
      iteminfo.weapon_type === 'Sticker' &&
      Array.isArray(iteminfo.stickers) &&
      iteminfo.stickers[0]
    ) {
      const mat = iteminfo.stickers[0].material;
      const stickerUrl = buildImageTrackerStickerUrl(mat);
      if (stickerUrl) {
        iteminfo.imageurl = stickerUrl;
        iteminfo.image_repo = IMAGE_TRACKER_REPO;
      }
    } else if (
      iteminfo.weapon_type === 'Charm' &&
      Array.isArray(iteminfo.keychains) &&
      iteminfo.keychains[0]
    ) {
      const kc = iteminfo.keychains[0];
      const kcUrl = pickFirstString(kc.imageurl, kc.imageUrl);
      if (kcUrl) {
        iteminfo.imageurl = kcUrl;
        iteminfo.image_repo = IMAGE_TRACKER_REPO;
      }
    } else {
      const url = buildImageTrackerWeaponUrl(weaponToken, paintkitToken);
      if (url) {
        iteminfo.imageurl = url;
        iteminfo.image_repo = IMAGE_TRACKER_REPO;
      }
    }

    // Agent patches name prefix
    if (looksLikeAgentToken && Array.isArray(iteminfo.stickers)) {
      for (const s of iteminfo.stickers) {
        if (s && typeof s.name === 'string' && s.name.length > 0) {
          if (!/^Patch\s*\|/i.test(s.name)) {
            s.name = `Patch | ${s.name}`;
          }
        }
      }
    }

    // Paint data + code name
    let code_name;
    let paint_data;

    if (iteminfo.paintindex in this.items_game['paint_kits']) {
      code_name = this.items_game['paint_kits'][iteminfo.paintindex]['description_tag'].replace('#', '');
      paint_data = this.items_game['paint_kits'][iteminfo.paintindex];
    }

    if (paint_data && 'wear_remap_min' in paint_data) {
      iteminfo['min'] = parseFloat(paint_data['wear_remap_min']);
    } else iteminfo['min'] = 0.06;

    if (paint_data && 'wear_remap_max' in paint_data) {
      iteminfo['max'] = parseFloat(paint_data['wear_remap_max']);
    } else iteminfo['max'] = 0.8;

    let weapon_data = '';
    if (iteminfo.defindex in this.items_game['items']) {
      weapon_data = this.items_game['items'][iteminfo.defindex];
    }

    let weapon_hud;
    if (weapon_data !== '' && 'item_name' in weapon_data) {
      weapon_hud = weapon_data['item_name'].replace('#', '');
    } else {
      if (iteminfo.defindex in this.items_game['items']) {
        let prefab_val = this.items_game['items'][iteminfo.defindex]['prefab'];
        weapon_hud = this.items_game['prefabs'][prefab_val]['item_name'].replace('#', '');
      }
    }

    if (weapon_hud in this.csgo_english) {
      iteminfo['weapon_type'] = this.csgo_english[weapon_hud];
    }
    if (code_name && code_name in this.csgo_english) {
      iteminfo['item_name'] = this.csgo_english[code_name];
    }

    const rarityKey = Object.keys(this.items_game['rarities']).find((key) => {
      return parseInt(this.items_game['rarities'][key]['value']) === iteminfo.rarity;
    });

    if (rarityKey) {
      const rarity = this.items_game['rarities'][rarityKey];
      iteminfo['rarity_name'] =
        this.csgo_english[rarity[iteminfo.floatvalue > 0 ? 'loc_key_weapon' : 'loc_key']];
    }

    const qualityKey = Object.keys(this.items_game['qualities']).find((key) => {
      return parseInt(this.items_game['qualities'][key]['value']) === iteminfo.quality;
    });
    iteminfo['quality_name'] = this.csgo_english[qualityKey];

    const origin = this.schema['originNames'].find((o) => o.origin === iteminfo.origin);
    if (origin) {
      iteminfo['origin_name'] = origin['name'];
    }

    const wearName = this.getWearName(iteminfo.floatvalue);
    if (wearName) {
      iteminfo['wear_name'] = wearName;
    }

    const itemName = this.getFullItemName(iteminfo);
    if (itemName) {
      iteminfo['full_item_name'] = itemName;
    }
  }

  getWearName(float) {
    const f = floatNames.find((f) => float > f.range[0] && float <= f.range[1]);
    if (f) {
      return this.csgo_english[f['name']];
    }
  }

  getFullItemName(iteminfo) {
    let name = '';

    if (iteminfo.quality !== 4) {
      name += `${iteminfo.quality_name} `;
    }

    if (iteminfo.killeatervalue !== null && iteminfo.quality !== 9) {
      name += `${this.csgo_english['strange']} `;
    }

    name += `${iteminfo.weapon_type} `;

    if (iteminfo.weapon_type === 'Sticker' || iteminfo.weapon_type === 'Sealed Graffiti') {
      name += `| ${iteminfo.stickers[0].name}`;
    } else if (iteminfo.weapon_type === 'Charm') {
      name += `| ${iteminfo.keychains[0].name}`;
    }

    if (iteminfo.item_name && iteminfo.item_name !== '-') {
      name += `| ${iteminfo.item_name} `;

      if (iteminfo.wear_name) {
        name += `(${iteminfo.wear_name})`;
      }
    }

    return name.trim();
  }
}

module.exports = GameData;
