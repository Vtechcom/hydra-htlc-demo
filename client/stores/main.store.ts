import { NETWORK_ID, NETWORK_MAGIC, ProviderUtils, type UTxO } from '@hydra-sdk/core'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'

export const useMainStore = defineStore('main', () => {
	const networks = ref([
		{ name: 'MAINNET', label: 'Mainnet', networkId: NETWORK_ID.MAINNET, networkMagic: NETWORK_MAGIC.MAINNET },
		{ name: 'PREPROD', label: 'Preprod', networkId: NETWORK_ID.PREPROD, networkMagic: NETWORK_MAGIC.PREPROD },
		{ name: 'PREVIEW', label: 'Preview', networkId: NETWORK_ID.PREVIEW, networkMagic: NETWORK_MAGIC.PREVIEW }
	])
	const network = useLocalStorage<'MAINNET' | 'PREPROD' | 'PREVIEW'>('network', 'PREPROD')
	const networkInfo = computed(() => networks.value.find(n => n.name === network.value)!)
	// Wallet

	return {
		network,
		networkInfo,
		networks
	}
})
