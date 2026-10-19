import base64
import functools
import hashlib
import io
import json
import os
import tarfile
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

from solders.keypair import Keypair
from solders.pubkey import Pubkey

import artwork
import dashboard
import public_access
import public_share


class ArtworkDiscoveryTests(unittest.TestCase):
    def setUp(self):
        artwork.CACHE.clear(); artwork.IMAGE_CACHE.clear(); artwork.IMAGE_ERRORS.clear()
        self.mint = str(Keypair().pubkey())

    def test_missing_stream_uri_uses_exact_mint_pump_metadata(self):
        with patch('artwork.read_json',return_value={'mint':self.mint,'image_uri':'https://images.pump.fun/coin.png'}) as read:
            result=artwork.resolve(self.mint,'')
        self.assertEqual(result['image'],'https://images.pump.fun/coin.png')
        self.assertFalse(result['stream_uri_present'])
        self.assertEqual(read.call_args.args[0],'https://frontend-api-v3.pump.fun/coins/'+self.mint)

    def test_missing_stream_and_pump_metadata_falls_back_to_on_chain_uri(self):
        with patch('artwork.read_json',return_value={'mint':'other'}), patch('artwork.chain_uri',return_value='ipfs://fixture'), \
             patch('artwork.fetch',return_value=(b'{"image":"ipfs://image-fixture"}','application/json')):
            result=artwork.resolve(self.mint,'')
        self.assertEqual(result['image'],'https://ipfs.io/ipfs/image-fixture')
        self.assertTrue(any(a['status']=='uri_found' for a in result['attempts']))

    def test_token2022_and_metaplex_uri_decoding_and_wrong_mint_rejection(self):
        with patch('artwork.read_json',return_value={'result':{'value':{'data':{'parsed':{'info':{'extensions':[{'extension':'tokenMetadata','state':{'uri':'ipfs://token2022'}}]}}}}}}):
            self.assertEqual(artwork.chain_uri(self.mint),'ipfs://token2022')
        def metadata(mint):
            raw=bytes([4])+bytes(32)+bytes(Pubkey.from_string(mint))
            for text in ('name','SYM','ipfs://legacy'):
                raw+=len(text).to_bytes(4,'little')+text.encode()
            return {'result':{'value':{'owner':artwork.METAPLEX,'data':[base64.b64encode(raw).decode(),'base64']}}}
        with patch('artwork.read_json',side_effect=[{'result':{'value':None}},metadata(self.mint)]):
            self.assertEqual(artwork.chain_uri(self.mint),'ipfs://legacy')
        with patch('artwork.read_json',side_effect=[{'result':{'value':None}},metadata(str(Keypair().pubkey()))]):
            with self.assertRaises(ValueError): artwork.chain_uri(self.mint)

    def test_diagnostics_preserve_cause_without_rpc_credentials(self):
        import ssl
        error=urllib.error.URLError(ssl.SSLCertVerificationError(1,'secret-rpc-token'))
        with patch('artwork.read_json',side_effect=error), patch('artwork.chain_uri',side_effect=error):
            result=artwork.resolve(self.mint,'')
        self.assertIsNone(result['image']);self.assertNotIn('secret-rpc-token',json.dumps(result))
        self.assertTrue(any(a['status']=='tls_certificate_failed' for a in result['attempts']))

    def test_ipfs_subdomains_are_rewritten_without_fetching_unknown_hosts(self):
        cid='bafy'+'a'*50
        self.assertEqual(artwork.safe_url('https://'+cid+'.ipfs.untrusted.example/image.png'),'https://ipfs.io/ipfs/'+cid+'/image.png')
        self.assertEqual(artwork.safe_url('http://ipfs.io/ipfs/'+cid),'https://ipfs.io/ipfs/'+cid)
        with self.assertRaises(ValueError): artwork.safe_url('https://untrusted.example/private')

    def test_avif_raster_and_image_byte_cache(self):
        body=b'\x00\x00\x00\x20ftypavif'+bytes(20)
        with patch('artwork.fetch',return_value=(body,'application/octet-stream')) as fetch:
            self.assertEqual(artwork.image_bytes('https://images.pump.fun/avif'),(body,'image/avif'))
            self.assertEqual(artwork.image_bytes('https://images.pump.fun/avif'),(body,'image/avif'))
            self.assertEqual(fetch.call_count,1)


