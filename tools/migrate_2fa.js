#!/usr/bin/env node
// migrate_2fa.js — One-time migration tool
// Converts existing bots from email auth codes to mobile authenticator (shared_secret)
// After migration, bots auto-generate TOTP codes on every restart — no manual email codes needed.
//
// Usage: node tools/migrate_2fa.js [-c config.js]

const SteamUser = require('steam-user');
const SteamTotp = require('steam-totp');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

// Parse optional config path
let configPath = path.join(__dirname, '..', 'config.js');
const argIdx = process.argv.indexOf('-c');
if (argIdx !== -1 && process.argv[argIdx + 1]) {
    configPath = path.resolve(process.argv[argIdx + 1]);
}

const CONFIG = require(configPath);
const secretsDir = path.join(__dirname, 'secrets');

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

async function migrateBot(login) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`  Migrating: ${login.user}`);
    console.log('='.repeat(50));

    // Check if already migrated
    if (login.auth && login.auth.length > 5) {
        console.log(`  [SKIP] ${login.user} already has a shared_secret (auth length: ${login.auth.length})`);
        return login;
    }

    // Check if secrets already exist (previous partial migration)
    const secretsFile = path.join(secretsDir, `${login.user}.json`);
    if (fs.existsSync(secretsFile)) {
        const existing = JSON.parse(fs.readFileSync(secretsFile, 'utf8'));
        if (existing.shared_secret) {
            console.log(`  [FOUND] Existing secrets file for ${login.user}`);
            const useExisting = await ask('  Use existing shared_secret? (y/n): ');
            if (useExisting.trim().toLowerCase() === 'y') {
                login.auth = existing.shared_secret;
                console.log(`  [OK] Using saved shared_secret for ${login.user}`);
                return login;
            }
        }
    }

    const client = new SteamUser({ promptSteamGuardCode: false });

    return new Promise(async (resolve) => {
        let resolved = false;

        function finish(updatedLogin) {
            if (resolved) return;
            resolved = true;
            try { client.logOff(); } catch (e) { /* ignore */ }
            resolve(updatedLogin);
        }

        // Step 1: Get a fresh email auth code
        console.log(`\n  Steam will send an email auth code to the email for ${login.user}.`);
        console.log(`  Log into the email, grab the code, and enter it below.`);
        const emailCode = await ask(`  Enter email auth code for ${login.user}: `);

        client.on('loggedOn', async () => {
            console.log(`  [OK] ${login.user} logged in successfully.`);

            try {
                // Step 2: Enable 2FA
                console.log(`  Enabling mobile authenticator...`);
                const response = await new Promise((res, rej) => {
                    client.enableTwoFactor((err, response) => {
                        if (err) rej(err);
                        else res(response);
                    });
                });

                if (response.status === 2) {
                    console.log(`  [WARN] ${login.user} already has an authenticator.`);
                    console.log(`  You may need to remove it first via Steam support or the revocation code.`);
                    finish(login);
                    return;
                }

                if (response.status === 29) {
                    console.log(`  [ERROR] ${login.user} needs a phone number added to the account first.`);
                    finish(login);
                    return;
                }

                if (response.status !== 1) {
                    console.log(`  [ERROR] enableTwoFactor returned status ${response.status}`);
                    finish(login);
                    return;
                }

                // Step 3: Save secrets IMMEDIATELY (before finalization)
                const secrets = {
                    account_name: login.user,
                    shared_secret: response.shared_secret.toString('base64'),
                    revocation_code: response.revocation_code,
                    identity_secret: response.identity_secret.toString('base64'),
                    serial_number: response.serial_number,
                    server_time: response.server_time,
                    uri: response.uri,
                    migrated_at: new Date().toISOString()
                };

                fs.writeFileSync(secretsFile, JSON.stringify(secrets, null, 2));
                console.log(`\n  [SAVED] Secrets saved to: ${secretsFile}`);
                console.log(`  [IMPORTANT] Revocation code: ${response.revocation_code}`);
                console.log(`  Write this down! It's the only way to remove the authenticator if something goes wrong.\n`);

                // Step 4: Get activation code
                console.log(`  Steam sent an activation code to the email/phone for ${login.user}.`);
                const activationCode = await ask(`  Enter activation code: `);

                // Step 5: Finalize
                console.log(`  Finalizing 2FA...`);
                const sharedSecretBase64 = secrets.shared_secret;

                await new Promise((res, rej) => {
                    client.finalizeTwoFactor(Buffer.from(sharedSecretBase64, 'base64'), activationCode.trim(), (err) => {
                        if (err) rej(err);
                        else res();
                    });
                });

                console.log(`  [SUCCESS] ${login.user} mobile authenticator is now active!`);

                // Verify it works
                const testCode = SteamTotp.getAuthCode(sharedSecretBase64);
                console.log(`  [VERIFY] Generated test TOTP code: ${testCode}`);

                login.auth = sharedSecretBase64;
                finish(login);

            } catch (err) {
                console.error(`  [ERROR] Migration failed for ${login.user}:`, err.message);
                console.log(`  If 2FA was partially enabled, use the revocation code to remove it.`);
                finish(login);
            }
        });

        client.on('error', (err) => {
            console.error(`  [ERROR] Login failed for ${login.user}:`, err.message);
            if (err.eresult === 63) {
                console.log(`  The email auth code was incorrect or expired. Try again.`);
            }
            finish(login);
        });

        // Attempt login
        console.log(`  Logging in...`);
        client.logOn({
            accountName: login.user,
            password: login.pass,
            authCode: emailCode.trim(),
            rememberPassword: true
        });
    });
}

