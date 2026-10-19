# Multi-chain crypto callouts and trading prototype

**For unattended real pump-token trades on a Mac, start with
[MAC_LIVE_START.txt](MAC_LIVE_START.txt).** `Set Up Mac.command` creates a separate
local hot wallet; fund its public address from Phantom using SOL. Then use
`Start Live Trading.command`. No Phantom seed phrase or pump.fun account login
is used. This wallet has a different on-chain identity from your Phantom wallet.

The new `pump_live.py` path constructs unsigned transactions via PumpPortal,
checks RPC simulation for token delivery, bounded SOL debits and selected token
authority changes, signs locally and records confirmed token/native SOL deltas.
It uses a $100 initial tracked budget cap, ~2% position sizing, three positions,
and a $15 daily equity stop trigger. Actual native SOL fees/rent reduce tracked
cash. External funding/withdrawals while running are unsupported. Simulation is
a preflight check for a real transaction, not the paper-trading mode below.
The external builder/RPC are still trusted; this is not a complete instruction
audit. Funded end-to-end execution, Mac launcher behavior, and profitability
have not been verified here. The cloud proxy currently denies required provider
and documentation requests. Do not describe this as a verified production bot.

Discovery still uses DexScreener and requires indexed pump-suffix markets. It
does not snipe every fresh pump.fun bonding-curve launch. `live.py` below remains
the separate older USDC/Jupiter path; Robinhood Chain execution is unimplemented.

Python 3.12+. Paper trading is the default. Optional live execution uses Jupiter
Swap and a local Solana signer. **Live execution has not been validated with a
funded wallet. This is a prototype, not a proven profitable strategy.**

## Strategy and limits

Poll DexScreener's latest token profiles across Solana, Ethereum, Base, BNB
Chain (`bsc`), Arbitrum, Polygon, Avalanche and Optimism. Select the most liquid
quoted market per token. This is limited discovery, not launch-time sniping or
a feed of every cryptocurrency. Native BTC markets and centralized exchanges
are not covered. Use `watchlist` entries with `chain` and token-contract
`address` fields to extend discovery. Set `pump_only: true` to restrict
screening to Solana addresses ending in `pump`; this remains a heuristic.
Identical EVM contract addresses on different chains remain separate markets.
Defaults require $50k liquidity, 30 minutes of age, $10k five-minute volume,
30 buys, buy/sell ratio >=1.5, and five-minute gains between 0% and 35%.
Rank using buy pressure and volume/liquidity. Optional narrative keywords match
names and symbols only; they do not establish sentiment or narrative quality.

Allocate 2% of tracked equity per trade, with three positions maximum. Full
exits trigger at 30% profit, 10% loss, 15% trailing drawdown, or six hours.
A daily equity stop halts entries and attempts exits. Closed tokens are not
reentered. These are triggers, not guaranteed exit prices or loss ceilings.
Stale data, rugs, illiquidity, MEV and outages can result in total loss.

The bot does not verify holder concentration, mint/freeze authorities,
liquidity locks, wash trading, or sell restrictions. It does not forecast
10x/100x returns. No historical backtest or profitability evidence is included.

## Paper mode

```sh
cd /workspace/snorbingdep
python3 bot.py --once
python3 bot.py
```

Edit `config.json` for thresholds; omitted settings use `bot.DEFAULTS`.
Virtual starting balance is $100. Estimated costs are 1% fees plus 2% slippage
per side. State and JSONL reports persist under `.local/`. Missing prices do
not produce fabricated exits. Paper fills do not prove execution is possible.
Use a fresh state path with `--state` to start a separate experiment.

