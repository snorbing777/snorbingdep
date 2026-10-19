"""Read-only verification of a finalized native SOL transfer and current balance."""
import argparse
import json
import os
from decimal import Decimal, InvalidOperation

from live import Executor
from pump_live import MAINNET


def lamports(value):
    amount = Decimal(str(value))
    if not amount.is_finite() or amount <= 0 or amount*10**9 != (amount*10**9).to_integral_value():
        raise ValueError("Expected SOL amount must be positive with at most 9 decimal places")
    return int(amount*10**9)


def verify(rpc, address, signature, expected_lamports=None):
    from solders.pubkey import Pubkey
    from solders.signature import Signature
    Pubkey.from_string(address)
    Signature.from_string(signature)
    if rpc("getGenesisHash", []) != MAINNET:
        raise ValueError("Expected Solana mainnet")
    tx = rpc("getTransaction", [signature, {"encoding": "jsonParsed", "commitment": "finalized", "maxSupportedTransactionVersion": 0}])
    if tx is None:
        return dict(verified=False, status="not_found_or_not_finalized", trade_submitted=False)
    if tx["meta"]["err"]:
        return dict(verified=False, status="transaction_failed", trade_submitted=False)
    instructions = list(tx["transaction"]["message"]["instructions"])
    for inner in tx["meta"].get("innerInstructions") or []:
        instructions.extend(inner["instructions"])
    incoming = 0
    sources = set()
    for instruction in instructions:
        if instruction.get("programId") != "11111111111111111111111111111111":
            continue
        parsed = instruction.get("parsed", {})
        info = parsed.get("info", {})
        if parsed.get("type") == "transfer" and info.get("destination") == address and info.get("source") != address:
            amount = info.get("lamports")
            if not isinstance(amount, int) or isinstance(amount, bool) or amount <= 0:
                raise ValueError("Invalid transfer amount in RPC response")
            incoming += amount
            sources.add(info["source"])
    keys = [k["pubkey"] if isinstance(k, dict) else k for k in tx["transaction"]["message"]["accountKeys"]]
    if address not in keys:
        return dict(verified=False, status="recipient_not_in_transaction", trade_submitted=False)
    index = keys.index(address)
    net_credit = tx["meta"]["postBalances"][index] - tx["meta"]["preBalances"][index]
    balance = rpc("getBalance", [address, {"commitment": "finalized", "minContextSlot": tx["slot"]}])["value"]
    expected = expected_lamports if expected_lamports is not None else incoming
    passed = expected > 0 and incoming >= expected and net_credit >= expected
    return dict(verified=passed, status="finalized_SOL_transfer_verified" if passed else "transfer_does_not_meet_expected_credit",
                wallet=address, signature=signature, sources=sorted(sources), slot=tx["slot"],
                received_lamports=incoming, net_credit_lamports=net_credit, current_balance_lamports=balance,
                received_sol=incoming/1e9, current_balance_sol=balance/1e9,
                current_balance_covers_expected_deposit=expected > 0 and balance >= expected,
                trade_submitted=False,
                note="Current balance is separate from proof of arrival. This does not prove the deposit was never spent or guarantee fund safety.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--address", required=True, help="Trading wallet PUBLIC address")
    parser.add_argument("--signature", required=True, help="Phantom transfer PUBLIC transaction signature")
    parser.add_argument("--expected-sol", help="Optional minimum expected SOL deposit, for example 0.1")
    args = parser.parse_args()
    # Reuse only the RPC transport; no signer or private wallet file is loaded.
    client = object.__new__(Executor)
    client.rpc_url = os.environ.get("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com")
    if not client.rpc_url.startswith("https://"):
        parser.error("Use an HTTPS mainnet RPC")
    try:
        result = verify(client.rpc, args.address, args.signature, lamports(args.expected_sol) if args.expected_sol else None)
        print(json.dumps(result, indent=2))
    except (OSError, ValueError, KeyError, RuntimeError, InvalidOperation):
        raise SystemExit("Funding could not be verified. Check the public address/signature and RPC access. No trade was submitted.")
    if not result["verified"]:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
