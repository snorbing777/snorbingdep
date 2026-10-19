import copy
import unittest
from unittest.mock import Mock

from solders.keypair import Keypair
from solders.signature import Signature

import funding_check
import spending
from pump_live import MAINNET


class FundingTests(unittest.TestCase):
    def setUp(self):
        self.address=str(Keypair().pubkey())
        self.sender=str(Keypair().pubkey())
        self.signature=str(Signature.default())
        self.tx=dict(slot=123,transaction=dict(message=dict(accountKeys=[dict(pubkey=self.sender),dict(pubkey=self.address)],
            instructions=[dict(programId='11111111111111111111111111111111',parsed=dict(type='transfer',info=dict(source=self.sender,destination=self.address,lamports=100000000)))])),
            meta=dict(err=None,preBalances=[1000000000,0],postBalances=[899995000,100000000],innerInstructions=[]))

    def test_finalized_deposit_and_current_balance_are_distinct(self):
        rpc=Mock(side_effect=[MAINNET,self.tx,dict(value=30000000)])
        result=funding_check.verify(rpc,self.address,self.signature,100000000)
        self.assertTrue(result['verified'])
        self.assertFalse(result['current_balance_covers_expected_deposit'])
        self.assertEqual(result['received_sol'],.1)
        self.assertFalse(result['trade_submitted'])
        self.assertEqual([x.args[0] for x in rpc.call_args_list],['getGenesisHash','getTransaction','getBalance'])
        self.assertEqual(rpc.call_args_list[1].args[1][1]['commitment'],'finalized')
        self.assertEqual(rpc.call_args_list[2].args[1][1]['minContextSlot'],123)

    def test_wrong_recipient_or_insufficient_amount_never_verifies(self):
        wrong=str(Keypair().pubkey())
        self.assertFalse(funding_check.verify(Mock(side_effect=[MAINNET,self.tx]),wrong,self.signature)['verified'])
        result=funding_check.verify(Mock(side_effect=[MAINNET,self.tx,dict(value=1000000000)]),self.address,self.signature,200000000)
        self.assertFalse(result['verified'])

    def test_failed_pending_and_wrong_network(self):
        failed=copy.deepcopy(self.tx)
        failed['meta']['err']={'InstructionError':[0,'failure']}
        for tx in (None,failed):
            rpc=Mock(side_effect=[MAINNET,tx])
            self.assertFalse(funding_check.verify(rpc,self.address,self.signature)['verified'])
            self.assertEqual(rpc.call_count,2)
        with self.assertRaises(ValueError):
            funding_check.verify(Mock(return_value='testnet'),self.address,self.signature)

    def test_fake_program_and_same_transaction_outflow_are_rejected(self):
        fake=copy.deepcopy(self.tx)
        fake['transaction']['message']['instructions'][0]['programId']=self.sender
        self.assertFalse(funding_check.verify(Mock(side_effect=[MAINNET,fake,dict(value=100000000)]),self.address,self.signature)['verified'])
        outflow=copy.deepcopy(self.tx)
        outflow['meta']['postBalances'][1]=50000000
        self.assertFalse(funding_check.verify(Mock(side_effect=[MAINNET,outflow,dict(value=100000000)]),self.address,self.signature)['verified'])

    def test_exact_lamport_precision(self):
        self.assertEqual(funding_check.lamports('0.000000001'),1)
        for value in ('0','-1','NaN','Infinity','0.0000000001'):
            with self.assertRaises(ValueError):
                funding_check.lamports(value)


class SpendingTests(unittest.TestCase):
    def setUp(self):
        self.state=dict(cash_sol=1,positions={},daily_buy_debits_usd=0,halted=False)

    def test_total_entry_includes_worst_case_overhead(self):
        amount,cap=spending.entry_budget(self.state,150,2)
        self.assertGreater(amount,0)
        self.assertLessEqual(cap/1e9*150,2)
        self.assertLessEqual(amount+spending.MAX_OVERHEAD,cap)

    def test_insufficient_reserve_high_fees_and_pause_block_entries(self):
        for state,price,paused in ((self.state|dict(cash_sol=.01),150,False),(self.state,1000,False),(self.state,150,True),(self.state|dict(halted=True),150,False)):
            self.assertEqual(spending.entry_budget(state,price,2,paused), (0,0))

    def test_open_exposure_and_daily_turnover_caps(self):
        state=self.state|dict(positions={'a':dict(spent=5.9)})
        self.assertEqual(spending.entry_budget(state,150,2),(0,0))
        state=self.state|dict(daily_buy_debits_usd=99.9)
        self.assertEqual(spending.entry_budget(state,150,2),(0,0))

    def test_balance_changes_require_reconciliation(self):
        spending.reconcile(self.state,1000000000)
        spending.reconcile(self.state,1000000000)
        for balance in (900000000,1100000000):
            with self.assertRaises(RuntimeError):
                spending.reconcile(self.state,balance)

    def test_debit_and_fee_reserve_checked_separately(self):
        spending.verify_simulated_debit(1000000000,990000000,10000000)
        for before,after,cap in ((1000000000,980000000,10000000),(20000000,5000000,15000000),(1000000000,1000000000,10000000)):
            with self.assertRaises(RuntimeError):
                spending.verify_simulated_debit(before,after,cap)


if __name__=='__main__':
    unittest.main()
