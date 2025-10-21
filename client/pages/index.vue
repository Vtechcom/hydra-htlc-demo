<script setup lang="ts">
	import { HydraBridge } from '@hydra-sdk/bridge'
	import { toast } from 'vue-sonner'

	const { hydraHeads } = useConfigs()
	const hydraHeadInfos = ref<
		Array<{
			name: string
			route: string
			headId: string
			headSeed: string
			tag: string
		}>
	>([])

	// get hydra head info
	onMounted(async () => {
		for (const head of hydraHeads) {
			useAxios(head.httpUrl)
				.get('/head')
				.then(res => {
					if (!res.data.tag) {
						toast.error(`Hydra Head ${head.name} is not initialized properly.`)
						return
					}
					if (res.data.tag !== 'Open') {
						toast.error(`Hydra Head ${head.name} is not opened.`)
						return
					}

					hydraHeadInfos.value.push({
						name: head.name,
						route: head.route,
						headId: res.data.contents.headId,
						headSeed: res.data.contents.headSeed,
						tag: res.data.tag
					})
				})
		}
	})
</script>
<template>
	<div class="container mx-auto p-6 max-w-4xl">
		<div class="flex w-full items-center justify-center">
			<div class="flex items-center space-x-3">
				<Card class="" v-for="head in hydraHeadInfos" :key="head.name">
					<CardContent class="flex p-4 flex-col items-center space-y-4">
						<p class="text-base">
							{{ head.name }}
						</p>
						<div class="">
							<div class="text-base text-gray-500">Head ID: {{ formatId(head.headId) }}</div>
							<div class="text-base text-gray-500">Head Seed: {{ formatId(head.headSeed) }}</div>
							<div class="text-base text-gray-500">
								Status:
								<span class="" :class="{ 'text-success-500': head.tag === 'Open' }">
									{{ head.tag }}
								</span>
							</div>
						</div>

						<Button size="default" variant="default" class="w-full" as="a" :href="head.route"> Join </Button>
					</CardContent>
				</Card>
			</div>
		</div>
	</div>
</template>

<style scoped>
	.container {
		min-height: 100vh;
	}
</style>
