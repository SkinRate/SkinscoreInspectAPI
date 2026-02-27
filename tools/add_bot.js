#!/usr/bin/env node
// add_bot.js — Onboard a new Steam bot account
// Handles: login, 2FA setup (shared_secret) via steamcommunity, CS2 license, save to bots.json
//
// Usage: node tools/add_bot.js
//   or:  node tools/add_bot.js --user skinscorebot10 --pass "mypassword"

const SteamCommunity = require('steamcommunity');
const SteamUser = require('steam-user');
const SteamTotp = require('steam-totp');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

const EResult = SteamCommunity.EResult;
const secretsDir = path.join(__dirname, 'secrets');
const botsFile = process.env.BOTS_FILE || path.join(__dirname, '..', 'config', 'bots.json');

if (!fs.existsSync(secretsDir)) {
    fs.mkdirSync(secretsDir, { recursive: true });
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
    return new Promise(resolve => rl.question(question, resolve));
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function loadBots() {
    if (fs.existsSync(botsFile)) {
        return JSON.parse(fs.readFileSync(botsFile, 'utf8'));
    }
    return [];
}

function saveBots(bots) {
    const dir = path.dirname(botsFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(botsFile, JSON.stringify(bots, null, 4));
}

// Login via steamcommunity (handles email guard, gets mobile app access token for 2FA)
function communityLogin(community, username, password) {
    return new Promise((resolve, reject) => {
        function attemptLogin(authCode) {
            community.login({
                accountName: username,
                password: password,
                authCode: authCode,
                disableMobile: false
            }, async (err, sessionID, cookies, steamguard) => {
                if (err && err.message === 'SteamGuard') {
                    console.log(`  [EMAIL] Steam sent an auth code to your email.`);
                    const code = await ask(`  Enter email auth code for ${username}: `);
                    attemptLogin(code.trim());
                    return;
                }
                if (err) return reject(err);
                resolve({ sessionID, cookies, steamguard });
            });
        }
        attemptLogin(null);
    });
}

// Request CS2 license via steam-user (needs TOTP if 2FA is set up)
async function requestCS2License(username, password, sharedSecret) {
    return new Promise((resolve) => {
        const client = new SteamUser({ promptSteamGuardCode: false });

        const timeout = setTimeout(() => {
            console.log(`  [WARN] CS2 license request timed out.`);
            try { client.logOff(); } catch (e) {}
            resolve();
        }, 30000);

        // Auto-provide TOTP code when Steam asks for it
        client.on('steamGuard', (domain, callback) => {
            if (sharedSecret) {
                callback(SteamTotp.getAuthCode(sharedSecret));
            } else {
                clearTimeout(timeout);
                console.log(`  [WARN] CS2 license step needs auth code, skipping.`);
                try { client.logOff(); } catch (e) {}
                resolve();
            }
        });

        client.on('loggedOn', () => {
            client.requestFreeLicense([730], (err, grantedPackages) => {
                clearTimeout(timeout);
                if (err) {
                    console.log(`  [WARN] Free license request error:`, err.message);
                } else if (grantedPackages && grantedPackages.length > 0) {
                    console.log(`  [OK] CS2 license granted.`);
                } else {
                    console.log(`  [OK] Already owns CS2.`);
                }
                try { client.logOff(); } catch (e) {}
                resolve();
            });
        });

        client.on('error', (err) => {
            clearTimeout(timeout);
            console.log(`  [WARN] CS2 license login error:`, err.message);
            resolve();
        });

        client.logOn({ accountName: username, password: password });
    });
}

async function onboardBot(username, password) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`  Onboarding: ${username}`);
    console.log('='.repeat(50));

    // Check if already in bots.json with shared_secret
    const bots = loadBots();
    const existing = bots.find(b => b.user === username);
    if (existing && existing.auth && existing.auth.length > 5) {
        console.log(`  [SKIP] ${username} already has a shared_secret in bots.json.`);
        return null;
    }

    try {
        // Step 1: Login via steamcommunity
        const community = new SteamCommunity();
        console.log(`  Logging in via steamcommunity...`);
        await communityLogin(community, username, password);
        console.log(`  [OK] ${username} logged in.`);

        // Step 2: Enable 2FA via steamcommunity (uses official mobile app method)
        console.log(`  Enabling mobile authenticator...`);
        const response = await new Promise((resolve, reject) => {
            community.enableTwoFactor((err, response) => {
                if (err) {
                    if (err.eresult === EResult.Fail) {
                        return reject(new Error('Failed to enable 2FA. Does this account have a phone number or email attached?'));
                    }
                    if (err.eresult === EResult.RateLimitExceeded) {
                        return reject(new Error('Rate limited by Steam. Try again later.'));
                    }
                    return reject(err);
                }
                resolve(response);
            });
        });

        if (response.status !== EResult.OK) {
            console.log(`  [ERROR] enableTwoFactor returned status ${response.status}`);
            return null;
        }

        // Step 3: Save secrets immediately
        const sharedSecretBase64 = response.shared_secret.toString('base64');
        const secrets = {
            account_name: username,
            shared_secret: sharedSecretBase64,
            revocation_code: response.revocation_code,
            identity_secret: response.identity_secret.toString('base64'),
            serial_number: response.serial_number,
            server_time: response.server_time,
            uri: response.uri,
            created_at: new Date().toISOString()
        };

        const secretsFile = path.join(secretsDir, `${username}.json`);
        fs.writeFileSync(secretsFile, JSON.stringify(secrets, null, 2));
        console.log(`  [SAVED] Secrets + revocation code saved to: ${secretsFile}`);

        // Step 4: Finalize with activation code
        if (response.phone_number_hint) {
            console.log(`  Activation code sent to phone ending in ${response.phone_number_hint}.`);
        } else {
            console.log(`  Activation code sent to your email.`);
        }
        const activationCode = await ask(`  Enter activation code: `);

        await new Promise((resolve, reject) => {
            community.finalizeTwoFactor(response.shared_secret, activationCode.trim(), (err) => {
                if (err) return reject(err);
                resolve();
            });
        });

        console.log(`  [SUCCESS] ${username} 2FA is set up!`);

        // Verify TOTP
        const testCode = SteamTotp.getAuthCode(sharedSecretBase64);
        console.log(`  [VERIFY] Generated test TOTP code: ${testCode}`);

        // Step 5: Request CS2 license via steam-user (with TOTP)
        console.log(`  Requesting CS2 license...`);
        await requestCS2License(username, password, sharedSecretBase64);

        return { user: username, pass: password, auth: sharedSecretBase64 };

    } catch (err) {
        console.error(`  [ERROR] Onboarding failed for ${username}:`, err.message);
        return null;
    }
}

