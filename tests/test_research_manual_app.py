import base64
import io
import json
import os
import plistlib
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import Mock, patch

from solders.hash import Hash
from solders.keypair import Keypair
from solders.message import MessageV0
from solders.signature import Signature
from solders.transaction import VersionedTransaction

import dashboard
import mac_app
import manual_trading
import research


class ResearchTests(unittest.TestCase):
    def setUp(self):
        research.CACHE.clear()
        self.mint = str(Keypair().pubkey())
        self.now = time.time()
        self.pair = dict(chainId="solana", baseToken=dict(address=self.mint), priceUsd="0.01",
            pairCreatedAt=(self.now-3600)*1000, liquidity=dict(usd=100_000), volume=dict(m5=30_000),
            txns=dict(m5=dict(buys=90, sells=20)), priceChange=dict(m5=10), marketCap=200_000)

    def test_good_market_without_narrative_is_blocked(self):
        with patch("research.bot.get", return_value=[self.pair]), patch.object(Path, "read_text", side_effect=["{}", "{}"]):
            result = research.analyze(self.mint, self.now)
        self.assertFalse(result["eligible"])
        self.assertFalse(result["checks"]["narrative_evidence"])
        self.assertEqual(result["scenario_100x_cap_usd"], 20_000_000)
        self.assertNotIn("probability", result)

    def test_fresh_complete_narrative_and_market_required_together(self):
        item = dict(narrative="Test topic", observed_at=self.now, sample_complete=True, sources=["https://api.x.com"],
                    mentions_5m=60, previous_mentions_5m=10, unique_authors_5m=40, engagements_5m=200)
        for changes, passes in (({}, True), ({"observed_at": self.now-301}, False), ({"sample_complete": False}, False)):
            with self.subTest(changes=changes):
                research.CACHE.clear()
                with patch("research.bot.get", return_value=[self.pair]), patch.object(Path, "read_text", side_effect=["{}", json.dumps({self.mint:item|changes})]):
                    result = research.analyze(self.mint, self.now)
                self.assertEqual(result["eligible"], passes)

    def test_unindexed_failed_or_wrong_mint_data_never_passes(self):
        for response in ([], [self.pair | {"baseToken": {"address": "other"}}], OSError("secret-rpc-url")):
            research.CACHE.clear()
            with patch("research.bot.get", side_effect=response if isinstance(response, Exception) else None, return_value=response), patch.object(Path, "read_text", side_effect=["{}", "{}"]):
                result = research.analyze(self.mint, self.now)
            self.assertEqual(result["status"], "insufficient_data")
            self.assertFalse(result["eligible"])
            self.assertNotIn("secret-rpc-url", json.dumps(result))


