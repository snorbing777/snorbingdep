"""Build and simulate public-wallet trades. Only Phantom signs and broadcasts."""
import base64
import json
import os
import time
import urllib.request
from decimal import Decimal, InvalidOperation

from funding_check import lamports
from pump_live import MAINNET, PumpExecutor
import spending


class ManualError(ValueError):
    """A controlled, credential-free message safe to show in the UI."""


def public_client(owner):
    from solders.pubkey import Pubkey
    Pubkey.from_string(owner)
    client = object.__new__(PumpExecutor)
    client.owner = owner
    client.rpc_url = os.environ.get("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com")
    if not client.rpc_url.startswith("https://") or client.rpc("getGenesisHash", []) != MAINNET:
        raise ValueError("Expected HTTPS Solana mainnet RPC")
    return client


def prepare(data, trading_owner=None):
    from solders.pubkey import Pubkey
    from solders.transaction import VersionedTransaction
    owner, mint, side = data["owner"], data["mint"], data["side"]
    Pubkey.from_string(owner)
    Pubkey.from_string(mint)
    if owner == trading_owner:
        raise ManualError("Use a separate Phantom account for manual trades; the automated wallet is managed by the live ledger.")
    if side not in ("buy", "sell"):
        raise ManualError("Choose buy or sell")
    if side == "buy":
        try:
            amount = lamports(data["amount_sol"])
        except (ValueError, InvalidOperation):
            raise ManualError("Invalid SOL amount") from None
        if amount > 100_000_000:
            raise ManualError("Manual buys are capped at 0.1 SOL per request")
        requested, denominated = amount/1e9, "true"
    client = public_client(owner)
    client.expected_balance_lamports = client.sol_balance()
    if type(client.expected_balance_lamports) is not int or client.expected_balance_lamports < 0:
        raise ValueError("Invalid wallet balance")
    if side == "buy":
        required = amount+spending.MAX_OVERHEAD+spending.RESERVE
        if client.expected_balance_lamports < required:
            raise ManualError(f"Connected Phantom account has {client.expected_balance_lamports/1e9:.9f} SOL. This guarded buy requires {required/1e9:.9f} SOL including a 0.005 SOL overhead allowance and 0.01 SOL reserve.")
    else:
        percent = data.get("percent")
        if type(percent) is not int or percent not in (25, 50, 100):
            raise ManualError("Choose 25, 50 or 100 percent")
        balance = client.token_balance(mint)
        amount = balance*percent//100
        if amount <= 0:
            raise ManualError("No sellable token balance")
        # Request exact token units, avoiding rounding a percentage at the provider.
        info = client.rpc("getTokenSupply", [mint, {"commitment": "confirmed"}])["value"]
        requested, denominated = str(Decimal(amount).scaleb(-int(info["decimals"]))), "false"
    payload = dict(publicKey=owner, mint=mint, action=side, amount=requested, denominatedInSol=denominated,
                   slippage=1, priorityFee=0.00001, pool="auto")
    req = urllib.request.Request("https://pumpportal.fun/api/trade-local", data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=25) as response:
        raw = response.read(4097)
    if len(raw) > 4096:
        raise ValueError("Invalid transaction size")
    tx = VersionedTransaction.from_bytes(raw)
    if tx.message.header.num_required_signatures != 1 or str(tx.message.account_keys[0]) != owner:
        raise ValueError("Unexpected transaction signer")
    # This object has only a public address. No private-key file is loaded here.
    max_debit = amount+5_000_000 if side == "buy" else None
    client.simulate(tx, mint, side == "buy", amount, max_debit)
    return dict(transaction=base64.b64encode(raw).decode(), owner=owner, mint=mint, side=side,
                amount_sol=amount/1e9 if side == "buy" else None, percent=data.get("percent") if side == "sell" else None,
                max_debit_sol=max_debit/1e9 if max_debit else None, slippage_percent=1,
                prepared_at=time.time(), expires_at=time.time()+30,
                simulation_passed=True, submitted=False)


def status(owner, signature):
    from solders.signature import Signature
    Signature.from_string(signature)
    result = public_client(owner).rpc("getSignatureStatuses", [[signature], {"searchTransactionHistory": True}])["value"][0]
    return dict(signature=signature, status="not_found" if not result else "failed" if result.get("err") else result.get("confirmationStatus", "processed"))
