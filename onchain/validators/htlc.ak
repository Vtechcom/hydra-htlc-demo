use aiken/builtin.{blake2b_256}
use aiken/collection/list
use aiken/interval.{is_entirely_after, is_entirely_before}
use cardano/transaction.{OutputReference, Transaction, TransactionId}
use aiken/interval

pub type HtlcDatum {
  hash: ByteArray,
  timeout: Int,
  sender: ByteArray,
  receiver: ByteArray,
}

pub type Redeemer {
  Claim(ByteArray)
  Refund
}

fn signed_by(tx: Transaction, pkh: ByteArray) -> Bool {
  list.has(tx.extra_signatories, pkh)
}

validator htlc {
  spend(
    datum_opt: Option<HtlcDatum>,
    redeemer: Redeemer,
    _input: OutputReference,
    tx: Transaction,
  ) {
    expect Some(datum) = datum_opt

    when redeemer is {
      Claim(preimage) ->
        blake2b_256(preimage) == datum.hash && is_entirely_before(
          tx.validity_range,
          datum.timeout,
        ) && signed_by(tx, datum.receiver)
      Refund ->
        is_entirely_after(tx.validity_range, datum.timeout) && signed_by(
          tx,
          datum.sender,
        )
    }
  }

  else(_) {
    fail
  }
}

// ============ TEST DATA ============

const test_preimage = "test"
const test_hash = blake2b_256(test_preimage)
const test_sender_pkh = #"aabbccdd"
const test_receiver_pkh = #"11223344"
const test_timeout = 1000

fn mock_datum() -> HtlcDatum {
  HtlcDatum {
    hash: test_hash,
    timeout: test_timeout,
    sender: test_sender_pkh,
    receiver: test_receiver_pkh,
  }
}

fn mock_output_reference() -> OutputReference {
  OutputReference {
    transaction_id: #"", // ByteArray rỗng
    output_index: 0,
  }
}

// ============ TESTS ============

// Test 1: Claim thành công với preimage đúng, trước timeout, có chữ ký receiver
test claim_success() {
  let datum = mock_datum()
  let redeemer = Claim(test_preimage)

  trace @"test_preimage": test_preimage
  trace @"datum": datum
  
  let tx = Transaction {
    ..transaction.placeholder, // Spread operator để copy tất cả fields
    validity_range: interval.between(0, test_timeout - 1),
    extra_signatories: [test_receiver_pkh],
  }

  htlc.spend(Some(datum), redeemer, mock_output_reference(), tx)
}