class ManualTests(unittest.TestCase):
    def setUp(self):
        self.key = Keypair()
        self.owner = str(self.key.pubkey())
        self.mint = str(Keypair().pubkey())
        message = MessageV0.try_compile(self.key.pubkey(), [], [], Hash.default())
        self.raw = bytes(VersionedTransaction.populate(message, [Signature.default()]))
        self.client = Mock()
        self.client.sol_balance.return_value = 1_000_000_000
        self.enterContext(patch("manual_trading.public_client", return_value=self.client))
        self.request = self.enterContext(patch("manual_trading.urllib.request.urlopen", side_effect=lambda *args, **kwargs: io.BytesIO(self.raw)))
        self.data = dict(owner=self.owner, mint=self.mint, side="buy", amount_sol="0.01")

    def test_preparation_only_returns_simulated_unsigned_transaction(self):
        result = manual_trading.prepare(self.data)
        self.assertEqual(base64.b64decode(result["transaction"]), self.raw)
        self.assertFalse(result["submitted"])
        self.assertEqual(result["max_debit_sol"], .015)
        self.client.simulate.assert_called_once()
        self.client.trade.assert_not_called()
        self.assertFalse(any(call.args[0] == "sendTransaction" for call in self.client.rpc.call_args_list))

    def test_automated_wallet_and_excessive_manual_buy_are_blocked(self):
        with self.assertRaises(manual_trading.ManualError):
            manual_trading.prepare(self.data, self.owner)
        with self.assertRaises(manual_trading.ManualError):
            manual_trading.prepare(self.data | {"amount_sol": "0.100000001"})
        self.request.assert_not_called()

    def test_empty_manual_wallet_shows_public_balance_without_provider_request(self):
        self.client.sol_balance.return_value = 0
        with self.assertRaisesRegex(manual_trading.ManualError, "0.000000000 SOL"):
            manual_trading.prepare(self.data)
        self.request.assert_not_called()

    def test_partial_sell_uses_exact_integer_units(self):
        self.client.token_balance.return_value = 100_000_001
        self.client.rpc.return_value = {"value": {"decimals": 6}}
        result = manual_trading.prepare(self.data | {"side": "sell", "percent": 25})
        payload = json.loads(self.request.call_args.args[0].data)
        self.assertEqual(payload["amount"], "25.000000")
        self.assertEqual(payload["denominatedInSol"], "false")
        self.assertEqual(self.client.simulate.call_args.args[3], 25_000_000)
        self.assertEqual(result["percent"], 25)

    def test_wrong_signer_or_failed_simulation_returns_no_transaction(self):
        original = self.raw
        other = Keypair()
        message = MessageV0.try_compile(other.pubkey(), [], [], Hash.default())
        self.raw = bytes(VersionedTransaction.populate(message, [Signature.default()]))
        with self.assertRaisesRegex(ValueError, "signer"):
            manual_trading.prepare(self.data)
        self.client.simulate.assert_not_called()
        self.raw = original
        self.client.simulate.side_effect = RuntimeError("Simulation failed")
        with self.assertRaisesRegex(RuntimeError, "Simulation failed"):
            manual_trading.prepare(self.data)


class DashboardControlTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        previous = Path.cwd()
        os.chdir(directory.name)
        self.addCleanup(os.chdir, previous)
        self.enterContext(patch("wallet_setup.DEFAULT_WALLET", Path(directory.name)/"missing-wallet"))
        server = ThreadingHTTPServer(("127.0.0.1", 0), partial(dashboard.Handler, snapshot=Path("missing.json")))
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.base = "http://127.0.0.1:"+str(server.server_port)

    def request(self, origin=None):
        headers = {"Content-Type": "application/json"}
        if origin:
            headers["Origin"] = origin
        return urllib.request.Request(self.base+"/api/manual/prepare", data=b'{"owner":"test"}', headers=headers)

    def test_post_requires_same_origin_and_never_prepares_cross_origin(self):
        with patch("dashboard.manual_trading.prepare") as prepare:
            for origin in (None, "https://evil.example"):
                with self.assertRaises(urllib.error.HTTPError) as caught:
                    urllib.request.urlopen(self.request(origin))
                self.assertEqual(caught.exception.code, 403)
            prepare.assert_not_called()

    def test_same_origin_prepares_and_redacts_provider_errors(self):
        with patch("dashboard.manual_trading.prepare", return_value={"submitted": False}) as prepare:
            with urllib.request.urlopen(self.request(self.base)) as response:
                self.assertFalse(json.load(response)["submitted"])
            prepare.assert_called_once()
        with patch("dashboard.manual_trading.prepare", side_effect=OSError("secret-rpc-url")):
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(self.request(self.base))
            self.assertNotIn("secret-rpc-url", caught.exception.read().decode())

    def test_recorded_auto_wallet_is_blocked_even_if_private_file_is_missing(self):
        Path(".local").mkdir()
        Path(".local/pump-live-state.json").write_text('{"wallet":"test"}')
        with patch("dashboard.manual_trading.prepare") as prepare:
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(self.request(self.base))
            self.assertIn("separate Phantom account", caught.exception.read().decode())
            prepare.assert_not_called()

    def test_health_and_launchagent_configuration_do_not_start_live_trading(self):
        with urllib.request.urlopen(self.base+"/api/health") as response:
            self.assertEqual(json.load(response), {"app": "signal-desk", "version": 5})
        config = plistlib.loads(plistlib.dumps(mac_app.agent_config(Path("/project with spaces"), Path("/python"))))
        self.assertTrue(config["KeepAlive"])
        self.assertIn("/project with spaces/dashboard.py", config["ProgramArguments"])
        self.assertNotIn("pump_live.py", " ".join(config["ProgramArguments"]))


