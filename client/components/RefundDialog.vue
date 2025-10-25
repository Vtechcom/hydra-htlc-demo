<script lang="ts" setup>
	import type { HydraBridge } from '@hydra-sdk/bridge'
	import { CardanoWASM } from '@hydra-sdk/cardano-wasm'
	import { AppWallet, Converter, DatumUtils, Deserializer, SLOT_CONFIG_NETWORK, TimeUtils, type TxHash, type UTxOObject } from '@hydra-sdk/core'
	import { buildRedeemer, emptyRedeemer, TxBuilder } from '@hydra-sdk/transaction'
	import BigNumber from 'bignumber.js'
	import type { ShallowRef } from 'vue'
	import { toast } from 'vue-sonner'

	const props = defineProps<{
		txHash: string
	}>()
	const isOpen = ref(false)
	const snapshotUtxo = inject('snapshotUtxo') as ShallowRef<UTxOObject>
	const wallet = inject('hydraWallet') as Ref<AppWallet | null>
	const bridge = inject('hydraBridge') as HydraBridge
	const { htlcContract } = useConfigs()

	const loading = ref(false)

	const buildTxRefund = async () => {
		loading.value = true
		try {
			// Build the transaction for refunding the HTLC
			const txBuilder = new TxBuilder({
				isHydra: true,
				params: {
					minFeeA: 0,
					minFeeB: 0
				},
				verbose: true
			})

			const refundUtxo = Converter.convertUTxOObjectToUTxO({
				[props.txHash as TxHash]: snapshotUtxo.value[props.txHash as TxHash]
			})
			if (!refundUtxo || refundUtxo.length === 0) {
				throw new Error('UTxO not found for refund')
			} else {
				console.log('>>> / RefundDialog.vue:37 / refundUtxo:', refundUtxo)
			}
			if (!wallet.value) {
				throw new Error('Wallet not connected')
			}
			const walletAddressBech32 = wallet.value.getAccount().baseAddressBech32
			const walletUtxo = await bridge.queryAddressUTxO(walletAddressBech32)
			console.log('>>> / RefundDialog.vue:39 / walletUtxo:', walletUtxo)

			const collateral = walletUtxo.find(utxo => utxo.output.amount.some(amt => amt.unit === 'lovelace' && BigNumber(amt.quantity).gte(5_000_000)))
			if (!collateral) {
				throw new Error('No suitable collateral UTxO found in wallet')
			}

			const SLOT_CONFIG: (typeof SLOT_CONFIG_NETWORK)['PREPROD'] = {
				zeroTime: useConfigs().infraStartupTime,
				zeroSlot: 0,
				slotLength: 1000,
				epochLength: 432000,
				startEpoch: 0
			} as const

			const redeemer = CardanoWASM.Redeemer.new(
				CardanoWASM.RedeemerTag.new_spend(),
				CardanoWASM.BigNum.from_str('0'),
				DatumUtils.mkConstr(1, []), // empty redeemer
				CardanoWASM.ExUnits.new(
					CardanoWASM.BigNum.from_str('1000000'), //
					CardanoWASM.BigNum.from_str('20000000')
				)
			)

			const tx = await txBuilder
				.setInputs(walletUtxo)
				.txIn(
					refundUtxo[0].input.txHash, //
					refundUtxo[0].input.outputIndex,
					refundUtxo[0].output.amount,
					refundUtxo[0].output.address
				)
				.txInRedeemerValue(redeemer)
				.txInScript(
					htlcContract.script.cborHex,
					'V3' // version
				)
				.txInCollateral(
					collateral.input.txHash, //
					collateral.input.outputIndex,
					collateral.output.amount,
					walletAddressBech32
				)
				// .addOutput({
				// 	address: walletAddressBech32,
				// 	amount: refundUtxo[0].output.amount
				// })
				.requiredSignerHash(wallet.value.getAccount().baseAddress.payment_cred()?.to_keyhash()?.to_hex() || '')
				.changeAddress(walletAddressBech32)
				.invalidAfter(TimeUtils.unixTimeToEnclosingSlot(Date.now() + 1 * 60 * 1000, SLOT_CONFIG))
				.invalidBefore(TimeUtils.unixTimeToEnclosingSlot(Date.now() - 1 * 60 * 1000, SLOT_CONFIG))
				.complete()
			const signedTx = await wallet.value.signTx(tx.to_hex())
			console.log('Built Refund Transaction:', signedTx)
			const { txId, isConfirmed, isValid, result } = await bridge.submitTxSync({
				txId: Deserializer.deserializeTx(signedTx).transaction_hash().to_hex(),
				cborHex: signedTx,
				description: 'HTLC Refund Transaction',
				type: 'Witnessed Tx ConwayEra'
			})
			console.log('Refund Transaction Result:', { isConfirmed, isValid, result })
			toast.success(`Refund transaction submitted successfully. Tx ID: ${txId}`)
		} catch (error) {
			console.error('Error building refund transaction:', error)
			toast.error('Failed to build refund transaction.')
		} finally {
			loading.value = false
		}
	}
</script>

<template>
	<Dialog v-model:open="isOpen">
		<DialogTrigger>
			<slot name="trigger"></slot>
		</DialogTrigger>
		<DialogContent>
			<DialogHeader>
				<DialogTitle>Refund HTLC</DialogTitle>
				<DialogDescription> </DialogDescription>
			</DialogHeader>
			<div class="">
				<Button class="mt-4 w-full" variant="default" @click="buildTxRefund()" :disabled="loading">
					<Icon name="mdi:loading" size="18" class="mr-2 animate-spin" v-if="loading" />
					Confirm Refund
				</Button>
			</div>
		</DialogContent>
	</Dialog>
</template>

<style lang="scss" scoped></style>