## Live mode: experimental

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements-live.txt
.venv/bin/python -m unittest discover -s tests -v
```

Configure these through secure environment settings, never chat:

- `SOLANA_RPC_URL`: HTTPS mainnet RPC endpoint.
- `JUPITER_API_KEY`: API key for `api.jup.ag`.
- `SOLANA_KEYPAIR_PATH`: Solana CLI JSON keypair file outside this repository,
  permissions 0600. Requires an actual local signer, not a proxy placeholder.

Use a dedicated wallet funded with 100 USDC and separate SOL for transaction
fees; startup requires at least 0.01 SOL. The ledger tracks a $100 USDC budget.
SOL fees are logged separately, excluded from the daily equity limit. USDC is
valued at $1. Do not alter wallet holdings while the bot runs.

```sh
# Selected $15 daily stop for the $100 USDC strategy budget.
.venv/bin/python live.py --acknowledge-live-risk --daily-loss-usd 15
```

Live execution remains Solana-only regardless of the multi-chain paper configuration.

Requests exact-input Jupiter routes with 1% slippage tolerance and a 2% quoted
price-impact ceiling. Signs locally, sends with preflight, waits for confirmed
transactions and accounts for actual token balance changes. Jupiter constructs
the transaction: the bot checks the required signer but does not independently
audit every instruction. Use only a dedicated, minimally funded wallet.

A pending journal is written before broadcast. Ambiguous failures stop the
process. Inspect the journal signature on-chain and reconcile
`.local/live-state.json` before clearing `.local/pending-trade.json`; never
blindly delete it or retry. A crash after a ledger update can also leave a
journal requiring reconciliation. Run only one bot per wallet. Ctrl-C stops
monitoring but does not close positions; manage those manually.

Required network destinations: `api.dexscreener.com`, `api.jup.ag`, your RPC
host. Live API compatibility, fills, latency and recovery still require
integration validation before unattended use. No wallet or credentials are
included in this repository.

## Callouts and desktop pop-ups

Run scanner and dashboard in separate terminals:

```sh
python3 bot.py
python3 dashboard.py
```

The dashboard listens on local port 8765. Open its root page in a local browser.
It shows screening reasons, chain and contract identity, positions, callout
history, feed freshness and the daily stop. In-page pop-ups work while the page
is open. The notification button requests browser permission for desktop
notifications. **Test pop-up** sends a labeled demo without placing an order.

For native operating-system notifications, run this on **your desktop**:

```sh
python3 desktop_notify.py --test
python3 desktop_notify.py
```

Supports Linux (`notify-send` from libnotify and an active desktop session),
macOS (AppleScript notifications) and Windows (PowerShell notification-area
balloons). Allow notifications in your OS settings. Keep the receiver running.
It deduplicates alerts and suppresses stale and historical callouts. If the bot
runs remotely, securely forward the dashboard port to your desktop first; this
cloud container has no desktop notification session. The receiver needs only
Python's standard library and access to the local or forwarded dashboard.

Callouts use explicit labels:

- **WATCH**: screening passed, not a buy instruction or return forecast.
- **PAPER ENTRY / EXIT**: simulated trades only.
- **LIVE BUY / SELL CONFIRMED**: confirmed Solana execution, never a proposal.
- **DAILY STOP / PRICE UNAVAILABLE / DATA FEED ERROR**: operational warnings.

For an existing live Solana process, use its separate dashboard snapshot:

```sh
python3 dashboard.py --snapshot .local/live-state.dashboard.json
```

Dashboard endpoints bind to loopback and never expose signer files. Research,
artwork and status are read-only; the manual order endpoint only builds and
simulates unsigned trades. Phantom signs and submits only after user approval.
The native receiver works without an open browser
once the dashboard is running. Notifications depend on OS permissions and
availability, and do not substitute for monitoring open positions.

## Robinhood Chain

Robinhood Chain is distinct from Robinhood Crypto accounts and Robinhood Wallet.
**Robinhood Chain market data and order execution are not implemented yet.**
Official network and DEX documentation plus a working RPC are needed to verify
the network, token addresses, quoting method and supported swaps. DexScreener
coverage for Robinhood Chain has not been established. There is no automatic
fallback to Solana.

A read-only network check verifies a configured RPC against an explicit chain ID
and reads its latest block. Set `ROBINHOOD_CHAIN_RPC_URL` securely, then supply
the chain ID from official documentation:

```sh
python3 robinhood_chain.py --chain-id YOUR_VERIFIED_NUMERIC_CHAIN_ID
```

This command never signs transactions, discovers markets or enables trading.
No unverified chain ID, RPC, DEX router or wallet contract is hardcoded.


## Funding verification and additional entry limits

Use `Check Funding.command` on your Mac after a Phantom SOL transfer, or run:

```sh
.venv/bin/python funding_check.py --address PUBLIC_WALLET_ADDRESS --signature PUBLIC_TRANSFER_SIGNATURE --expected-sol 0.1
```

Replace placeholders and select your actual expected amount. This utility loads
no private wallet file and uses only read-only mainnet RPC calls. It checks a
finalized, successful System Program SOL transfer to the exact recipient, the
minimum amount and the recipient's net credit in that transaction. It reports
current balance separately. A confirmed deposit does not prove the funds were
never spent; a sufficient current balance is not proof of their provenance.
Unsupported token transfers, failures and unavailable transactions do not verify.

The live pump path additionally caps each entry's total native SOL debit,
including allowed rent/fee overhead, at $2 at the reference price. Combined open
entry cost is capped at $6, daily buy debits at $100, and 0.01 SOL is reserved
from new entries. Exits may use that reserve for fees. Balance changes outside
confirmed ledger fills halt the process; external deposits are not automatically
added to the budget. Dollar values move with SOL prices and these software
limits do not guarantee loss ceilings or protect against compromised providers.

`Pause New Buys.command` sets `.local/PAUSE_BUYS`. It blocks entry preparation
and is checked again before signing. The bot can still attempt exits; an
in-flight transaction may execute. Remove only that marker to resume entries.
Older live ledgers with trading history need explicit manual reconciliation
before migration. Preserve wallet files, ledger history and pending journals.

## Live pump.fun launch discovery

The redesigned **Discover** tab opens a read-only browser WebSocket to
`wss://pumpportal.fun/api/data` and subscribes to `subscribeNewToken`.
It displays new creation messages as they arrive, independently of the trading
scanner and wallet. No funding, private key, or running trading process is
required. Only valid creation events become cards; duplicate mints are ignored.
Names and tickers render as text, not HTML. Artwork metadata is fetched only from supported public gateways; see below.

