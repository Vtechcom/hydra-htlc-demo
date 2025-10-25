<script lang="ts" setup>
	const props = defineProps<{
		targetTime: string | number
		onTimeout?: () => void
		updateInterval?: number
		formatPattern?: string
	}>()

	const timeLeft = ref<number>(5000)
	let intervalId: number | null = null
	const calculateTimeLeft = () => {
		const now = new Date().getTime()
		const target = new Date(props.targetTime).getTime()
		timeLeft.value = Math.max(0, target - now)
		if (timeLeft.value === 0 && props.onTimeout) {
			props.onTimeout()
			if (intervalId) {
				clearInterval(intervalId)
			}
		}
	}
	onMounted(() => {
		calculateTimeLeft()
		intervalId = window.setInterval(calculateTimeLeft, props.updateInterval || 1000)
	})
	onUnmounted(() => {
		if (intervalId) {
			clearInterval(intervalId)
		}
	})

	const timeLeftFormatted = computed(() => {
		const totalSeconds = Math.floor(timeLeft.value / 1000)
		const hours = Math.floor(totalSeconds / 3600)
		const minutes = Math.floor((totalSeconds % 3600) / 60)
		const seconds = totalSeconds % 60
		return {
			hh: String(hours).padStart(2, '0'),
			mm: String(minutes).padStart(2, '0'),
			ss: String(seconds).padStart(2, '0')
		}
	})
</script>

<template>
	<span>{{ timeLeftFormatted.hh }}:{{ timeLeftFormatted.mm }}:{{ timeLeftFormatted.ss }}</span>
</template>

<style lang="scss" scoped></style>
