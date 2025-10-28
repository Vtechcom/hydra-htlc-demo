<script lang="ts" setup>
	import type { AppWallet } from '@hydra-sdk/core'

	const props = defineProps<{
		item: {
			id: string
			hash: string
			timeout: number
			from: string
			to: string
			amountAda: number
		}
	}>()
	const wallet = inject('hydraWallet') as Ref<AppWallet | null>

	const isTimeout = computed(() => {
		return currentTime.value >= props.item.timeout
	})

	const isYourAddress = (vkeyhash: string) => {
		if (!wallet.value) return false
		const addrVkeyhash = wallet.value.getAccount().baseAddress.payment_cred()?.to_keyhash()?.to_hex()
		return addrVkeyhash === vkeyhash
	}

	const canBeRefunded = (timeout: number) => {
		return currentTime.value >= timeout + 1 * 60 * 1000 // add 1 minute buffer
	}

	const canBeClaimed = (timeout: number) => {
		return currentTime.value < timeout - 1 * 60 * 1000 // subtract 1 minute buffer
	}

	const currentTime = ref(Date.now())
	useIntervalFn(() => {
		currentTime.value = Date.now()
	}, 1000)
</script>

<template>
	<Card class="bg-muted">
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
						<span class="font-mono ml-1">
							{{ formatId(item.hash, 8, 8) }}
							<Icon name="mdi:content-copy" size="14" class="inline-block cursor-pointer -mb-0.5" @click="useCopy(item.hash)" />
						</span>
					</div>
					<div class="text-sm">
						<span class="text-muted-foreground">remaining: </span>
						<Countdown :targetTime="item.timeout" class="text-sm font-mono" :class="isTimeout && 'text-error-400'" />
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
							<Button variant="default" size="sm" class="bg-blue-300 hover:bg-blue-400" v-if="isYourAddress(item.to) && canBeClaimed(item.timeout)"> Claim </Button>
						</template>
					</ClaimDialog>
				</div>
			</div>
		</CardContent>
	</Card>
</template>

<style lang="scss" scoped></style>
