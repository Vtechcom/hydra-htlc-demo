<script lang="ts" setup>
	import type { HydraBridge } from '@hydra-sdk/bridge'
	import { CardanoWASM } from '@hydra-sdk/cardano-wasm'
	import { AppWallet, DatumUtils, Deserializer, ParserUtils } from '@hydra-sdk/core'
	import { TxBuilder } from '@hydra-sdk/transaction'
	import { blake2b } from 'blakejs'
	import { v4 as uuidv4 } from 'uuid'
	import { toast } from 'vue-sonner'

	const { htlcContract } = useConfigs()

	const form = reactive({
		recipientAddress: '',
		amountAda: 0,
		headId: '',
		preimage: '',
		htlcHash: '',
		timeout: 60 // in minutes
	})

	const bridge = inject('hydraBridge') as HydraBridge
	const wallet = inject('hydraWallet') as Ref<AppWallet | null>
	const allHeadsInfo = inject('allHeadsInfo') as Ref<
		{
			name: string
			route: string
			headId: string
			headSeed: string
			tag: string
		}[]
	>
	const currentHead = inject('currentHead') as Ref<{
		name: string
		route: string
		headId: string
		headSeed: string
		tag: string
	} | null>

	const headOptions = computed(() => {
		return allHeadsInfo.value.filter(head => head.headId !== currentHead.value?.headId)
	})

	const generatePreimage = () => {
		const randomText = uuidv4()
		form.preimage = ParserUtils.stringToHex(randomText)
	}

	watch(
		() => form.preimage,
		newPreimage => {
			const htlcHash = blake2b(newPreimage, undefined, 32)
			form.htlcHash = ParserUtils.bytesToHex(htlcHash)
		}
	)

	const getClipboardContents = async () => {
		try {
			const text = await navigator.clipboard.readText()
			return text
		} catch (error) {
			console.error('Failed to read clipboard contents: ', error)
		}
	}

	const pasteTo = async (field: keyof typeof form) => {
		const clipboardText = await getClipboardContents()
		if (clipboardText && field in form) {
			if (typeof form[field] === 'number') {
				;(form[field] as number) = isNaN(Number(clipboardText)) ? 0 : Number(clipboardText)
			} else {
				;(form[field] as string) = clipboardText
			}
		}
	}

	onMounted(() => {
		generatePreimage()
	})

	async function buildHtlcTransaction() {
		try {
			if (!wallet.value) {
				console.error('Wallet not connected')
				return
			}
			const senderAddress = wallet.value.getAccount().baseAddressBech32
			const vkeyHash = wallet.value.getAccount().baseAddress.payment_cred()?.to_keyhash()?.to_hex()
			if (!vkeyHash) {
				console.error('Failed to get verification key hash from wallet')
				return
			}

			const receiver = CardanoWASM.Address.from_bech32(form.recipientAddress).payment_cred()?.to_keyhash()?.to_hex()
			const htlcDatum = {
				hash: form.htlcHash,
				timeout: Date.now() + form.timeout * 60 * 1000, // current time + timeout in ms = 60 minutes
				sender: vkeyHash,
				receiver: receiver
			}
			console.log('HTLC Datum:', htlcDatum)
			const datum = DatumUtils.mkConstr(0, [
				DatumUtils.mkBytes(htlcDatum.hash),
				DatumUtils.mkInt(BigInt(htlcDatum.timeout)),
				DatumUtils.mkBytes(htlcDatum.sender),
				DatumUtils.mkBytes(htlcDatum.receiver!)
			])

			const senderUTxOs = await bridge.queryAddressUTxO(senderAddress)
			const txBuilder = new TxBuilder({
				isHydra: true,
				params: {
					minFeeA: 0,
					minFeeB: 0
				}
			})
			const tx = await txBuilder
				.setInputs(senderUTxOs)
				.addOutput({
					address: htlcContract.address,
					amount: [
						{
							unit: 'lovelace',
							quantity: CardanoWASM.BigNum.from_str((form.amountAda * 1e6).toString()).to_str()
						}
					]
				})
				.txOutInlineDatumValue(datum)
				.changeAddress(senderAddress)
				.metadataValue(1, {
					toHeadId: ParserUtils.toBytes(form.headId)
				})
				.complete()
			console.log('Built HTLC Transaction:', tx.to_hex())

			const signedTx = await wallet.value.signTx(tx.to_hex())
			const txId = Deserializer.deserializeTx(signedTx).transaction_hash().to_hex()
			const { isConfirmed, isValid, result } = await bridge.submitTxSync({
				txId: txId,
				cborHex: signedTx,
				description: 'HTLC Send Transaction',
				type: 'Witnessed Tx ConwayEra'
			})
			if (isConfirmed && isValid) {
				console.log('Transaction successfully submitted and confirmed:', result)
				toast.success('HTLC Transaction submitted successfully!')
			} else {
				console.error('Transaction submission failed or is invalid:', result)
				toast.error('Failed to submit HTLC Transaction.')
			}
		} catch (error) {
			console.error('Error building or submitting HTLC transaction:', error)
			toast.error('An error occurred while processing the HTLC Transaction.')
		}
	}
