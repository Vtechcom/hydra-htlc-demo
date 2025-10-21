<script lang="ts" setup>
	import { version } from '../../package.json'
	import { Button } from '../ui/button'

	const props = defineProps<{
		containerClass?: string
	}>()

	const uiStore = useUiStore()
</script>

<template>
	<header class="z-50 border-b border-gray-200 bg-white-50 backdrop-blur-sm dark:border-gray-800 dark:bg-black-900 dark:bg-gray-900/80">
		<div class="mx-auto px-4" :class="props.containerClass">
			<div class="flex h-16 items-center justify-between">
				<!-- Logo and Title -->
				<div class="flex items-center space-x-4">
					<!-- Mobile Sidebar -->

					<NuxtLink :to="'/'" class="group flex items-center space-x-3">
						<img src="/logo-sdk.png" alt="SDK Logo" srcset="/logo-sdk.png" class="size-10" />
						<div class="hidden sm:block">
							<h1 class="text-lg font-semibold text-gray-600 transition-colors group-hover:text-blue-600 dark:text-gray-300 dark:group-hover:text-blue-400">Hydra HTLC</h1>
							<p class="-mt-0.5 text-xs text-gray-600 dark:text-gray-300">Demo HTLC v{{ version }}</p>
						</div>
					</NuxtLink>
				</div>

				<!-- Right side actions -->
				<div class="flex items-center space-x-4">
					<!-- Search -->
					<!-- <UiDialogSearch v-model:open="openDialogSearch"> </UiDialogSearch> -->

					<!-- GitHub Link -->
					<NuxtLink class="flex" target="_blank" to="https://github.com/Vtechcom/hydra-sdk">
						<Icon name="mdi:github" size="24" />
					</NuxtLink>
				</div>
			</div>
		</div>
	</header>
</template>

<style lang="scss" scoped>
	.slide-fade-enter-active {
		@apply transition-all duration-300 ease-out;
	}
	.slide-fade-leave-active {
		@apply transition-all duration-200 ease-in;
	}
	.slide-fade-enter-from {
		@apply -translate-y-2 opacity-0;
	}
	.slide-fade-enter-to {
		@apply translate-y-0 opacity-100;
	}
	.slide-fade-leave-from {
		@apply translate-y-0 opacity-100;
	}
	.slide-fade-leave-to {
		@apply -translate-y-2 opacity-0;
	}
</style>
