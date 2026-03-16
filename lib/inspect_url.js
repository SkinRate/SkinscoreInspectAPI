const utils = require('./utils');

class InspectURL {
  constructor() {
    this.requiredParams = ['s', 'a', 'd', 'm'];

    if (arguments.length === 1 && typeof arguments[0] === 'string') {
      // Parse a full steam:// link
      this.parseLink(arguments[0]);
    } else if (arguments.length === 1 && typeof arguments[0] === 'object' && arguments[0] !== null) {
      // Parse from object with s/a/d/m (coerce to strings)
      for (const param of this.requiredParams) {
        const raw = arguments[0][param];
        const val = (raw === undefined || raw === null) ? '' : String(raw).trim();
        this[param] = val.length > 0 ? val : '0';
      }
    } else if (arguments.length === 4) {
      // Parse positional args (s, a, d, m) – coerce to strings in correct order
      this.requiredParams.forEach((key, i) => {
        const raw = arguments[i];
        const val = (raw === undefined || raw === null) ? '' : String(raw).trim();
        this[key] = val.length > 0 ? val : '0';
      });
    }

    // Normalize: ensure only digits are stored (don’t cast to Number!)
    for (const p of this.requiredParams) {
      if (typeof this[p] === 'string') {
        this[p] = this[p].replace(/\D/g, '');
        if (this[p].length === 0) this[p] = '0';
      } else {
        this[p] = '0';
      }
    }
  }

  get valid() {
    // Masked (new format) links are valid if they have a non-empty hex string
    if (this.masked) return typeof this.hex === 'string' && /^[0-9A-Fa-f]+$/.test(this.hex);

    // Legacy format: ensure each param exists and only contains digits
    for (const param of this.requiredParams) {
      if (!this[param] || !utils.isOnlyDigits(this[param])) return false;
    }
    // At least one of S or M must be non-zero
    if (this.s === '0' && this.m === '0') return false;
    return true;
  }

  parseLink(link) {
    try {
      link = decodeURI(link);
    } catch {
      return;
    }

    // New masked format: steam://run/730//+csgo_econ_action_preview HEX
    const maskedRe = /^steam:\/\/run\/730\/\/[+ ]csgo_econ_action_preview ([0-9A-Fa-f]+)$/;
    const maskedGroups = maskedRe.exec(link);
    if (maskedGroups) {
      this.masked = true;
      this.hex = maskedGroups[1];
      return;
    }

    // Legacy format: steam://rungame/730/{id}/+csgo_econ_action_preview S{s}A{a}D{d}
    const re = /^steam:\/\/rungame\/730\/\d+\/[+ ]csgo_econ_action_preview ([SM])(\d+)A(\d+)D(\d+)$/;
    const groups = re.exec(link);

    if (groups) {
      const marker = groups[1];   // 'S' or 'M'
      const markerVal = groups[2];
      const a = groups[3];
      const d = groups[4];

      if (marker === 'S') {
        this.s = markerVal;
        this.m = '0';
      } else {
        this.m = markerVal;
        this.s = '0';
      }
      this.a = a;
      this.d = d;
    }
  }

  getParams() {
    if (!this.valid) return;
    if (this.masked) return { masked: true, hex: this.hex, a: this.hex };
    return { s: this.s, a: this.a, d: this.d, m: this.m };
  }

  isMarketLink() {
    return this.valid && this.m !== '0';
  }

  getLink() {
    if (!this.valid) return;

    // Emit M* if market (m != '0'), else S*
    if (this.m !== '0') {
      return `steam://rungame/730/76561202255233023/+csgo_econ_action_preview M${this.m}A${this.a}D${this.d}`;
    } else {
      return `steam://rungame/730/76561202255233023/+csgo_econ_action_preview S${this.s}A${this.a}D${this.d}`;
    }
  }
}

module.exports = InspectURL;
