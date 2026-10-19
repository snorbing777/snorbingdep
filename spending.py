"""Conservative pre-trade limits for the dedicated pump trading wallet."""
import math

LAMPORTS = 1_000_000_000
RESERVE = 10_000_000  # 0.01 SOL reserved from NEW entries; exits may need fees.
MAX_OVERHEAD = 5_000_000
MAX_ENTRY_USD = 2.0   # Includes the maximum simulated rent/fee overhead.
MAX_EXPOSURE_USD = 6.0
MAX_DAILY_BUY_USD = 100.0


def reconcile(state, actual_lamports):
    if not isinstance(actual_lamports, int) or isinstance(actual_lamports, bool) or actual_lamports < 0:
        raise ValueError("Invalid on-chain SOL balance")
    if "wallet_balance_lamports" not in state:
        state["wallet_balance_lamports"] = actual_lamports
    if actual_lamports != state["wallet_balance_lamports"]:
        raise RuntimeError("On-chain SOL balance changed outside the tracked fills; reconcile before continuing")
    cash_lamports = round(state["cash_sol"]*LAMPORTS)
    if actual_lamports < cash_lamports:
        raise RuntimeError("Wallet cannot cover tracked SOL cash")


def entry_budget(state, sol_price, proposed_usd, paused=False):
    if not math.isfinite(sol_price) or sol_price <= 0:
        raise ValueError("Invalid SOL/USD price")
    if paused or state.get("halted") or len(state["positions"]) >= 3:
        return 0, 0
    overhead_usd = MAX_OVERHEAD/LAMPORTS*sol_price
    exposure = sum(p["spent"] for p in state["positions"].values())
    remaining_day = MAX_DAILY_BUY_USD-state.get("daily_buy_debits_usd", 0)
    cash_room = (round(state["cash_sol"]*LAMPORTS)-RESERVE)/LAMPORTS*sol_price
    max_total_usd = min(MAX_ENTRY_USD, MAX_EXPOSURE_USD-exposure, remaining_day, cash_room)
    # Reserve worst-case transaction overhead INSIDE all entry limits.
    principal_usd = min(proposed_usd, max_total_usd-overhead_usd)
    amount = math.floor(principal_usd/sol_price*LAMPORTS)
    max_debit = min(math.floor(max_total_usd/sol_price*LAMPORTS), round(state["cash_sol"]*LAMPORTS)-RESERVE)
    if amount <= 0 or max_debit < amount+MAX_OVERHEAD:
        return 0, 0
    return amount, max_debit


def verify_simulated_debit(before, after, max_debit, reserve=RESERVE):
    if not isinstance(max_debit, int) or max_debit <= 0 or before-after <= 0 or before-after > max_debit or after < reserve:
        raise RuntimeError("Simulated entry exceeds its total debit cap or SOL fee reserve")
