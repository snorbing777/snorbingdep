"""Read-only Robinhood Chain RPC connectivity check; never signs or trades."""
import argparse
import json
import os
import urllib.request


def check_network(rpc_url, expected_chain_id):
    if not rpc_url.startswith("https://") or expected_chain_id <= 0:
        raise ValueError("Provide an HTTPS RPC and positive chain ID from official network documentation")

    def rpc(method):
        request = urllib.request.Request(rpc_url, data=json.dumps(dict(jsonrpc="2.0", id=1, method=method, params=[])).encode(),
                                         headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=15) as response:
            data = json.load(response)
        if "error" in data:
            raise RuntimeError("RPC rejected network check")
        return int(data["result"], 16)

    chain_id = rpc("eth_chainId")
    if chain_id != expected_chain_id:
        raise ValueError("RPC chain ID does not match expected Robinhood Chain network")
    return dict(network="Robinhood Chain", chain_id=chain_id, block=rpc("eth_blockNumber"),
                trading_enabled=False, status="RPC connected; DEX execution adapter is not configured")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chain-id", type=int, required=True, help="Expected chain ID from official network documentation")
    args = parser.parse_args()
    url = os.environ.get("ROBINHOOD_CHAIN_RPC_URL")
    if not url:
        parser.error("Set ROBINHOOD_CHAIN_RPC_URL securely; never paste RPC credentials into chat")
    try:
        print(json.dumps(check_network(url, args.chain_id)))
    except (OSError, ValueError, KeyError, RuntimeError):
        raise SystemExit("Network check failed. Verify the configured RPC and chain ID; RPC credentials are not printed.")


if __name__ == "__main__":
    main()
