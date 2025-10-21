<script lang="ts" setup>
	import type { HydraBridge } from '@hydra-sdk/bridge'
	import { CardanoWASM } from '@hydra-sdk/cardano-wasm'
	import { Deserializer, NETWORK_ID } from '@hydra-sdk/core'
	import { TxBuilder } from '@hydra-sdk/transaction'
	import { toast } from 'vue-sonner'

	const props = defineProps<{
		recipientAddress: string
	}>()
	const emits = defineEmits<{
		(event: 'success'): void
	}>()

	const { faucetWallet } = useConfigs()

	const bridge = inject('hydraBridge') as HydraBridge
	const loading = ref(false)
	const isOpen = ref(false)

	async function buildTx() {
		try {
			loading.value = true
			if (!bridge) {
				throw new Error('Hydra Bridge not available')
			}
			if (bridge.connected() === false) {
				throw new Error('Hydra Bridge not connected')
			}

			// Faucet wallet setup
			const ed25519Skey = CardanoWASM.PrivateKey.from_hex(faucetWallet.skey.slice(4))
			const ed25519Vkey = CardanoWASM.PublicKey.from_hex(faucetWallet.vkey.slice(4))

			console.log('>>> / [headRoute].vue:80 / ed25519Skey:', CardanoWASM.Credential.from_keyhash(ed25519Vkey.hash()).to_hex())
			const enterpriseAddr = CardanoWASM.EnterpriseAddress.new(NETWORK_ID.PREPROD, CardanoWASM.Credential.from_keyhash(ed25519Vkey.hash())).to_address()
			const enterpriseAddrBech32 = enterpriseAddr.to_bech32()
			const utxos = await bridge.queryAddressUTxO(enterpriseAddrBech32)
			console.log('>>> / RequestFaucetDialog.vue:33 / utxos:', utxos)

			// Build transaction
			const txBuilder = new TxBuilder({
				isHydra: true,
				params: {
					minFeeA: 0,
					minFeeB: 0
				}
			})
			// Further transaction building steps would go here
			const unsignedTx = await txBuilder
				.setInputs(utxos)
				.addLovelaceOutput(props.recipientAddress, '100000000') // 100 ADA
				.setChangeAddress(enterpriseAddrBech32)
				.complete()
			console.log('>>> / RequestFaucetDialog.vue:48 / tx:', unsignedTx.to_hex())
			// Sign transaction
			const tx = Deserializer.deserializeTx(unsignedTx.to_hex())
			tx.sign_and_add_vkey_signature(ed25519Skey)
			const signedTxHex = tx.to_hex()
			console.log('>>> / RequestFaucetDialog.vue:54 / signedTxHex:', signedTxHex)

			// Submit transaction
			const { isConfirmed, result } = await bridge.submitTxSync({
				type: 'Witnessed Tx ConwayEra',
				description: 'Faucet request transaction',
				cborHex: signedTxHex,
				txId: tx.transaction_hash().to_hex()
			})
			if (isConfirmed) {
				toast.success('Faucet request transaction confirmed!')
			} else {
				toast.error('Faucet request transaction failed to confirm.')
			}
			console.log('>>> / RequestFaucetDialog.vue:66 / result:', result)
			isOpen.value = false
			emits('success')
		} catch (error) {
			console.error('Error requesting from faucet:', error)
			toast.error(`Error requesting from faucet: ${(error as Error).message}`)
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
				<DialogTitle>Get 100 ADA from faucet</DialogTitle>
				<DialogDescription> </DialogDescription>
			</DialogHeader>
			<div class="">
				<label class="mb-2 block text-sm font-medium">Recipient Address</label>
				<Input label="Your Address" placeholder="addr1..." readonly :model-value="formatId(props.recipientAddress, 15, 15)" />

				<Button class="mt-4 w-full" variant="default" @click="buildTx()" :disabled="loading">
					<Icon name="mdi:loading" size="18" class="mr-2 animate-spin" v-if="loading" />
					Request from Faucet
				</Button>
			</div>
		</DialogContent>
	</Dialog>
</template>

<style lang="scss" scoped></style>