async function main() {
    console.log('\n  Skinscore Bot 2FA Migration Tool');
    console.log('  ================================\n');
    console.log(`  Config: ${configPath}`);
    console.log(`  Bots found: ${CONFIG.logins.length}`);
    console.log(`  Secrets dir: ${secretsDir}\n`);

    const toMigrate = CONFIG.logins.filter(l => !l.auth || l.auth.length <= 5);
    const alreadyDone = CONFIG.logins.length - toMigrate.length;

    if (alreadyDone > 0) {
        console.log(`  ${alreadyDone} bot(s) already have shared_secret — will be skipped.`);
    }
    console.log(`  ${toMigrate.length} bot(s) need migration.\n`);

    if (toMigrate.length === 0) {
        console.log('  Nothing to migrate. All bots already use shared_secret.');
        rl.close();
        return;
    }

    const confirm = await ask('  Proceed with migration? (y/n): ');
    if (confirm.trim().toLowerCase() !== 'y') {
        console.log('  Aborted.');
        rl.close();
        return;
    }

    const updatedLogins = [];

    for (const login of CONFIG.logins) {
        const updated = await migrateBot({ ...login });
        updatedLogins.push(updated);
        // Wait between bots to avoid rate limiting
        await sleep(3000);
    }

    // Output results
    console.log('\n' + '='.repeat(50));
    console.log('  Migration Complete');
    console.log('='.repeat(50));

    const migrated = updatedLogins.filter(l => l.auth && l.auth.length > 5);
    const failed = updatedLogins.filter(l => !l.auth || l.auth.length <= 5);

    console.log(`\n  Migrated: ${migrated.length}`);
    console.log(`  Failed/Skipped: ${failed.length}`);

    if (failed.length > 0) {
        console.log(`\n  Failed bots:`);
        for (const f of failed) {
            console.log(`    - ${f.user}`);
        }
    }

    // Save updated logins to a file
    const outputFile = path.join(secretsDir, '_updated_logins.json');
    fs.writeFileSync(outputFile, JSON.stringify(updatedLogins, null, 4));
    console.log(`\n  Updated logins saved to: ${outputFile}`);
    console.log(`  Copy the "auth" values into your config.js / bots.json to complete the migration.\n`);

    rl.close();
}

main().catch((err) => {
    console.error('Fatal error:', err);
    rl.close();
    process.exit(1);
});
