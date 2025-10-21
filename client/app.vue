<script lang="ts" setup>
	import { Toaster } from '@/components/ui/sonner'
	import 'vue-sonner/style.css'

</script>

<template>
	<NuxtLoadingIndicator color="#a855f7" :height="2" />
	<NuxtLayout>
		<NuxtPage />
	</NuxtLayout>
	<Toaster rich-colors />
</template>

<style lang="scss" scoped></style>
