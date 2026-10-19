import contextlib
import io
import json
import os
import ssl
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

from solders.hash import Hash
from solders.keypair import Keypair

import wallet_manage


class WalletDiagnosticsTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        previous = Path.cwd()
        os.chdir(directory.name)
        self.addCleanup(os.chdir, previous)
        self.key = Keypair()
        self.destination = str(Keypair().pubkey())
        self.balance = 20_000_000
        self.rpc = self.enterContext(patch.object(wallet_manage.Executor, "rpc", side_effect=self.response))
        self.load = self.enterContext(patch.object(wallet_manage, "load_wallet", return_value=self.key))
        self.enterContext(patch.dict(os.environ, {"SOLANA_RPC_URL": "https://rpc.example/private-test-token"}))
        self.output = self.enterContext(contextlib.redirect_stdout(io.StringIO()))

    def response(self, method, params):
        return {
            "getGenesisHash": wallet_manage.MAINNET,
            "getBalance": {"value": self.balance},
            "getLatestBlockhash": {"value": {"blockhash": str(Hash.default())}},
            "getFeeForMessage": {"value": 5000},
            "simulateTransaction": {"value": {"err": None}},
        }[method]

    def withdraw(self, *extra, destination=None):
        wallet_manage.main(["withdraw", "--to", destination or self.destination, "--sol", "0.01", *extra])

    def failure(self, *extra, destination=None):
        with self.assertRaises(SystemExit) as caught:
            self.withdraw(*extra, destination=destination)
        message = str(caught.exception)
        self.assertNotIn("private-test-token", message)
        return message

    def assert_not_sent(self):
        methods = [call.args[0] for call in self.rpc.call_args_list]
        self.assertNotIn("sendTransaction", methods)
        self.assertNotIn("simulateTransaction", methods)
        self.assertFalse(wallet_manage.PENDING.exists())

    def test_valid_preview_shows_recipient_and_quoted_fee_without_broadcast(self):
        self.withdraw()
        plan = json.loads(self.output.getvalue())
        self.assertEqual(plan["to"], self.destination)
        self.assertEqual(plan["fee_lamports"], 5000)
        self.assertEqual(plan["remaining_lamports"], 9_995_000)
        self.assertTrue(plan["preview_only"])
        self.assertFalse(plan["trade_or_transfer_submitted"])
        self.assert_not_sent()

    def test_placeholder_and_self_destination_fail_before_rpc(self):
        for destination in ("YOUR_PHANTOM_PUBLIC_ADDRESS", str(self.key.pubkey())):
            with self.subTest(destination=destination):
                message = self.failure(destination=destination)
                self.assertIn("withdrawal input", message)
                self.assertIn("Phantom", message)
                self.rpc.assert_not_called()
        self.assert_not_sent()

    def test_invalid_amount_is_explained_without_rpc(self):
        for amount in ("abc", "0", "NaN", "0.0000000001"):
            with self.subTest(amount=amount):
                with self.assertRaises(SystemExit) as caught:
                    wallet_manage.main(["withdraw", "--to", self.destination, "--sol", amount])
                self.assertIn("positive SOL amount", str(caught.exception))
                self.rpc.assert_not_called()
        self.assert_not_sent()

    def test_zero_and_insufficient_balances_report_amount_and_fee(self):
        for balance in (0, 10_000_000):
            with self.subTest(balance=balance):
                self.balance = balance
                message = self.failure()
                self.assertIn(f"wallet balance {balance/1e9:.9f} SOL", message)
                self.assertIn("requires 0.010005000 SOL", message)
                self.assertIn("No transfer was submitted", message)
        self.assert_not_sent()

    def test_all_funds_preview_requires_enough_for_the_fee(self):
        self.balance = 1000
        with self.assertRaises(SystemExit) as caught:
            wallet_manage.main(["withdraw", "--to", self.destination, "--all"])
        self.assertIn("Insufficient SOL", str(caught.exception))
        self.assertIn("0.000005000 SOL", str(caught.exception))
        self.assert_not_sent()

    def test_missing_wallet_does_not_expose_exception_details_or_use_rpc(self):
        self.load.side_effect = ValueError("secret file contents private-test-token")
        message = self.failure()
        self.assertIn("wallet loading", message)
        self.assertIn("wallet_setup.py --address", message)
        self.assertNotIn("secret file contents", message)
        self.rpc.assert_not_called()

    def test_pending_journal_is_preserved_and_blocks_rpc(self):
        wallet_manage.PENDING.parent.mkdir()
        wallet_manage.PENDING.write_text('{"signature":"keep-me"}')
        message = self.failure()
        self.assertIn("live ledger checks", message)
        self.assertIn("do not delete", message)
        self.assertEqual(wallet_manage.PENDING.read_text(), '{"signature":"keep-me"}')
        self.rpc.assert_not_called()

    def test_open_positions_and_changed_balance_keep_ledger_intact(self):
        wallet_manage.STATE.parent.mkdir()
        for positions, recorded_balance, hint in (({"mint": {}}, self.balance, "open positions"), ({}, 1, "differs from the live ledger")):
            with self.subTest(hint=hint):
                contents = json.dumps({"wallet": str(self.key.pubkey()), "positions": positions,
                                       "wallet_balance_lamports": recorded_balance})
                wallet_manage.STATE.write_text(contents)
                self.assertIn(hint, self.failure())
                self.assertEqual(wallet_manage.STATE.read_text(), contents)
                self.assert_not_sent()

    def test_active_bot_lock_is_explained_without_bypassing_it(self):
        import fcntl
        wallet_manage.STATE.parent.mkdir()
        with wallet_manage.STATE.with_suffix(".lock").open("w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertIn("Stop its Terminal process with Control-C", self.failure())
        self.rpc.assert_not_called()
        self.assert_not_sent()

    def test_network_errors_identify_stage_and_redact_url_and_message(self):
        failures = [
            (urllib.error.HTTPError("https://rpc.example/private-test-token", 429, "private-test-token", None, None), "HTTP 429"),
            (urllib.error.URLError(ssl.SSLCertVerificationError(1, "private-test-token")), "TLS certificate verification failed"),
            (TimeoutError("private-test-token"), "connection timed out"),
        ]
        for error, hint in failures:
            with self.subTest(hint=hint):
                self.rpc.side_effect = error
                message = self.failure()
                self.assertIn("Solana network verification", message)
                self.assertIn(hint, message)
                self.assertIn("No transfer was submitted", message)
                self.assert_not_sent()

    def test_broadcast_connection_failure_preserves_signature_and_warns_against_retry(self):
        def response(method, params):
            if method == "sendTransaction":
                raise urllib.error.URLError("private-test-token")
            return self.response(method, params)

        self.rpc.side_effect = response
        with patch("builtins.input", return_value="WITHDRAW"):
            message = self.failure("--execute")
        self.assertIn("transfer broadcast", message)
        self.assertIn("may have been submitted", message)
        self.assertNotIn("No transfer was submitted", message)
        pending = json.loads(wallet_manage.PENDING.read_text())
        self.assertIn(pending["signature"], message)
        self.assertTrue(Path(".local/PAUSE_BUYS").exists())
        self.assertEqual(sum(call.args[0] == "sendTransaction" for call in self.rpc.call_args_list), 1)


if __name__ == "__main__":
    unittest.main()
