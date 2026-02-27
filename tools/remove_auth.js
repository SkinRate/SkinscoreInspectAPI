#!/usr/bin/env node
// remove_auth.js — Remove phantom/real mobile authenticator from a Steam bot account
// Usage: node tools/remove_auth.js --user skinscorebot00 --pass "password"

const SteamUser = require('steam-user');
const readline = require('readline');
const https = require('https');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
    return new Promise(resolve => rl.question(question, resolve));
}

function steamApiPost(endpoint, accessToken, params = {}) {
    return new Promise((resolve, reject) => {
        const postData = `access_token=${encodeURIComponent(accessToken)}` +
            Object.entries(params).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join('');

        const url = new URL(`https://api.steampowered.com/ITwoFactorService/${endpoint}/v1/`);

        const req = https.request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error(`Bad response: ${data}`));
                }
            });
        });
        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

async function main() {
    console.log('\n  Steam Authenticator Removal Tool');
    console.log('  ================================\n');

    let username = null, password = null;

    const userIdx = process.argv.indexOf('--user');
    const passIdx = process.argv.indexOf('--pass');
    if (userIdx !== -1 && process.argv[userIdx + 1]) username = process.argv[userIdx + 1];
    if (passIdx !== -1 && process.argv[passIdx + 1]) password = process.argv[passIdx + 1];

    if (!username) username = (await ask('  Username: ')).trim();
    if (!password) password = (await ask('  Password: ')).trim();

    if (!username || !password) {
        console.log('  Username and password required.');
        rl.close();
        return;
    }

    const client = new SteamUser({ promptSteamGuardCode: false });
    let accessToken = null;

    return new Promise(async (resolve) => {
        let resolved = false;
        function finish() {
            if (resolved) return;
            resolved = true;
            try { client.logOff(); } catch (e) { /* ignore */ }
            rl.close();
            resolve();
        }

        client.on('steamGuard', async (domain, callback) => {
            console.log(`  [EMAIL] Steam sent an auth code to ${domain ? '*@' + domain : 'your email'}.`);
            const code = await ask(`  Enter email auth code: `);
            callback(code.trim());
        });

        // Extract access token from web session cookies
        client.on('webSession', (sessionID, cookies) => {
            for (const cookie of cookies) {
                if (cookie.startsWith('steamLoginSecure=')) {
                    const value = decodeURIComponent(cookie.split('=')[1]);
                    const parts = value.split('||');
                    if (parts.length >= 2) {
                        accessToken = parts[1];
                        console.log(`  [OK] Got access token from web session.`);
                    }
                }
            }
        });

        client.on('loggedOn', async () => {
            console.log(`  [OK] ${username} logged in.`);
            console.log(`  SteamID: ${client.steamID.getSteamID64()}`);

            // Try direct access token first
            accessToken = client._accessToken || client.accessToken || null;

            if (!accessToken) {
                // Fall back to extracting from web session
                console.log('  Requesting web session for access token...');
                client.webLogOn();
                // Wait for webSession event
                await new Promise(res => {
                    const timeout = setTimeout(() => {
                        console.log('  [WARN] webSession timed out after 10s.');
                        res();
                    }, 10000);
                    client.once('webSession', () => {
                        clearTimeout(timeout);
                        res();
                    });
                });
            }

            if (accessToken) {
                console.log(`  [OK] Access token ready.\n`);
            } else {
                console.log(`  [WARN] Could not get access token. Email challenge won't work.\n`);
            }

            console.log('  How do you want to remove the authenticator?');
            console.log('    1) Revocation code (R-xxxxx)');
            console.log('    2) Email challenge (Steam sends removal code to email)');
            console.log('    3) Force remove (empty revocation code — works for phantom auth)');
            console.log('    4) Just check status');
            const choice = (await ask('\n  Choice (1/2/3/4): ')).trim();

            if (choice === '1') {
                if (!accessToken) {
                    console.log('  [ERROR] No access token.');
                    finish();
                    return;
                }
                const revCode = await ask('  Enter revocation code (R-xxxxx): ');
                console.log('  Removing authenticator...');
                try {
                    const result = await steamApiPost('RemoveAuthenticator', accessToken, {
                        steamid: client.steamID.getSteamID64(),
                        revocation_code: revCode.trim(),
                        steamguard_scheme: '1'
                    });
                    console.log('  Response:', JSON.stringify(result, null, 2));
                    if (result.response && result.response.success) {
                        console.log(`  [SUCCESS] Authenticator removed!`);
                    } else {
                        console.log(`  [FAILED] Check response above.`);
                    }
                } catch (e) {
                    console.error(`  [ERROR]`, e.message);
                }
                finish();

            } else if (choice === '2') {
                if (!accessToken) {
                    console.log('  [ERROR] No access token available. Try: npm install steam-user@latest');
                    finish();
                    return;
                }

                try {
                    // Step 1: Start the challenge — Steam sends a code to the email
                    console.log('  Requesting email challenge...');
                    const startResult = await steamApiPost('RemoveAuthenticatorViaChallengeStart', accessToken, {
                        steamid: client.steamID.getSteamID64()
                    });
                    console.log('  Start response:', JSON.stringify(startResult, null, 2));

                    if (startResult.response && startResult.response.success) {
                        console.log(`\n  [OK] Steam sent a removal code to your email.`);
                    } else {
                        console.log(`\n  [WARN] Response may indicate an issue, but check your email anyway.`);
                    }

                    // Step 2: Get the code from the user
                    const removeCode = await ask('  Enter the removal code from your email: ');

                    // Step 3: Complete the challenge
                    console.log('  Completing challenge...');
                    const continueResult = await steamApiPost('RemoveAuthenticatorViaChallengeContinue', accessToken, {
                        steamid: client.steamID.getSteamID64(),
                        sms_code: removeCode.trim(),
                        generate_new_token: 'true'
                    });
                    console.log('  Continue response:', JSON.stringify(continueResult, null, 2));

                    if (continueResult.response && continueResult.response.success) {
                        console.log(`\n  [SUCCESS] Authenticator removed from ${username}!`);
                        console.log(`  You can now run add_bot.js to set up a fresh one.`);
                    } else {
                        console.log(`\n  [FAILED] Check the response above for details.`);
                    }

                } catch (err) {
                    console.error(`  [ERROR] Email challenge failed:`, err.message);
                }
                finish();

            } else if (choice === '3') {
                // Force remove via Web API with empty revocation code
                if (!accessToken) {
                    console.log('  [ERROR] No access token. Cannot use Web API.');
                    finish();
                    return;
                }

                console.log('  Attempting force removal via Web API...');

                // Try multiple schemes
                const schemes = [
                    { name: 'scheme 1 (revocation)', steamguard_scheme: '1' },
                    { name: 'scheme 2 (none)', steamguard_scheme: '2' },
                    { name: 'scheme 4 (email)', steamguard_scheme: '4' },
                ];

                let removed = false;
                for (const scheme of schemes) {
                    if (removed) break;
                    console.log(`\n  Trying ${scheme.name}...`);
                    try {
                        const result = await steamApiPost('RemoveAuthenticator', accessToken, {
                            steamid: client.steamID.getSteamID64(),
                            revocation_code: '',
                            steamguard_scheme: scheme.steamguard_scheme
                        });
                        console.log('  Response:', JSON.stringify(result, null, 2));
                        if (result.response && result.response.success) {
                            console.log(`\n  [SUCCESS] Authenticator removed with ${scheme.name}!`);
                            removed = true;
                        }
                    } catch (e) {
                        console.error(`  [ERROR] ${scheme.name}:`, e.message);
                    }
                }

                if (!removed) {
                    console.log('\n  All schemes failed. The old bots will keep working with email codes.');
                    console.log('  Focus on the new bots (10-19) for now — they should work cleanly.');
                }
                finish();

            } else {
                // Just check status
                console.log('  Checking authenticator status...');
                client.enableTwoFactor((err, response) => {
                    if (err) {
                        console.error(`  [ERROR]`, err.message);
                    } else {
                        console.log(`  enableTwoFactor status: ${response.status}`);
                        if (response.status === 1) {
                            console.log(`  [INFO] No active authenticator! Ready to set up fresh.`);
                            if (response.revocation_code) {
                                console.log(`  [INFO] Revocation code: ${response.revocation_code} — save this!`);
                            }
                        } else if (response.status === 2) {
                            console.log(`  [CONFIRMED] Has an active (or phantom) authenticator.`);
                        } else {
                            console.log(`  Status meaning unknown.`);
                        }
                    }
                    finish();
                });
            }
        });

        client.on('error', (err) => {
            console.error(`  [ERROR] Login failed:`, err.message);
            finish();
        });

        console.log('  Logging in...');
        client.logOn({
            accountName: username,
            password: password,
            rememberPassword: true
        });
    });
}

main().catch((err) => {
    console.error('Fatal error:', err);
    rl.close();
    process.exit(1);
});