Cards show provider-supplied launch market-cap estimates in SOL, the reported
creation trade's SOL amount when present, received age, a full-address copy
control and a link to the token on pump.fun. Missing numbers remain unknown.
These are unreviewed launches, not recommendations. The market cap is a creation
snapshot, not a live market quote. Token artwork is unverified metadata, with generated initials when unavailable. Signals and Positions are separate tabs for bot reports.

The feed has search, age filters, sorting, pause/resume and automatic reconnect
with bounded backoff. This is **not a complete history or a guarantee of every
pump.fun launch**: no backfill is available, interruptions/pauses can miss events,
and closing the tab clears the session. Up to 1000 received launches are retained
in the page, with additional deduplication bounded to recent history. Keep one
feed tab open where possible. Optional launch sounds group rapid events; trade/warning callouts keep their existing notification behavior.

To update an existing Mac install, stop only the dashboard Terminal process with
Control-C, then run these commands inside the project folder:

```sh
git pull --ff-only
bash "Open Live Dashboard.command"
```

For this foreground command, leave Terminal running. The background Mac app
installation below removes that requirement. This starts the dashboard only; it
**does not start live trading**. A stale/offline trading report does not stop the
launch stream. The browser must reach `pumpportal.fun`; errors/reconnects and
coverage gaps are displayed. If a connection remains unavailable, no launches
are invented as placeholders. Cloud provider requests remained blocked during
implementation, so real production-stream delivery still needs validation on
the user's network. Automated browser checks used explicit test events.

Optional development checks for the new JavaScript feed (Node.js required only
for these tests, not for running the dashboard):

```sh
node --test tests/test_launch_feed.cjs
```

`tests/dashboard_browser.cjs` additionally exercises the UI with Playwright and
a mocked WebSocket. Start a separate `python3 dashboard.py --port 8766` first.
Install Playwright/browser tooling in your development environment, then run
`node tests/dashboard_browser.cjs`; `DASHBOARD_URL` and `BROWSER_PATH` can select
a test server or existing browser executable. Screenshots contain labeled test
tokens and are written to the temporary directory. No wallet or trading endpoint
is invoked by these UI checks.


## Token pictures and sound alerts

Token cards use a direct HTTPS image from the creation event where available,
or resolve its metadata through the local read-only artwork service, with supported IPFS/Arweave gateway retries and an indexed-market fallback. Images can
load after the card appears. Broken, missing or unsupported artwork falls back
to initials. Logos are supplied by token creators and are not identity checks.
The artwork service fetches only allowlisted HTTPS gateways, validates redirects, limits bytes/time/concurrency, and proxies supported raster images to avoid browser CORS failures. Unsupported or unavailable images retain a fallback; Retry pictures retries client lookups. Metadata is read as JSON or recognized raster image bytes. Images use no-referrer loading; the image host can
still see the browser's request. Arbitrary metadata hosts, local-address images,
non-HTTPS URLs and embedded HTML are not accepted.

