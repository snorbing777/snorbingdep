import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from solders.hash import Hash
from solders.keypair import Keypair

import artwork
import narrative
import social_feed
import telegram_feed
import wallet_manage


class ArtworkTests(unittest.TestCase):
    def setUp(self):
        artwork.CACHE.clear()
        self.mint = str(Keypair().pubkey())

    def test_restricts_gateway_redirects_and_local_targets(self):
        self.assertEqual(artwork.safe_url('ipfs://QmExample'),'https://ipfs.io/ipfs/QmExample')
        for url in ('https://127.0.0.1/a','http://ipfs.io/a','https://ipfs.io.evil.example/a','https://user:secret@ipfs.io/a','https://ipfs.io:8443/a'):
            with self.assertRaises(ValueError):
                artwork.safe_url(url)
        handler=artwork.Redirects()
        with self.assertRaises(ValueError):
            handler.redirect_request(None,None,302,'',{},'https://localhost/private')

    def test_gateway_retry_cache_and_raster_only_proxy(self):
        with patch('artwork.fetch',side_effect=[OSError('gateway failed'),(b'{"image":"ipfs://QmImage"}','application/json')]) as fetch:
            result=artwork.resolve(self.mint,'https://pump.mypinata.cloud/ipfs/QmMetadata')
            self.assertEqual(result['image'],'https://ipfs.io/ipfs/QmImage')
            self.assertEqual(artwork.resolve(self.mint,'https://pump.mypinata.cloud/ipfs/QmMetadata'),result)
            self.assertEqual(fetch.call_count,2)
        with patch('artwork.fetch',return_value=(b'<html>not an image</html>','image/png')):
            with self.assertRaises(ValueError):
                artwork.image_bytes('https://ipfs.io/ipfs/QmImage')
        with patch('artwork.fetch',return_value=(b'\x89PNG\r\n\x1a\nfixture','text/plain')):
            self.assertEqual(artwork.image_bytes('https://ipfs.io/ipfs/QmImage')[1],'image/png')


class NarrativeTests(unittest.TestCase):
    def setUp(self):
        self.now=time.time()
        self.good=dict(narrative='Measured topic',observed_at=self.now,sample_complete=True,sources=['https://api.x.com/2/tweets/search/recent'],
                       mentions_5m=50,previous_mentions_5m=10,unique_authors_5m=30,engagements_5m=200)

    def test_fresh_evidence_required_and_weak_or_partial_samples_block(self):
        self.assertTrue(narrative.review('mint',{'mint':self.good},self.now)[0])
        self.assertFalse(narrative.review('mint',{},self.now)[0])
        for changes in (dict(observed_at=self.now-301),dict(observed_at=self.now+10),dict(sample_complete=False),dict(unique_authors_5m=1),dict(previous_mentions_5m=40),dict(sources=[])):
            self.assertFalse(narrative.review('mint',{'mint':self.good|changes},self.now)[0])

    def test_missing_evidence_blocks_entries_without_removing_exit_prices(self):
        candidate=dict(address='mint',price=1,eligible=True,checks={})
        with tempfile.TemporaryDirectory() as directory:
            result=narrative.enforce([candidate],{'require_narrative':True},self.now,Path(directory)/'missing.json')
        self.assertFalse(result[0]['eligible'])
        self.assertEqual(result[0]['price'],1)


class SocialTests(unittest.TestCase):
    def test_x_callouts_preserve_author_source_and_attachment_without_guessing_mint(self):
        mint=str(Keypair().pubkey())
        data={'data':[dict(id='123',author_id='42',text='Callout '+mint,created_at='2026-10-19T12:00:00Z',attachments={'media_keys':['photo']})],
              'includes':{'users':[dict(id='42',name='Unverified author',username='example')],'media':[dict(media_key='photo',url='https://pbs.twimg.com/media/photo.jpg')]}}
        post=social_feed.normalize(data)[0]
        self.assertEqual(post['mint'],mint)
        self.assertEqual(post['source_url'],'https://x.com/example/status/123')
        self.assertEqual(post['image'],'https://pbs.twimg.com/media/photo.jpg')
        data['data'][0]['text']='Only $SYMBOL, no contract'
        self.assertIsNone(social_feed.normalize(data)[0]['mint'])

    def test_telegram_only_accepts_authorized_target_updates_and_keeps_media_local(self):
        mint=str(Keypair().pubkey())
        post=dict(chat=dict(id=-1,username='BullishCallsPremium',title='Channel'),message_id=4,date=100,text=mint,photo=[dict(file_id='file')])
        loader=Mock(return_value='/api/community-image?id='+'a'*64)
        items=telegram_feed.normalize([dict(channel_post=post)],'BullishCallsPremium',loader)
        self.assertEqual(items[0]['mint'],mint)
        self.assertEqual(items[0]['image'],'/api/community-image?id='+'a'*64)
        self.assertEqual(telegram_feed.normalize([dict(channel_post=post)],'OtherChannel',loader),[])
        self.assertNotIn('token',json.dumps(items).lower())


class WithdrawalTests(unittest.TestCase):
    def test_transfer_plan_uses_exact_recipient_and_fee_without_broadcast(self):
        key=Keypair();destination=str(Keypair().pubkey())
        tx,plan=wallet_manage.transfer_plan(key,destination,100000000,Hash.default(),amount=10000000,fee_for_message=lambda _:5000)
        self.assertEqual(plan['remaining_lamports'],89995000)
        self.assertIn(destination,[str(k) for k in tx.message.account_keys])
        self.assertEqual(len(tx.message.instructions),1)
        self.assertEqual(int.from_bytes(tx.message.instructions[0].data[4:12],'little'),10000000)
        _,all_plan=wallet_manage.transfer_plan(key,destination,100000000,Hash.default(),all_funds=True,fee_for_message=lambda _:5000)
        self.assertEqual(all_plan['remaining_lamports'],0)
        with self.assertRaises(ValueError):
            wallet_manage.transfer_plan(key,destination,1000,Hash.default(),amount=1,fee_for_message=lambda _:5000)
        with self.assertRaises(ValueError):
            wallet_manage.transfer_plan(key,str(key.pubkey()),100000000,Hash.default(),amount=1,fee_for_message=lambda _:5000)

    def test_pending_trades_or_open_positions_block_withdrawals(self):
        with tempfile.TemporaryDirectory() as directory:
            state=Path(directory)/'state.json';pending=Path(directory)/'pending.json'
            state.write_text(json.dumps(dict(wallet='owner',positions={'mint':{}})))
            with patch('wallet_manage.STATE',state),patch('wallet_manage.PENDING',pending):
                with self.assertRaises(RuntimeError):
                    wallet_manage.check_ledger('owner')
                state.write_text(json.dumps(dict(wallet='owner',positions={})))
                pending.write_text('{}')
                with self.assertRaises(RuntimeError):
                    wallet_manage.check_ledger('owner')


if __name__=='__main__':
    unittest.main()
