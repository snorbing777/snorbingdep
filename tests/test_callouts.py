import json
import tempfile
import threading
import time
import sys
import unittest
import urllib.error
import urllib.request
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import Mock, patch

import bot
import callouts
import dashboard
import desktop_notify
import robinhood_chain


def pair(chain, address):
    return dict(chainId=chain, baseToken=dict(address=address, symbol="TEST"), pairAddress="pool",
                priceUsd="1", pairCreatedAt=(1800000000-3600)*1000, liquidity=dict(usd=100000),
                volume=dict(m5=20000), txns=dict(m5=dict(buys=60, sells=20)), priceChange=dict(m5=10))


class MultiChainTests(unittest.TestCase):
    def setUp(self):
        self.c = bot.validate(bot.DEFAULTS | dict(chains=["base", "ethereum", "solana"], pump_only=False))

    def test_same_contract_on_two_chains_remains_separate(self):
        candidates = [bot.assess(pair(chain, "0xABC"), self.c, 1800000000) for chain in ("base", "ethereum")]
        self.assertTrue(all(x['eligible'] for x in candidates))
        self.assertNotEqual(candidates[0]['address'], candidates[1]['address'])
        state = dict(cash=100, positions={}, traded=[], cost=.03)
        bot.step(state, candidates, self.c, 1800000000)
        self.assertEqual(len(state['positions']), 2)
        self.assertEqual(state['positions']['base:0xabc']['token_address'], '0xABC')

    def test_live_legacy_pump_filter_is_preserved(self):
        c = self.c | dict(chains=['solana'], pump_only=True)
        self.assertFalse(bot.assess(pair('base', '0xABC'), c, 1800000000)['eligible'])
        self.assertFalse(bot.assess(pair('solana', 'notpumpaddress'), c, 1800000000)['eligible'])

    def test_scan_uses_chain_specific_endpoint_and_pinned_market(self):
        profiles = [dict(chainId='base', tokenAddress='0xABC')]
        p = pair('base', '0xabc')
        other = p | dict(pairAddress='different', liquidity=dict(usd=999999))
        state = dict(positions={'base:0xabc':dict(chain='base', token_address='0xabc', pair='pool')})
        with patch('bot.get', side_effect=[profiles, [other, p]]) as get, patch('bot.time.sleep'):
            results = bot.scan(state, self.c)
        self.assertEqual(len(results), 1)
        self.assertTrue(all(x['pair'] == 'pool' for x in results))
        self.assertTrue(all('/base/' in c.args[0] for c in get.call_args_list[1:]))

    def test_bad_chain_and_watchlist_rejected(self):
        for changes in (dict(chains=['imaginary']), dict(watchlist=[dict(chain='base', address='../file')]), dict(pump_only='false')):
            with self.assertRaises(ValueError):
                bot.validate(self.c | changes)


class CalloutTests(unittest.TestCase):
    def test_paper_cycle_reaches_native_notification_receiver(self):
        receiver = desktop_notify.Receiver()
        sender = Mock()
        receiver.deliver(dict(time=time.time(), alerts=[]), time.time(), sender)
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory)/'config.json'
            config.write_text(json.dumps(dict(capital=100, chains=['base'], pump_only=False)))
            state = Path(directory)/'state.json'
            p = pair('base','0xABC')
            p['pairCreatedAt'] = (time.time()-3600)*1000
            argv=['bot.py','--once','--config',str(config),'--state',str(state)]
            with patch.object(sys,'argv',argv), patch('bot.get',side_effect=[[dict(chainId='base',tokenAddress='0xABC')],[p]]), patch('bot.time.sleep'), patch('builtins.print'):
                bot.main()
            ledger=json.loads(state.read_text())
            self.assertIn('base:0xabc',ledger['positions'])
            snapshot=callouts.public_snapshot(state.with_suffix('.dashboard.json'))
            receiver.deliver(snapshot,time.time(),sender)
            titles=[call.args[0] for call in sender.call_args_list]
            self.assertTrue(any('PAPER ENTRY' in title for title in titles))
            self.assertTrue(any('WATCH' in title for title in titles))

    def test_watch_dedup_and_simulation_labels(self):
        c = bot.DEFAULTS | dict(capital=100, daily_loss_fraction=.15)
        x = bot.assess(pair('solana', 'testpump'), c, 1800000000)
        state = dict(cash=98, positions={}, day='2027-01-01')
        report = dict(time=1800000000, mode='paper', equity=100, candidates=[x],
                      events=[dict(event='buy', address='testpump', spent=2)])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'snapshot.json'
            callouts.publish(path, report, state, c)
            callouts.publish(path, report | dict(time=1800000060, events=[]), state, c)
            snapshot = callouts.public_snapshot(path)
            self.assertEqual(len(snapshot['alerts']), 2)
            self.assertIn('PAPER ENTRY', snapshot['alerts'][0]['title'])
            self.assertNotIn('cooldowns', snapshot)
            self.assertEqual(snapshot['daily_loss_usd'], 15)

    def test_live_exit_does_not_use_proposed_paper_pnl(self):
        state = dict(cash=100, positions={})
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'snapshot.json'
            callouts.publish(path, dict(time=10, mode='live-solana', candidates=[], events=[dict(event='sell', address='token', reason='stop', pnl=9999, usd_delta=1.5)]), state, bot.DEFAULTS)
            alert = callouts.public_snapshot(path)['alerts'][0]
            self.assertIn('CONFIRMED', alert['title'])
            self.assertNotIn('9999', alert['detail'])


