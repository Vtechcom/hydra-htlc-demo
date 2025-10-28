<script lang="ts" setup>
	import { AppWallet, DatumUtils, ParserUtils, type UTxO } from '@hydra-sdk/core'
	import BigNumber from 'bignumber.js'

	const props = defineProps<{
		utxos: UTxO[]
	}>()

	const data = computed(() => {
		const items = props.utxos
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
		return [...items].sort((a, b) => b.timeout - a.timeout)
	})

	const queryStr = ref('')
	const queryData = shallowRef(data.value)

	const search = useDebounceFn((queryStr: string) => {
		if (!queryStr) {
			queryData.value = data.value
			return
		}
		const qLower = queryStr.toLowerCase()
		queryData.value = data.value.filter(item => item.hash.toLowerCase().includes(qLower))
	}, 300)

	watchEffect(() => {
		search(queryStr.value)
	})

	watch(
		() => props.utxos,
		() => {
			search(queryStr.value)
		},
		{
			deep: true
		}
	)
</script>

<template>
	<Card class="flex flex-col overflow-hidden">
		<CardHeader class="p-0">
			<CardTitle class="text-center bg-purple-500 text-white rounded-t-lg p-4"> HTLC UTXOs ({{ queryData.length }}) </CardTitle>
		</CardHeader>
		<CardContent class="flex-1 overflow-y-auto p-4 max-h-[630px]">
			<div class="">
				<InputGroup class="mb-4">
					<InputGroupInput placeholder="Search by HTLC hash" v-model="queryStr" />
					<InputGroupAddon align="inline-end">
						<Icon name="mdi:magnify" />
					</InputGroupAddon>
				</InputGroup>
			</div>
			<div class="space-y-4" v-if="queryData.length > 0">
				<HtlcUtxoItem v-for="item in queryData" :key="item.id" :item="item" />
			</div>
			<div v-else class="text-center text-gray-500">No HTLC UTXOs found.</div>
		</CardContent>
	</Card>
</template>

<style lang="scss" scoped></style>