</script>

<template>
	<form @submit.prevent="null" class="flex-1 flex flex-col gap-4 p-4">
		<div>
			<label class="text-sm font-medium mb-2 block">Target Head</label>
			<Select>
				<SelectTrigger>
					<SelectValue placeholder="Select target head" />
				</SelectTrigger>
				<SelectContent align="end" position="popper">
					<SelectGroup>
						<SelectLabel>Hydra heads</SelectLabel>
						<SelectItem :value="head.headId" v-for="head in headOptions" :key="head.headId" @select="form.headId = head.headId" class="font-mono text-base">
							{{ head.name }} - {{ formatId(head.headId, 8, 8) }}
						</SelectItem>
					</SelectGroup>
				</SelectContent>
			</Select>
		</div>
		<div>
			<label class="text-sm font-medium mb-2 block">Recipient Address</label>
			<InputGroup>
				<InputGroupInput placeholder="Enter recipient address" v-model="form.recipientAddress" />
				<InputGroupAddon align="inline-end">
					<InputGroupButton variant="secondary" @click="pasteTo('recipientAddress')"> Paste </InputGroupButton>
				</InputGroupAddon>
			</InputGroup>
		</div>

		<div>
			<label class="text-sm font-medium mb-2 block">Amount (ADA)</label>
			<InputGroup>
				<InputGroupInput placeholder="Amount (ADA)" type="number" v-model="form.amountAda" />
				<InputGroupAddon align="inline-end">
					<InputGroupButton variant="secondary" @click="pasteTo('amountAda')"> Paste </InputGroupButton>
				</InputGroupAddon>
			</InputGroup>
		</div>

		<div>
			<label class="text-sm font-medium mb-2 block">HTLC Timeout (minutes)</label>
			<InputGroup>
				<InputGroupInput placeholder="Timeout (minutes)" type="number" v-model="form.timeout" />
				<!-- <InputGroupAddon align="inline-end">
					<InputGroupButton variant="secondary" @click="pasteTo('timeout')"> Paste </InputGroupButton>
				</InputGroupAddon> -->
			</InputGroup>
		</div>
		<div class="space-y-2">
			<div class="flex w-full justify-between items-center">
				<label class="text-sm font-medium block">HTLC Hashed</label>
				<Button variant="ghost" size="sm" class="p-0 px-1 h-auto text-primary-400" @click="generatePreimage()"> <Icon name="mdi:refresh" class="" />Generate </Button>
			</div>

			<InputGroup>
				<InputGroupAddon align="block-start">
					<InputGroupText class="text-xs">Preimage</InputGroupText>
				</InputGroupAddon>
				<InputGroupTextarea placeholder="HTLC Preimage" type="text" v-model="form.preimage" rows="3" class="break-all" />
				<InputGroupAddon align="block-end" class="justify-end">
					<InputGroupButton variant="secondary" @click="useCopy(form.preimage)"> Copy </InputGroupButton>
				</InputGroupAddon>
			</InputGroup>

			<InputGroup>
				<InputGroupInput placeholder="HTLC Hash" type="text" v-model="form.htlcHash" readonly />
				<InputGroupAddon align="inline-end">
					<InputGroupButton variant="secondary" @click="useCopy(form.htlcHash)"> Copy </InputGroupButton>
				</InputGroupAddon>
			</InputGroup>
		</div>

		<Button class="w-full mt-auto" size="lg" @click="buildHtlcTransaction()"> SEND </Button>
	</form>
</template>

<style lang="scss" scoped></style>