Click **Enable sounds** in the Sound & large buys panel to allow browser audio.
A short chime confirms activation. Set volume or mute it at any time.
New-launch tones have a short cooldown so bursts do not overlap continuously.
No historical launches are replayed as sounds. Keep the page open; browser/OS
audio settings and background-tab policies can suppress delivery.

**Monitor large buys** is off by default. Enabling it subscribes to reported
trades for the **25 most recent launches received in this tab**, using the same
public PumpPortal WebSocket. As new tokens arrive, older subscriptions are
removed; reconnect restores the current set. Set a minimum SOL size (default
10 SOL). Only reported buys at/above the threshold trigger; sells, other tokens
and duplicate signatures do not. A large-buy tone differs from the launch
chime. Alerts appear in the panel even while muted. Rapid audible/pop-up alerts
are grouped, with recent qualifying events retained in the panel.

This is a trade-size filter, not identification of wealthy wallets, proof of
organic buying, all-token coverage, or a buy recommendation. Provider access
and trade-stream availability apply; a rejected subscription is displayed.
Disable monitoring and reconnect to resume creation-only discovery if needed.
These alert features never sign transactions, connect a wallet or authorize payments. Actual
production provider coverage and audible delivery on the user's Mac remain
unverified. Browser tests use mocked metadata and trade events, and verify Web
Audio scheduling rather than human hearing.

New tests: `node --test tests/test_launch_feed.cjs tests/test_market_extras.cjs`.
With Playwright installed and a test dashboard on port 8766,
`node tests/artwork_sound_browser.cjs` exercises image success/fallback, user
audio activation, new-launch cues, large-buy thresholds, duplicate suppression,
mute and subscription opt-out using fixtures only.


## Shark dashboard, separate ledgers and narrative entry gating

The shark logo is a local SVG, and discovery retains 1,000 received launches
with paginated rendering. It still does not backfill missed events or guarantee
all-token coverage. Paper trading and Live money have distinct sections and
read separate snapshot files; mode mismatches are rejected. Start paper mode:

```sh
bash "Start Paper Trading.command"
```

The primary pump live path now **requires fresh narrative evidence for every
new entry**, including a check immediately before preparing the trade. The
checked-in paper configuration also requires it. Existing exit checks continue
when narrative data is missing. `.local/narrative-evidence.json` must contain
per-mint real measurements: named narrative, observation timestamp (<=300s old),
complete sample flag, source URLs, at least 30 mentions / 20 distinct authors /
100 engagements over 5 minutes, and at least 2.5x the preceding 5-minute count.
These are conservative heuristics, not a model proven to select runners or
detect bots, wash activity, coordinated shilling or future profits. Missing,
stale or incomplete measurements prevent entries; keywords alone cannot pass.
The older standalone `live.py` Jupiter path is not this gated primary workflow.

`social_feed.py --measure-topics` can measure configured X topic discussions
through the official recent-search API. Copy `narrative_topics.example.json` to
`narrative_topics.json` and replace its placeholders with at most five exact
mint/topic pairs. Sampling is explicitly labeled and truncated samples do not
pass. Broad narrative discussion may be unrelated to a particular token. No
analytics API or Telegram-based audience measurement has been invented; those
require a specified provider and authorized access.

## Community callouts: authorized sources only

The Callouts tab displays source authors, original links, text, timestamps,
attached pictures and matched contract addresses when present. It does not
execute trades from influencer posts. Identities and profitability are unverified.
`social_settings.json` lists initial X handle candidates `blknoiz06`, `orangie`,
and `cupsey`; review those identities before trusting the feed.

The X collector requires your own official API entitlement and `X_BEARER_TOKEN`
configured securely on the machine running it. It uses the recent-search API,
not scraping or a login/password. Calls consume that API's quota. Run:

```sh
.venv/bin/python social_feed.py --measure-topics
```