class DesktopTests(unittest.TestCase):
    def test_dedup_staleness_and_startup_history(self):
        receiver = desktop_notify.Receiver()
        sender = Mock()
        a = dict(id='1', time=100, title='WATCH', detail='details')
        snapshot = dict(time=100, alerts=[a])
        self.assertEqual(receiver.deliver(snapshot, 100, sender), 0)
        snapshot['alerts'].append(a | dict(id='2', time=103))
        self.assertEqual(receiver.deliver(snapshot | dict(time=103), 103, sender), 1)
        self.assertEqual(receiver.deliver(snapshot | dict(time=104), 104, sender), 0)
        snapshot['alerts'].append(a | dict(id='3', time=104))
        self.assertEqual(receiver.deliver(snapshot, 1000, sender), 0)
        self.assertEqual(sender.call_count, 1)

    def test_token_names_never_become_shell_source(self):
        malicious = '$(touch /tmp/unsafe); " injected'
        with patch('desktop_notify.subprocess.run') as run:
            desktop_notify.notify(malicious, malicious, system='Darwin')
            self.assertNotIn(malicious, run.call_args.args[0][2])
            self.assertEqual(run.call_args.args[0][-2:], [malicious, malicious])
        with patch('desktop_notify.subprocess.run') as run, patch('desktop_notify.shutil.which', return_value='/usr/bin/notify-send'):
            desktop_notify.notify(malicious, malicious, system='Linux')
            self.assertEqual(run.call_args.args[0][-3:], ['--', malicious, malicious])


class NetworkTests(unittest.TestCase):
    def test_robinhood_rejects_wrong_chain_before_other_calls(self):
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = b'{"result":"0x1"}'
        with patch('robinhood_chain.urllib.request.urlopen', return_value=response) as request:
            with self.assertRaisesRegex(ValueError, 'chain ID'):
                robinhood_chain.check_network('https://rpc.example', 123)
            self.assertEqual(request.call_count, 1)

    def test_dashboard_is_read_only_and_serves_no_signer_files(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'snapshot.json'
            path.write_text(json.dumps(dict(mode='paper', alerts=[], cooldowns={'private':1})))
            server=ThreadingHTTPServer(('127.0.0.1',0), partial(dashboard.Handler, snapshot=path))
            thread=threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base=f'http://127.0.0.1:{server.server_port}'
            opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
            try:
                with opener.open(base+'/api/status') as response:
                    data=json.load(response)
                    self.assertEqual(data['mode'],'paper')
                    self.assertNotIn('cooldowns',data)
                with opener.open(base+'/') as response:
                    self.assertIn(b'Crypto callouts',response.read())
                    policy=response.headers['Content-Security-Policy']
                    self.assertIn("script-src 'self'",policy)
                    self.assertIn('wss://pumpportal.fun',policy)
                for script in ('/launch_feed.js','/dashboard.js'):
                    with opener.open(base+script) as response:
                        self.assertEqual(response.headers['Content-Type'],'text/javascript; charset=utf-8')
                        self.assertGreater(len(response.read()),100)
                for route in ('/live.py','/.local/live-state.json','/../config.json'):
                    with self.assertRaises(urllib.error.HTTPError) as caught:
                        opener.open(base+route)
                    self.assertEqual(caught.exception.code,404)
                with self.assertRaises(urllib.error.HTTPError) as caught:
                    opener.open(urllib.request.Request(base+'/api/status',headers={'Host':'evil.example'}))
                self.assertEqual(caught.exception.code,403)
            finally:
                server.shutdown()
                server.server_close()
                thread.join()


if __name__ == '__main__':
    unittest.main()