async function main() {
    console.log('\n  Skinscore Bot Onboarding Tool');
    console.log('  ============================\n');
    console.log(`  Bots file: ${botsFile}\n`);

    // Get credentials from args or prompt
    let username = null, password = null;

    const userIdx = process.argv.indexOf('--user');
    const passIdx = process.argv.indexOf('--pass');
    if (userIdx !== -1 && process.argv[userIdx + 1]) username = process.argv[userIdx + 1];
    if (passIdx !== -1 && process.argv[passIdx + 1]) password = process.argv[passIdx + 1];

    // Interactive: ask how many bots to add
    if (!username) {
        const mode = await ask('  Add (s)ingle bot or (b)atch? ');

        if (mode.trim().toLowerCase() === 'b') {
            // Batch mode: generate names from a range
            const prefix = await ask('  Bot name prefix (e.g. "skinscorebot"): ');
            const startNum = parseInt(await ask('  Start number (e.g. 0): '));
            const endNum = parseInt(await ask('  End number (e.g. 19): '));

            const bots = loadBots();
            let added = 0;

            for (let i = startNum; i <= endNum; i++) {
                const botName = prefix.trim() + String(i).padStart(2, '0');
                console.log(`\n--- Bot ${i - startNum + 1} of ${endNum - startNum + 1} ---`);

                // Use password from bots.json if it exists, otherwise prompt
                const existing = bots.find(b => b.user === botName);
                let botPass;
                if (existing && existing.pass) {
                    botPass = existing.pass;
                } else {
                    botPass = await ask(`  Password for ${botName}: `);
                    botPass = botPass.trim();
                }

                const result = await onboardBot(botName, botPass);
                if (result) {
                    const idx = bots.findIndex(b => b.user === result.user);
                    if (idx !== -1) {
                        bots[idx] = result;
                    } else {
                        bots.push(result);
                    }
                    saveBots(bots);
                    added++;
                    console.log(`  [SAVED] ${result.user} added to bots.json (${bots.length} total)`);
                }

                // Wait between bots
                if (i < endNum) {
                    console.log(`  Waiting 5 seconds before next bot...`);
                    await sleep(5000);
                }
            }

            console.log(`\n  Batch complete. Added ${added} bot(s). Total in bots.json: ${loadBots().length}`);
            rl.close();
            return;
        }

        // Single mode
        username = await ask('  Username: ');
        password = await ask('  Password: ');
    }

    if (!username || !password) {
        console.log('  Username and password required.');
        rl.close();
        return;
    }

    const result = await onboardBot(username.trim(), password.trim());

    if (result) {
        const bots = loadBots();
        const idx = bots.findIndex(b => b.user === result.user);
        if (idx !== -1) {
            bots[idx] = result;
        } else {
            bots.push(result);
        }
        saveBots(bots);
        console.log(`\n  [SAVED] ${result.user} added to bots.json (${bots.length} total bots)`);
    } else {
        console.log(`\n  Bot was not added. Check errors above.`);
    }

    rl.close();
}

main().catch((err) => {
    console.error('Fatal error:', err);
    rl.close();
    process.exit(1);
});
