<script lang="ts" setup>
	import { AppWallet, DatumUtils, ParserUtils, type UTxO } from '@hydra-sdk/core'
	import BigNumber from 'bignumber.js'

	const props = defineProps<{
		utxos: UTxO[]
	}>()

	const wallet = inject('hydraWallet') as Ref<AppWallet | null>

	const data = computed(() =>
		props.utxos
			.filter(utxo => {
				if (!utxo.output.inlineDatum) {
					return false
				}
				const datumJson = utxo.output.inlineDatum.to_json(DatumUtils.DatumSchema.Basic)
				const datumConstr = datumJson ? JSON.parse(datumJson) : null
				if (!datumConstr) {
					return false
				}
				return datumConstr.constructor === 0
			})
			.map(utxo => {
				const datumJson = utxo.output.inlineDatum?.to_json(DatumUtils.DatumSchema.Basic)
				const datumConstr = datumJson ? JSON.parse(datumJson) : null

				const amountLovelace = utxo.output.amount.find(amt => amt.unit === 'lovelace')?.quantity || 0
				const hash = datumConstr?.fields[0]?.replace('0x', '')
				const from = datumConstr?.fields[2]?.replace('0x', '')
				const to = datumConstr?.fields[3]?.replace('0x', '')
				return {
					id: `${utxo.input.txHash}#${utxo.input.outputIndex}`,
					hash: hash,
					timeout: datumConstr?.fields[1] || 0,
					from: from,
					to: to,
					amountAda: BigNumber(amountLovelace).dividedBy(1_000_000).toNumber()
				}
			})
	)

	const isYourAddress = (vkeyhash: string) => {
		if (!wallet.value) return false
		const addrVkeyhash = wallet.value.getAccount().baseAddress.payment_cred()?.to_keyhash()?.to_hex()
		return addrVkeyhash === vkeyhash
	}

	const canBeRefunded = (timeout: number) => {
		const currentTime = Date.now()
		return currentTime >= timeout + 1 * 60 * 1000 // add 1 minute buffer
	}
</script>

<template>
	<Card class="flex flex-col overflow-hidden">
		<CardHeader class="p-0">
			<CardTitle class="text-center bg-purple-500 text-white rounded-t-lg p-4"> HTLC UTXOs </CardTitle>
		</CardHeader>
		<CardContent class="flex-1 overflow-y-auto p-4 max-h-[600px]">
			<div class="space-y-4">
				<Card class="bg-muted" v-for="item in data" :key="item.id">
					<CardContent class="p-4">
						<div class="flex justify-between items-start mb-2">
							<div class="space-y-1 flex-1">
								<div class="text-xs font-mono text-muted-foreground">ID: {{ formatId(item.id, 12, 12) }}</div>
								<div class="text-sm">
									<span class="text-muted-foreground">from:</span>
									<span class="font-mono ml-1">{{ formatId(item.from) }}</span>
									<span class="text-sm text-gray-400" v-if="isYourAddress(item.from)"> (you)</span>
								</div>
								<div class="text-sm">
									<span class="text-muted-foreground">to:</span>
									<span class="font-mono ml-1">{{ formatId(item.to) }}</span>
									<span class="text-sm text-gray-400" v-if="isYourAddress(item.to)"> (you)</span>
								</div>
								<div class="text-sm">
									<span class="text-muted-foreground">amount:</span>
									<span class="font-mono ml-1">{{ item.amountAda }} ADA</span>
								</div>
								<div class="text-sm">
									<span class="text-muted-foreground">timeout:</span>
									<span class="font-mono ml-1">{{ useDateFormat(item.timeout, 'YYYY-MM-DD HH:mm:ss') }}</span>
								</div>
								<div class="text-sm">
									<span class="text-muted-foreground">hash:</span>
									<span class="font-mono ml-1">{{ formatId(item.hash, 8, 8) }}</span>
								</div>
								<div class="text-sm">
									<span class="text-muted-foreground">remaining: </span>
									<Countdown :targetTime="item.timeout" class="text-sm font-mono" />
								</div>
							</div>
							<div class="flex flex-col space-y-1">
								<RefundDialog :txHash="item.id">
									<template #trigger>
										<Button variant="default" size="sm" class="bg-orange-300 hover:bg-orange-400" v-if="isYourAddress(item.from) && canBeRefunded(item.timeout)"> Refund </Button>
									</template>
								</RefundDialog>
								<ClaimDialog :txHash="item.id">
									<template #trigger>
										<Button variant="default" size="sm" class="bg-blue-300 hover:bg-blue-400" v-if="isYourAddress(item.to)"> Claim </Button>
									</template>
								</ClaimDialog>
							</div>
						</div>
					</CardContent>
				</Card>
			</div>
		</CardContent>
	</Card>
</template>

<style lang="scss" scoped></style>