For `@BullishCallsPremium`, configure a dedicated `TELEGRAM_BOT_TOKEN` securely
and obtain the channel administrator's permission for that bot to receive
channel posts. A username or personal subscription alone does not grant Bot API
access. No private/premium access bypass is implemented. The collector reads
only that configured channel's authorized updates and sends no messages:

```sh
.venv/bin/python telegram_feed.py
```

Run collectors in separate terminals, or choose one using Start Social
Feeds.command. The bot must not already be consumed by another getUpdates
process. Telegram thumbnails are cached under ignored `.local/telegram-media`;
the token-containing Telegram download URL is never exposed to the browser.
A successful empty getUpdates response does not prove channel membership.
No source posts are fabricated when credentials/access are missing.

The exact pump.fun callouts page/API has **not** been identified or integrated.
A public URL and supported source are still required. Telegram, X source access
and any analytics provider remain external prerequisites; their availability
and actual content have not been validated in this environment. Cloud secrets
do not automatically appear in your Mac's Terminal: configure local credentials
securely too, never paste them in chat, commit them or put them into shell history.

## Deposit / withdraw through Terminal

The Live money section shows the separate wallet's public deposit address and
copy control; no private key or signing endpoint is served. For instructions:

```sh
.venv/bin/python wallet_manage.py deposit
```

Send **native SOL on Solana** from Phantom to that public address and verify a
small test via Check Funding.command. Stop trading before external funding
changes. For a withdrawal, stop the bot and manage/close positions first:

```sh
# Paste only your public Solana receiving address from Phantom when prompted.
# This previews a 0.01 SOL withdrawal; it does not broadcast.
printf 'Paste your Phantom SOL receiving address: ' && \
read -r phantom_address && \
.venv/bin/python wallet_manage.py withdraw --to "$phantom_address" --sol 0.01
```

Review the full destination and quoted network fee. To submit, repeat the
reviewed command with `--execute`, then type `WITHDRAW` in the local prompt.
Use `--all` instead of `--sol` for remaining native SOL minus the quoted fee.
The helper builds a single explicit System Program transfer locally, verifies
mainnet and fees, runs simulation, journals before sending, and checks confirmed
debits. It blocks active bot locks, pending signatures and open ledger positions.
Token balances are not liquidated automatically. An ambiguous withdrawal leaves
`.local/withdraw-pending.json`; do not delete it blindly or resubmit. No funded
withdrawal has been verified here. A terminal preview/test is not execution proof.
Failures identify the check that stopped the command, including invalid addresses,
insufficient SOL (with the quoted fee), RPC/TLS errors and ledger blocks. Share
only this diagnostic message for help, never a wallet file or credential-bearing
RPC URL. If a broadcast was attempted, the diagnostic reports an uncertain
transfer status and public signature instead of claiming nothing was submitted.

After a deposit while a ledger already exists, preview:

```sh
.venv/bin/python wallet_manage.py reconcile
```

Add `--execute` to apply the reviewed current balance, capped to a $100 tracked
budget at the reference price. Reconciliation does not reset daily counters,
clear a daily halt or remove the pause marker. Withdrawals halt new trading;
manage the remaining funds and existing daily halt before resuming. Never delete
ledger files to reset limits.

Transaction logs now record build/simulation/broadcast/confirmation durations.
This makes latency measurable, not zero. Network conditions, provider quotas,
RPC speed, fees, confirmation time and the scanner's polling interval still
apply. The pipeline preserves serial accounting, preflight checks and pending
journals; it is not a guaranteed first-block sniper or a production-verified bot.


## Background Mac app, runner research and manual Phantom orders

Stop the old foreground **dashboard** with Control-C, update the checkout, then:

```sh
bash "Install Mac App.command"
```

This creates `~/Applications/Signal Desk.app` and a per-user LaunchAgent at
`~/Library/LaunchAgents/com.snorbingdep.signaldesk.plist`. It starts only the
loopback dashboard, restarts it after a crash, and starts it at login. Close
Terminal after the health check passes. Open the app to bring up the browser;
keep the project folder and its `.venv` in place. This is a Mac app launcher
using the installed Python environment, not a standalone Windows `.exe` or a
packaged native trading application. macOS installation was tested with mocked
system calls; actual LaunchAgent execution requires validation on a Mac.