class SharingTests(unittest.TestCase):
    def setUp(self):
        self.password='test-only-dashboard-password'
        self.header='Basic '+base64.b64encode(('signaldesk:'+self.password).encode()).decode()
        self.checker=public_access.Password(public_access.password_config(self.password))

    def test_server_requires_authentication_and_exact_public_origin_for_post(self):
        with tempfile.TemporaryDirectory() as directory:
            server=dashboard.make_server(0,Path(directory)/'missing.json',public_origin='https://test.trycloudflare.com',password=self.checker)
            threading.Thread(target=server.serve_forever,daemon=True).start()
            base='http://127.0.0.1:'+str(server.server_port)
            opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
            try:
                for path in ('/','/api/wallet','/api/artwork?mint=test','/notification_center.js'):
                    with self.assertRaises(urllib.error.HTTPError) as caught: opener.open(base+path)
                    self.assertEqual(caught.exception.code,401)
                request=urllib.request.Request(base+'/api/health',headers={'Authorization':self.header,'Host':'test.trycloudflare.com'})
                with opener.open(request) as response:self.assertEqual(json.load(response)['version'],3)
                with patch('dashboard.manual_trading.prepare') as prepare:
                    request=urllib.request.Request(base+'/api/manual/prepare',data=b'{}',headers={'Authorization':self.header,'Host':'test.trycloudflare.com','Origin':'https://evil.example','Content-Type':'application/json'})
                    with self.assertRaises(urllib.error.HTTPError) as caught:opener.open(request)
                    self.assertEqual(caught.exception.code,403);prepare.assert_not_called()
                with patch('dashboard.manual_trading.prepare',return_value={'submitted':False}) as prepare, patch('wallet_setup.load_wallet',side_effect=ValueError('fixture missing')),patch('wallet_setup.DEFAULT_WALLET',Path(directory)/'missing-wallet'):
                    request=urllib.request.Request(base+'/api/manual/prepare',data=b'{"owner":"fixture"}',headers={'Authorization':self.header,'Origin':'https://test.trycloudflare.com','Content-Type':'application/json'})
                    with opener.open(request) as response:self.assertFalse(json.load(response)['submitted'])
                    prepare.assert_called_once()
            finally:server.shutdown();server.server_close()

    def test_origin_and_password_are_never_optional_for_public_mode(self):
        with self.assertRaises(ValueError):dashboard.make_server(0,Path('state'),public_origin='https://test.example')
        for value in ('http://test.example','https://user:password@test.example','https://test.example/path','https://test.example?secret=yes'):
            with self.assertRaises(ValueError):public_access.origin(value)
        self.assertFalse(self.checker.check('Basic invalid'))
        wrong='Basic '+base64.b64encode(b'signaldesk:wrong').decode()
        self.assertFalse(self.checker.check(wrong));self.assertTrue(self.checker.check(self.header))

    def test_password_setup_preserves_private_hashed_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'access.json'
            with patch('public_share.getpass.getpass',side_effect=[self.password,self.password]):
                header=public_share.setup_password(path)
            self.assertEqual(path.stat().st_mode&0o777,0o600)
            self.assertNotIn(self.password,path.read_text())
            self.assertTrue(public_access.load(path).check(header))
            before=path.read_bytes()
            with patch('public_share.getpass.getpass',return_value='wrong-password-for-fixture'):
                with self.assertRaises(public_share.SetupError):public_share.setup_password(path)
            self.assertEqual(path.read_bytes(),before)

    def test_dependency_download_verifies_official_digest_before_installing(self):
        stream=io.BytesIO()
        with tarfile.open(fileobj=stream,mode='w:gz') as archive:
            body=b'fixture binary, never executed';member=tarfile.TarInfo('cloudflared');member.size=len(body);archive.addfile(member,io.BytesIO(body))
        raw=stream.getvalue()
        release={'tag_name':'fixture','assets':[{'name':'cloudflared-darwin-arm64.tgz','digest':'sha256:'+hashlib.sha256(raw).hexdigest(),
                  'browser_download_url':'https://github.com/cloudflare/cloudflared/releases/download/fixture/cloudflared-darwin-arm64.tgz'}]}
        with tempfile.TemporaryDirectory() as directory,patch('public_share.shutil.which',return_value=None), \
             patch.object(public_share.sys,'platform','darwin'),patch('public_share.platform.machine',return_value='arm64'):
            home=Path(directory)
            with patch('public_share.download',side_effect=[json.dumps(release).encode(),raw]):
                binary=public_share.verified_binary(home)
            self.assertEqual(binary.read_bytes(),body);self.assertEqual(binary.stat().st_mode&0o777,0o700)
            binary.write_bytes(b'tampered')
            with self.assertRaisesRegex(public_share.SetupError,'checksum'):public_share.verified_binary(home)
        with tempfile.TemporaryDirectory() as directory,patch('public_share.shutil.which',return_value=None), \
             patch.object(public_share.sys,'platform','darwin'),patch('public_share.platform.machine',return_value='arm64'), \
             patch('public_share.download',side_effect=[json.dumps(release).encode(),b'wrong archive']):
            with self.assertRaisesRegex(public_share.SetupError,'checksum'):public_share.verified_binary(Path(directory))
            self.assertFalse((Path(directory)/'.config/snorbingdep/bin/cloudflared').exists())


if __name__=='__main__':unittest.main()
