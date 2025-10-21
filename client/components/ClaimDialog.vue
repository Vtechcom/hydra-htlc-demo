<script lang="ts" setup>
	import type { HydraBridge } from '@hydra-sdk/bridge'
	import { CardanoWASM } from '@hydra-sdk/cardano-wasm'
	import { Converter, DatumUtils, Deserializer, ParserUtils, SLOT_CONFIG_NETWORK, TimeUtils, type AppWallet, type TxHash, type UTxOObject } from '@hydra-sdk/core'
	import { TxBuilder } from '@hydra-sdk/transaction'
	import type { ShallowRef } from 'vue'
	import { toast } from 'vue-sonner'
	import BigNumber from 'bignumber.js'

	const props = defineProps<{
		txHash: string
	}>()
	const isOpen = ref(false)
	const snapshotUtxo = inject('snapshotUtxo') as ShallowRef<UTxOObject>
	const wallet = inject('hydraWallet') as Ref<AppWallet | null>
	const bridge = inject('hydraBridge') as HydraBridge
	const { htlcContract } = useConfigs()
	const loading = ref(false)

	const form = reactive({
		preimage: ''
	})

	const buildTxClaim = async () => {
		try {
			loading.value = true
			const txBuilder = new TxBuilder({
				isHydra: true,
				params: {
					minFeeA: 0,
					minFeeB: 0
				}
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
				zeroTime: 1761223746000,
				zeroSlot: 0,
				slotLength: 1000,
				epochLength: 432000,
				startEpoch: 0
			} as const

			console.log('>>> / RefundDialog.vue:69 / form.preimage:', form.preimage)
			console.log('>>> / RefundDialog.vue:69 / form.preimage:', CardanoWASM.PlutusData.new_bytes(ParserUtils.toBytes(form.preimage)).to_hex())

			const redeemer = CardanoWASM.Redeemer.new(
				CardanoWASM.RedeemerTag.new_spend(),
				CardanoWASM.BigNum.from_str('0'),
				DatumUtils.mkConstr(0, [
					DatumUtils.mkBytes(ParserUtils.stringToHex(form.preimage)) //
				]), // claim redeemer
				CardanoWASM.ExUnits.new(
					CardanoWASM.BigNum.from_str('1000000'), //
					CardanoWASM.BigNum.from_str('20000000')
				)
			)
			console.log('>>> / RefundDialog.vue:86 / redeemer:', redeemer.to_json())
			console.log('>>> / RefundDialog.vue:86 / signer hash:', wallet.value.getAccount().baseAddress.payment_cred()?.to_keyhash()?.to_hex())

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
			console.error('Error building claim transaction:', error)
			toast.error('Failed to build claim transaction.')
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
				<DialogTitle>Claim HTLC UTxO</DialogTitle>
				<DialogDescription class="text-xs"> {{ props.txHash }} </DialogDescription>
			</DialogHeader>
			<div class="">
				<InputGroup>
					<InputGroupTextarea placeholder="HTLC Preimage" type="text" v-model="form.preimage" rows="3" class="break-all" />
					<InputGroupAddon align="inline-end">
						<!-- <InputGroupButton variant="secondary" @click="useCopy(form.preimage)"> Copy </InputGroupButton> -->
					</InputGroupAddon>
				</InputGroup>
				<Button class="mt-4 w-full" variant="default" @click="buildTxClaim()" :disabled="loading || !form.preimage">
					<Icon name="mdi:loading" size="18" class="mr-2 animate-spin" v-if="loading" />
					Confirm Claim
				</Button>
			</div>
		</DialogContent>
	</Dialog>
</template>

<style lang="scss" scoped></style>
