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

Dashboard endpoints are read-only and bind to loopback. They never expose
signer files or place trades. The native receiver works without an open browser
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
Names and tickers render as text, not HTML, and external metadata is not fetched.

Cards show provider-supplied launch market-cap estimates in SOL, the reported
creation trade's SOL amount when present, received age, a full-address copy
control and a link to the token on pump.fun. Missing numbers remain unknown.
These are unreviewed launches, not recommendations. The market cap is a creation
snapshot, not a live market quote. Token icons are generated initials, not
verified project logos. Signals and Positions are separate tabs for bot reports.

The feed has search, age filters, sorting, pause/resume and automatic reconnect
with bounded backoff. This is **not a complete history or a guarantee of every
pump.fun launch**: no backfill is available, interruptions/pauses can miss events,
and closing the tab clears the session. Up to 200 received launches are retained
in the page, with additional deduplication bounded to recent history. Keep one
feed tab open where possible. Launch notifications are not sent for every coin;
trade/warning callouts keep their existing notification behavior.

To update an existing Mac install, stop only the dashboard Terminal process with
Control-C, then run these commands inside the project folder:

```sh
git pull --ff-only
bash "Open Live Dashboard.command"
```

Leave the Terminal running. This starts discovery and the dashboard only; it
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