Use `bash "Restart Dashboard.command"` after future code updates. To stop the
background dashboard, use `bash "Stop Dashboard Background.command"`; opening
the app starts it again, and the saved agent starts again at next login. To
remove login startup, stop it and remove only the generated LaunchAgent plist.
Logs are `.local/dashboard.log` and `.local/dashboard-error.log`. An occupied
port is reported instead of killing another process. macOS can require allowing
Python access to the project folder in Privacy & Security. The agent uses the
default public mainnet RPC; shell-only environment variables are not inherited
by LaunchAgents. Do not put RPC credentials in a shared plist or app launcher.

The app server staying up does not make a sleeping/offline laptop collect data.
Keep the browser tab open and the Mac awake for the PumpPortal launch stream,
audio and browser alerts. Stream reconnect and idle recovery mark coverage gaps;
there is no historical backfill or all-market coverage guarantee. No real trading
process starts just because the dashboard is installed or opened.

Artwork now keeps existing image elements during launch updates, accepts the
provider's image/metadata field aliases, retries failures with bounded backoff,
and falls back to browser metadata fetching if the Python resolver fails. Each
card shows whether artwork loaded or is unavailable. Private/unavailable creator
assets may still have no picture; no substitute image is presented as the coin.

Select **Analyze runner potential** on a launch card. Auto-screening queues the
latest ten received launches, with a bounded queue and cached results; it does
not scan all 1000 simultaneously or place orders. The panel shows liquidity,
volume, buy/sell counts, age, pass/block decisions, social evidence and sources.
A 100x price scenario shows market cap multiplied by 100 at constant supply;
it is not a probability, forecast or liquidity estimate. Missing market data,
unindexed bonding curves and missing/stale social measurements block approval.
Holder concentration, creator intent, LP control and organic virality remain
unverified; passing this heuristic screen is not proof of safety or profitability.

Narrative measurements require authorized X recent-search access: configure
`X_BEARER_TOKEN` securely in the collector's local environment, create up to five
exact mint/topic entries in `narrative_topics.json` following the example, and
run `.venv/bin/python social_feed.py --measure-topics` (or Start Social
Feeds.command, option 1). Never paste credentials into the dashboard or chat.
The panel displays actual collected evidence, rather than inferring virality
from a token's name. The existing live engine rechecks its own entry gates; a
research badge does not place a trade or add that launch to its indexed-market
scan. The default market gate still requires 30 minutes of indexed market age.
There is no validated strategy for reliably finding 100x runners here.

**Manual trade** opens an order form. Use current Phantom in Chrome/Brave and
connect the Solana account you use on pump.fun. This shares that account's
on-chain holdings; it does not import pump.fun login, profile, email account or
sessions. No seed phrase, private key or pump.fun password is requested.
Wallet Standard handles connection and approval without third-party JS bundles.

1. Choose the full mint, buy SOL amount (maximum 0.1 SOL), or sell 25/50/100%.
2. Choose **Prepare and simulate**. The server checks mainnet, payer and guarded
   SOL/token/authority changes. It returns an unsigned transaction and does not
   broadcast anything. The buy guard retains a 0.01 SOL reserve and allows at
   most 0.005 SOL overhead beyond the requested buy. Preparation expires in 30s.
3. Review the mint, amount and debit allowance, then choose **Approve in Phantom**.
   Inspect Phantom's own transaction preview before approving a real order.
4. Confirmation is queried by public signature. An ambiguous wallet response
   saves a browser pending flag, blocks another submission, and requires checking
   Phantom activity/on-chain outcome before clearing it. It is never auto-retried.

Use a **different account** from the automated wallet. Manual trades are outside
its $2 entry, $6 exposure and $15 daily stop controls. Preparation is blocked for
the bot wallet to prevent bypassing its ledger. Manual orders may lose their
full value; simulation is not execution proof. The builder and RPC remain
trusted dependencies. Real Phantom extension and funded manual swaps have not
been tested here; automated tests use mocked wallet/provider responses.

Additional verification: `node tests/research_manual_browser.cjs` with a test
server on port 8766 and Playwright/Chromium installed exercises image recovery,
stable image nodes, research evidence, Wallet Standard approval and pending
submission persistence. Unit tests also check same-origin POST restrictions,
ledger-wallet isolation, fee/debit guards and LaunchAgent configuration.