class MacInstallerTests(unittest.TestCase):
    def test_public_restart_failure_still_updates_and_opens_installed_local_dashboard(self):
        from public_share import SetupError
        with tempfile.TemporaryDirectory() as directory:
            home=Path(directory);agents=home/'Library/LaunchAgents';agents.mkdir(parents=True)
            (agents/'com.snorbingdep.signaldesk.share.plist').write_text('fixture')
            (agents/(mac_app.LABEL+'.plist')).write_text('fixture')
            with patch.object(mac_app.sys,'platform','darwin'),patch.object(Path,'home',return_value=home), \
                 patch('public_share.main',side_effect=SetupError('Fixture tunnel unavailable')) as share, \
                 patch('mac_app.subprocess.run',return_value=Mock(returncode=0)) as command, \
                 patch('mac_app.health',return_value=True),patch('mac_app.webbrowser.open') as opened,patch('builtins.print'):
                mac_app.main(['restart'])
                share.assert_called_once_with(['restart','--no-browser'])
                self.assertEqual(command.call_args.args[0][1],'kickstart')
                opened.assert_called_once_with('http://127.0.0.1:8765')

    def test_restart_refreshes_public_only_install_without_resetting_access(self):
        with tempfile.TemporaryDirectory() as directory:
            home=Path(directory);sharing=home/'Library/LaunchAgents/com.snorbingdep.signaldesk.share.plist'
            sharing.parent.mkdir(parents=True);sharing.write_text('fixture')
            with patch.object(mac_app.sys,'platform','darwin'),patch.object(Path,'home',return_value=home), \
                 patch('public_share.main') as share,patch('mac_app.subprocess.run') as command:
                mac_app.main(['restart'])
                share.assert_called_once_with(['restart']);command.assert_not_called()

    def test_installer_writes_user_app_and_supervises_dashboard_only(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            root = home/"project with spaces"
            root.mkdir()
            with patch.object(mac_app.sys, "platform", "darwin"), patch.object(mac_app, "ROOT", root), \
                 patch.object(Path, "home", return_value=home), patch("mac_app.socket.socket"), \
                 patch("mac_app.subprocess.run", side_effect=[Mock(returncode=1), Mock(returncode=0)]) as run, \
                 patch("mac_app.health", return_value=True), patch("mac_app.webbrowser.open") as opened, patch("builtins.print"):
                mac_app.main(["install"])
            agent = home/"Library/LaunchAgents"/(mac_app.LABEL+".plist")
            config = plistlib.loads(agent.read_bytes())
            self.assertEqual(config["WorkingDirectory"], str(root))
            self.assertTrue(config["RunAtLoad"])
            self.assertEqual(agent.stat().st_mode & 0o777, 0o600)
            app = home/"Applications/Signal Desk.app/Contents"
            self.assertEqual(plistlib.loads((app/"Info.plist").read_bytes())["CFBundleExecutable"], "SignalDesk")
            self.assertIn("mac_app.py", (app/"MacOS/SignalDesk").read_text())
            self.assertEqual(run.call_args.args[0][1], "bootstrap")
            opened.assert_called_once_with("http://127.0.0.1:8765")

    def test_non_mac_install_is_rejected_before_any_mutation(self):
        with patch.object(mac_app.sys, "platform", "linux"), patch("mac_app.subprocess.run") as run:
            with self.assertRaisesRegex(SystemExit, "for macOS"):
                mac_app.main(["install"])
            run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
