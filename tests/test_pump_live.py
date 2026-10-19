import base64
import json
import os
import tempfile
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from solders.hash import Hash
from solders.keypair import Keypair
from solders.message import MessageV0
from solders.pubkey import Pubkey
from solders.transaction import VersionedTransaction

import pump_live
import wallet_setup


def token_account(owner, mint, amount):
    data = bytearray(165)
    data[:32] = bytes(Pubkey.from_string(mint))
    data[32:64] = bytes(Pubkey.from_string(owner))
    data[64:72] = amount.to_bytes(8, 'little')
    data[108] = 1
    return dict(owner=pump_live.TOKEN_PROGRAM, data=[base64.b64encode(data).decode(),'base64'])


class WalletTests(unittest.TestCase):
    def test_creation_permissions_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'wallet.json'
            address=wallet_setup.create_wallet(path)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(str(wallet_setup.load_wallet(path).pubkey()), address)
            original=path.read_bytes()
            with self.assertRaises(FileExistsError):
                wallet_setup.create_wallet(path)
            self.assertEqual(path.read_bytes(),original)
            path.chmod(0o644)
            with self.assertRaisesRegex(ValueError,'0600'):
                wallet_setup.load_wallet(path)


class PumpTests(unittest.TestCase):
    def setUp(self):
        self.executor=object.__new__(pump_live.PumpExecutor)
        self.executor.key=Keypair()
        self.executor.owner=str(self.executor.key.pubkey())
        self.mint=str(Keypair().pubkey())
        self.tx=VersionedTransaction(MessageV0.try_compile(self.executor.key.pubkey(),[],[],Hash.default()),[self.executor.key])

    def test_confirmed_buy_uses_actual_sol_and_token_deltas(self):
        response=Mock()
        response.__enter__=Mock(return_value=response)
        response.__exit__=Mock(return_value=False)
        response.read.return_value=bytes(self.tx)
        meta=dict(err=None, preBalances=[1000000000],postBalances=[987000000],fee=5000,
                  preTokenBalances=[],postTokenBalances=[dict(owner=self.executor.owner,mint=self.mint,uiTokenAmount=dict(amount='12000000',decimals=6))])
        with tempfile.TemporaryDirectory() as directory:
            self.executor.journal=Path(directory)/'pending.json'
            with patch('pump_live.urllib.request.urlopen',return_value=response) as request, patch.object(self.executor,'simulate') as simulate, patch.object(self.executor,'rpc',side_effect=['signature',dict(meta=meta)]):
                result=self.executor.trade(self.mint,True,10000000,max_debit_lamports=15000000)
            self.assertAlmostEqual(result['sol_delta'],-.013)
            self.assertEqual(result['quantity'],12)
            self.assertTrue(self.executor.journal.exists())
            payload=json.loads(request.call_args.args[0].data)
            self.assertEqual(payload['amount'],.01)
            self.assertEqual(payload['pool'],'auto')
            self.assertNotIn('secretKey',payload)
            simulate.assert_called_once()

    def test_failed_send_preserves_pending_signature(self):
        response=Mock()
        response.__enter__=Mock(return_value=response)
        response.__exit__=Mock(return_value=False)
        response.read.return_value=bytes(self.tx)
        with tempfile.TemporaryDirectory() as directory:
            self.executor.journal=Path(directory)/'pending.json'
            with patch('pump_live.urllib.request.urlopen',return_value=response), patch.object(self.executor,'simulate'), patch.object(self.executor,'rpc',side_effect=TimeoutError()):
                with self.assertRaises(TimeoutError):
                    self.executor.trade(self.mint,True,10000000,max_debit_lamports=15000000)
            self.assertIn('signature',json.loads(self.executor.journal.read_text()))

    def test_pause_or_missing_cap_prevents_transaction_request(self):
        with patch('pump_live.urllib.request.urlopen') as request:
            with self.assertRaises(ValueError):
                self.executor.trade(self.mint,True,10000000)
            with patch('pump_live.Path.exists',return_value=True):
                with self.assertRaises(pump_live.EntryPaused):
                    self.executor.trade(self.mint,True,10000000,max_debit_lamports=15000000)
            request.assert_not_called()

    def test_balance_change_during_preparation_prevents_simulation(self):
        self.executor.expected_balance_lamports=1000000000
        with patch.object(self.executor,'rpc',side_effect=self.simulation()[:3]) as rpc, patch.object(self.executor,'sol_balance',return_value=900000000):
            with self.assertRaisesRegex(RuntimeError,'balance changed'):
                self.executor.simulate(self.tx,self.mint,True,10000000,max_debit_lamports=15000000)
            self.assertFalse(any(call.args[0]=='simulateTransaction' for call in rpc.call_args_list))

    def simulation(self, after_sol=987000000, output=None):
        wallet=dict(owner='11111111111111111111111111111111',lamports=after_sol,data=['','base64'])
        if output is None:
            output=token_account(self.executor.owner,self.mint,12000000)
        return [dict(value=dict(owner=pump_live.TOKEN_PROGRAM)),dict(value=[]),dict(value=[]),
                dict(value=dict(err=None,accounts=[wallet,output]))]

    def test_simulation_accepts_bounded_buy_with_tokens(self):
        with patch.object(self.executor,'rpc',side_effect=self.simulation()), patch.object(self.executor,'sol_balance',return_value=1000000000):
            self.executor.simulate(self.tx,self.mint,True,10000000,max_debit_lamports=15000000)

    def test_guarded_simulation_can_use_only_a_public_owner(self):
        del self.executor.key
        with patch.object(self.executor,'rpc',side_effect=self.simulation()), patch.object(self.executor,'sol_balance',return_value=1000000000):
            self.executor.simulate(self.tx,self.mint,True,10000000,max_debit_lamports=15000000)

    def test_simulation_rejects_overspending_or_no_output(self):
        for responses in (self.simulation(after_sol=900000000),self.simulation(output=token_account(self.executor.owner,self.mint,0))):
            with patch.object(self.executor,'rpc',side_effect=responses), patch.object(self.executor,'sol_balance',return_value=1000000000):
                with self.assertRaises(RuntimeError):
                    self.executor.simulate(self.tx,self.mint,True,10000000,max_debit_lamports=15000000)

    def test_simulation_rejects_delegate_authority(self):
        output=token_account(self.executor.owner,self.mint,100)
        raw=bytearray(base64.b64decode(output['data'][0]))
        raw[72:76]=(1).to_bytes(4,'little')
        output['data'][0]=base64.b64encode(raw).decode()
        with patch.object(self.executor,'rpc',side_effect=self.simulation(output=output)), patch.object(self.executor,'sol_balance',return_value=1000000000):
            with self.assertRaisesRegex(RuntimeError,'delegate'):
                self.executor.simulate(self.tx,self.mint,True,10000000,max_debit_lamports=15000000)

    def test_sol_reference_requires_liquid_solana_market(self):
        with patch('pump_live.bot.get',return_value=[dict(chainId='solana',baseToken=dict(address=pump_live.WSOL),priceUsd='150',liquidity=dict(usd=2000000))]):
            self.assertEqual(pump_live.sol_usd(),150)
        with patch('pump_live.bot.get',return_value=[]):
            with self.assertRaises(RuntimeError):
                pump_live.sol_usd()

    def test_read_only_check_never_trades(self):
        executor=Mock()
        executor.owner='public-address'
        executor.rpc.return_value=pump_live.MAINNET
        executor.sol_balance.return_value=1000000000
        with patch.object(sys,'argv',['pump_live.py','--check']), patch('pump_live.PumpExecutor',return_value=executor), patch('pump_live.sol_usd',return_value=150), patch('builtins.print') as output:
            pump_live.main()
        executor.trade.assert_not_called()
        self.assertFalse(json.loads(output.call_args.args[0])['trade_submitted'])

    def test_diagnostics_identify_stage_and_hide_rpc_credentials(self):
        import urllib.error
        secret='must-not-be-printed'
        exc=urllib.error.HTTPError('https://rpc.example/'+secret,429,secret,None,None)
        result=pump_live.check_failure('Solana network verification',exc)
        self.assertIn('Solana network verification',result)
        self.assertIn('429',result)
        self.assertNotIn(secret,result)
        self.assertNotIn(secret,pump_live.check_failure('wallet loading',ValueError(secret)))

    def test_read_only_failure_identifies_actual_failing_step(self):
        executor=Mock()
        executor.rpc.return_value=pump_live.MAINNET
        with patch.object(sys,'argv',['pump_live.py','--check']), patch('pump_live.PumpExecutor',return_value=executor), patch('pump_live.sol_usd',side_effect=RuntimeError('private provider detail')):
            with self.assertRaises(SystemExit) as caught:
                pump_live.main()
        self.assertIn('SOL/USD reference feed',str(caught.exception))
        self.assertNotIn('private provider detail',str(caught.exception))
        executor.trade.assert_not_called()

    def test_tls_diagnostic_identifies_certificate_failure(self):
        import ssl
        import urllib.error
        exc=urllib.error.URLError(ssl.SSLCertVerificationError(1,'private-url-must-not-appear'))
        message=pump_live.check_failure('Solana network verification',exc)
        self.assertIn('TLS certificate verification failed',message)
        self.assertIn('Install Certificates.command',message)
        self.assertNotIn('private-url-must-not-appear',message)

    def test_dns_and_timeout_diagnostics_are_distinct(self):
        import socket
        import urllib.error
        for exc,expected in ((socket.gaierror(-2,'secret-host'), 'DNS lookup failed'),(TimeoutError('secret-url'),'Connection timed out')):
            message=pump_live.check_failure('Solana network verification',urllib.error.URLError(exc))
            self.assertIn(expected,message)
            self.assertNotIn('secret-',message)

    def test_autonomous_cycle_persists_actual_fill_and_live_callout(self):
        import argparse
        import callouts
        executor=Mock()
        executor.owner='public-address'
        executor.rpc.return_value=pump_live.MAINNET
        executor.sol_balance.return_value=1000000000
        candidate=dict(address='testpump',token_address='testpump',symbol='TEST',chain='solana',pair='pool',
                       price=2,score=60,eligible=True,checks={})
        with tempfile.TemporaryDirectory() as directory:
            old=Path.cwd()
            os.chdir(directory)
            try:
                Path('config.json').write_text('{}')
                Path('.local').mkdir()
                Path('.local/narrative-evidence.json').write_text(json.dumps({'testpump':dict(narrative='Fixture topic',observed_at=time.time(),sample_complete=True,mentions_5m=50,previous_mentions_5m=10,unique_authors_5m=30,engagements_5m=200,sources=['https://example.com/test-evidence'])}))
                executor.journal=Path('.local/pump-pending-trade.json')
                def fill(*args, **kwargs):
                    executor.journal.write_text('{"signature":"mock"}')
                    return dict(signature='mock',raw_delta=1000000,quantity=1,sol_delta=-.013,sol_fee=.000005)
                executor.trade.side_effect=fill
                with patch('pump_live.PumpExecutor',return_value=executor), patch('pump_live.sol_usd',return_value=150), patch('pump_live.bot.scan',return_value=[candidate]), patch('pump_live.time.sleep',side_effect=KeyboardInterrupt), patch('builtins.print'):
                    with self.assertRaises(KeyboardInterrupt):
                        pump_live.run(argparse.Namespace(wallet=Path('unused')))
                state=json.loads(Path('.local/pump-live-state.json').read_text())
                self.assertAlmostEqual(state['cash_sol'],round((round(100/150*1e9)-13000000))/1e9)
                self.assertEqual(state['positions']['testpump']['raw_amount'],1000000)
                self.assertAlmostEqual(state['positions']['testpump']['spent'],1.95)
                self.assertFalse(executor.journal.exists())
                snapshot=callouts.public_snapshot(Path('.local/pump-live-state.dashboard.json'))
                self.assertEqual(snapshot['mode'],'live-pump')
                self.assertTrue(any('LIVE BUY CONFIRMED' in a['title'] for a in snapshot['alerts']))
            finally:
                os.chdir(old)


if __name__=='__main__':
    unittest.main()
