"""Create a dedicated local trading wallet; print only its public address."""
import argparse
import json
import os
from pathlib import Path


DEFAULT_WALLET = Path.home() / ".config" / "snorbingdep" / "trading-wallet.json"


def create_wallet(path):
    from solders.keypair import Keypair
    path = Path(path).expanduser().resolve()
    if path.is_relative_to(Path(__file__).resolve().parent):
        raise ValueError("Keep the wallet outside the project folder")
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    key = Keypair()
    # Exclusive creation: never overwrite a funded wallet, including symlinks.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as file:
        json.dump(list(bytes(key)), file)
        file.flush()
        os.fsync(file.fileno())
    return str(key.pubkey())


def load_wallet(path):
    from solders.keypair import Keypair
    path = Path(path).expanduser()
    if path.is_symlink() or not path.is_file():
        raise ValueError("Wallet must be a regular local file")
    if path.resolve().is_relative_to(Path(__file__).resolve().parent):
        raise ValueError("Keep the wallet outside the project folder")
    if path.stat().st_mode & 0o077:
        raise ValueError("Wallet file must have permissions 0600")
    return Keypair.from_bytes(bytes(json.loads(path.read_text())))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wallet", type=Path, default=DEFAULT_WALLET)
    parser.add_argument("--address", action="store_true", help="Show an existing wallet's public address")
    args = parser.parse_args()
    try:
        address = str(load_wallet(args.wallet).pubkey()) if args.address else create_wallet(args.wallet)
    except FileExistsError:
        raise SystemExit("Wallet already exists; use --address to view its public address. It was not overwritten.")
    print("Trading wallet PUBLIC ADDRESS: " + address)
    print("Wallet file: " + str(args.wallet))
    print("Fund this dedicated address from Phantom using SOL on Solana. Never share the wallet file.")


if __name__ == "__main__":
    main()
