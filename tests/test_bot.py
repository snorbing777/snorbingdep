import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import bot
import live

class StrategyTests(unittest.TestCase):
    def setUp(self):
        self.c = dict(bot.DEFAULTS)
        self.now = 1800000000
        self.s = dict(cash=100, positions={}, traded=[], cost=0.03)
        self.x = dict(address='testpump', price=1, eligible=True, score=50)

    def test_entry_size_profit_exit_and_no_reentry(self):
        events = bot.step(self.s, [self.x], self.c, self.now)
        self.assertEqual(events[0]['spent'], 2)
        self.assertAlmostEqual(self.s['positions']['testpump']['quantity'], 2/1.03)
        events = bot.step(self.s, [self.x | {'price': 1.31}], self.c, self.now+60)
        self.assertEqual(events[0]['reason'], 'take_profit')
        self.assertGreater(self.s['cash'], 100)
        self.assertFalse(bot.step(self.s, [self.x], self.c, self.now+120))

    def test_daily_stop(self):
        bot.step(self.s, [self.x], self.c, self.now)
        self.s['cash'] = 95
        events = bot.step(self.s, [self.x], self.c, self.now+60)
        self.assertTrue(self.s['halted'])
        self.assertEqual(events[0]['reason'], 'daily_limit')
        self.assertFalse(self.s['positions'])

    def test_missing_price_preserves_position(self):
        bot.step(self.s, [self.x], self.c, self.now)
        events = bot.step(self.s, [], self.c, self.now+60)
        self.assertEqual(events[0]['event'], 'stale_price')
        self.assertIn('testpump', self.s['positions'])

    def test_market_filters(self):
        p = dict(chainId='solana', baseToken=dict(address='testpump'), priceUsd='1', pairCreatedAt=(self.now-3600)*1000,
                 liquidity=dict(usd=100000), volume=dict(m5=20000), txns=dict(m5=dict(buys=60,sells=20)), priceChange=dict(m5=10))
        self.assertTrue(bot.assess(p, self.c, self.now)['eligible'])
        for change in (dict(priceUsd='NaN'), dict(priceChange=dict(m5=100)), dict(liquidity=dict(usd=1))):
            self.assertFalse(bot.assess(p | change, self.c, self.now)['eligible'])

    def test_stale_position_blocks_new_entries(self):
        bot.step(self.s, [self.x], self.c, self.now)
        events = bot.step(self.s, [self.x | {'address': 'otherpump'}], self.c, self.now+60)
        self.assertEqual(len(self.s['positions']), 1)
        self.assertFalse(any(e['event'] == 'buy' for e in events))

    def test_bad_configuration(self):
        for change in (dict(position_fraction=2), dict(capital=float('nan')), dict(max_positions=1.5)):
            with self.assertRaises(ValueError):
                bot.validate(self.c | change)

    def test_selected_budget_and_daily_limit(self):
        import json
        c = bot.validate(bot.DEFAULTS | json.loads(Path('config.json').read_text()))
        self.assertEqual(c['capital'], 100)
        self.assertEqual(c['daily_loss_fraction'], 0.15)

class ExecutionTests(unittest.TestCase):
    def test_quote_validation(self):
        executor = object.__new__(live.Executor)
        executor.api_key = 'test'
        with patch('live.request', return_value=dict(inputMint='wrong')):
            with self.assertRaisesRegex(RuntimeError, 'Invalid quote'):
                executor.trade('testpump', True, 2000000)

    def test_uncertain_send_preserves_journal(self):
        from solders.keypair import Keypair
        from solders.message import MessageV0
        from solders.hash import Hash
        from solders.transaction import VersionedTransaction
        import base64
        key = Keypair()
        tx = VersionedTransaction(MessageV0.try_compile(key.pubkey(), [], [], Hash.default()), [key])
        executor = object.__new__(live.Executor)
        executor.key, executor.owner, executor.api_key = key, str(key.pubkey()), 'test'
        quote = dict(inputMint=live.USDC, outputMint='testpump', inAmount='2000000', outAmount='100', priceImpactPct='0.001')
        with tempfile.TemporaryDirectory() as directory:
            executor.journal = Path(directory)/'pending.json'
            with patch('live.request', side_effect=[quote, dict(swapTransaction=base64.b64encode(bytes(tx)).decode())]), patch.object(executor, 'rpc', side_effect=TimeoutError('timeout')):
                with self.assertRaises(TimeoutError):
                    executor.trade('testpump', True, 2000000)
            self.assertTrue(executor.journal.exists())

if __name__ == '__main__':
    unittest.main()
