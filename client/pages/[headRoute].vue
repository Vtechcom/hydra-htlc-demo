<script lang="ts" setup>
	import { HydraBridge } from '@hydra-sdk/bridge'
	import { CardanoWASM } from '@hydra-sdk/cardano-wasm'
	import { AppWallet, Converter, Deserializer, EmbeddedWallet, NETWORK_ID, type UTxO, type UTxOObject } from '@hydra-sdk/core'
	import { toast } from 'vue-sonner'
	import { cn } from '~/lib/utils'
	import BigNumber from 'bignumber.js'

	const route = useRoute()
	const headRoute = route.params['headRoute'] as string

	const { hydraHeads, htlcContract } = useConfigs()
	const headConfig = hydraHeads.find(head => head.route === headRoute)!
	const hydraHeadInfo = ref<{
		name: string
		route: string
		headId: string
		headSeed: string
		tag: string
	} | null>(null)

	if (!headConfig) {
		toast.error(`Hydra Head configuration for ${headRoute} not found.`)
		navigateTo('/')
	} else {
		useAxios(headConfig.httpUrl)
			.get('/head')
			.then(res => {
				if (!res.data.tag) {
					toast.error(`Hydra Head ${headConfig.name} is not initialized properly.`)
					return
				}
				if (res.data.tag !== 'Open') {
					toast.error(`Hydra Head ${headConfig.name} is not opened.`)
					return
				}

				hydraHeadInfo.value = {
					name: headConfig.name,
					route: headConfig.route,
					headId: res.data.contents.headId,
					headSeed: res.data.contents.headSeed,
					tag: res.data.tag
				}
			})
	}

	// Get all heads info for sidebar and selection
	const allHeadsInfo = ref<
		Array<{
			name: string
			route: string
			headId: string
			headSeed: string
			tag: string
		}>
	>([])

	const mnemonicInput = ref('')
	const wallet = ref<AppWallet | null>(null)
	const walletRootkeyBech32 = useSessionStorage(`head-wallet-${headConfig.route}`, '')

	const walletAddressBech32 = ref('')
	const bridge = new HydraBridge({
		url: headConfig.httpUrl
	})

	const snapshotUtxo = shallowRef<UTxOObject>({})
	const htlcUtxos = computed<Array<UTxO>>(() => {
		const utxo = Object.entries(snapshotUtxo.value)
			.filter(([txHash, obj]) => {
				return obj.address === htlcContract.address
			})
			.map(([txHash, obj]) => {
				return Converter.convertUTxOObjectToUTxO({ [txHash]: obj })
			})
			.flat()
		return utxo
	})

	provide('hydraBridge', bridge)
	provide('hydraWallet', wallet)
	provide('snapshotUtxo', snapshotUtxo)
	provide('allHeadsInfo', allHeadsInfo)

	onMounted(() => {
		try {
			// Get all heads info for sidebar and selection
			for (const head of hydraHeads) {
				useAxios(head.httpUrl)
					.get('/head')
					.then(res => {
						if (res.data.tag) {
							allHeadsInfo.value.push({
								name: head.name,
								route: head.route,
								headId: res.data.contents.headId,
								headSeed: res.data.contents.headSeed,
								tag: res.data.tag
							})
						}
					})
			}

			// Placeholder for any future onMounted logic
			if (walletRootkeyBech32.value) {
				const walletInstance = new AppWallet({
					key: {
						type: 'root',
						bech32: walletRootkeyBech32.value
					},
					networkId: NETWORK_ID.PREPROD
				})
				onWalletConnected(walletInstance)
			}

			bridge.connect().then(res => {
				console.log(`Connected to Hydra Head: ${headConfig.name}`)
			})
			bridge.events.on('onMessage', onMessageHandler)
		} catch (error) {
			console.error('Error converting private key to bech32:', error)
		}
	})

	onUnmounted(() => {
		bridge.events.off('onMessage', onMessageHandler)
		bridge.disconnect().then(() => {
			console.log(`Disconnected from Hydra Head: ${headConfig.name}`)
		})
	})

	function onMessageHandler(message: any) {
		if (message.tag === 'SnapshotConfirmed') {
			snapshotUtxo.value = message.snapshot.utxo || {}
			triggerRef(snapshotUtxo)
		} else if (message.tag === 'Greetings') {
			snapshotUtxo.value = message.snapshotUtxo || {}
			triggerRef(snapshotUtxo)
		}
	}

	const connectWallet = () => {
		try {
			const walletInstance = new AppWallet({
				key: {
					type: 'mnemonic',
					words: mnemonicInput.value.trim().split(' ')
				},
				networkId: NETWORK_ID.PREPROD
			})
			onWalletConnected(walletInstance)

			const privateKeyHex = EmbeddedWallet.mnemonicToPrivateKeyHex(mnemonicInput.value.trim().split(' '))
			walletRootkeyBech32.value = EmbeddedWallet.privateKeyHexToBech32(privateKeyHex)

			toast.success('Wallet connected successfully.')
		} catch (error) {
			toast.error('Failed to connect wallet. Please check your mnemonic.')
		}
	}
	const disconnectWallet = () => {
		wallet.value = null
		walletRootkeyBech32.value = ''
		walletAddressBech32.value = ''
		mnemonicInput.value = ''
		toast.success('Wallet disconnected successfully.')
	}

	const walletInfo = reactive({
		lovelace: 0
	})
	async function onWalletConnected(appWallet: AppWallet) {
		wallet.value = appWallet
		walletAddressBech32.value = appWallet.getAccount().baseAddressBech32
		refreshWalletInfo()
	}

	async function refreshWalletInfo() {
		try {
			const walletUTxOs = await bridge.queryAddressUTxO(walletAddressBech32.value)
			console.log('Fetched UTXOs:', walletUTxOs)
			const totalBalance = walletUTxOs.reduce((sum, utxo) => {
				const adaAmount = utxo.output.amount.find(a => a.unit === 'lovelace')
				return sum + (adaAmount ? parseInt(adaAmount.quantity) : 0)
			}, 0)
			walletInfo.lovelace = totalBalance
		} catch (error) {
			console.error('Error fetching wallet UTXOs:', error)
			toast.error('Failed to fetch wallet information.')
		}
	}
</script>

<template>
	<div class="flex bg-background">
		<!-- Sidebar - Hydra Heads List -->
		<aside class="w-48 border-r border-border bg-card p-4 flex flex-col gap-3">
			<Button variant="outline" class="w-full justify-start" @click="navigateTo('/')"> All heads </Button>

			<Button
				v-for="head in hydraHeads"
				:key="head.route"
				:variant="head.route === headRoute ? 'default' : 'outline'"
				class="w-full justify-start"
				@click="navigateTo(`/${head.route}`)"
			>
				{{ head.name }}
			</Button>
		</aside>

		<!-- Main Content Area -->
		<div class="flex-1 flex flex-col">
			<!-- Header -->
			<header class="border-b border-border bg-card px-6 py-4">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-4">
						<div class="text-sm text-muted-foreground">
							<p class="">{{ headConfig?.name }}</p>
							<p v-if="hydraHeadInfo" class="font-mono">ID: {{ formatId(hydraHeadInfo.headId) }}</p>
							<p v-if="hydraHeadInfo" class="font-mono">Seed: {{ formatId(hydraHeadInfo.headSeed) }}</p>
						</div>
					</div>
					<div class="flex items-center justify-end space-x-2" v-if="wallet">
						<div class="text-sm text-muted-foreground font-mono flex flex-col items-end">
							<span class="text-sm font-medium text-gray-900">
								<Icon name="mdi:content-copy" size="14" class="mr-0.5 -mb-0.5 cursor-pointer" @click="useCopy(walletAddressBech32)" />{{ formatId(walletAddressBech32, 12, 12) }}
							</span>
							<span class="text-sm font-medium flex items-center space-x-2">
								<Icon name="mdi:checkbox-multiple-blank-circle-outline" size="18" class="text-muted-foreground" />
								<span class="">{{ BigNumber(walletInfo.lovelace).div(1e6).toFormat() }} ADA</span>
								<RequestFaucetDialog :recipientAddress="walletAddressBech32" @success="refreshWalletInfo()">
									<template #trigger>
										<Icon name="mdi:plus-circle" size="18" class="text-success-500 cursor-pointer" />
									</template>
								</RequestFaucetDialog>
							</span>
						</div>

						<div class="flex">
							<DropdownMenu>
								<DropdownMenuTrigger as-child>
									<Icon name="mdi:account-circle" size="40" class="text-muted-foreground" />
								</DropdownMenuTrigger>

								<DropdownMenuContent class="w-56" align="end">
									<DropdownMenuLabel>My Account</DropdownMenuLabel>
									<DropdownMenuSeparator />
									<DropdownMenuGroup>
										<DropdownMenuItem @click="disconnectWallet()">
											<Icon name="mdi:logout" class="rotate-180" size="16" />
											<span>Disconnect wallet</span>
										</DropdownMenuItem>
									</DropdownMenuGroup>
									<DropdownMenuSeparator />
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					</div>
					<div class="flex items-center" v-else>
						<DropdownMenu>
							<DropdownMenuTrigger as-child>
								<Button variant="outline" size="sm"> Connect Wallet <Icon name="mdi:wallet" class="ml-1" size="16" /></Button>
							</DropdownMenuTrigger>

							<DropdownMenuContent class="w-56" align="end">
								<DropdownMenuLabel>Mnemonic</DropdownMenuLabel>
								<DropdownMenuGroup>
									<InputGroup>
										<!-- <InputGroupAddon align="block-start">
											<InputGroupText class="text-xs">Mnemonic</InputGroupText>
										</InputGroupAddon> -->
										<InputGroupTextarea class="!text-xs" autocomplete="off" type="text" name="mnemonic" placeholder="Input mnemonic" v-model="mnemonicInput" />
										<InputGroupAddon align="block-end" class="space-y-0.5 flex flex-col">
											<div class="text-red-500 text-[10px]">{{}}</div>
											<div class="flex justify-between w-full">
												<InputGroupButton variant="outline" @click="mnemonicInput = ''" class="text-xs" :disabled="!mnemonicInput"> Clear </InputGroupButton>
												<InputGroupButton variant="secondary" @click="mnemonicInput = AppWallet.brew().join(' ')" class="text-xs" :disabled="!!mnemonicInput"> Generate </InputGroupButton>
											</div>
										</InputGroupAddon>
									</InputGroup>
									<DropdownMenuSeparator />
									<DropdownMenuItem @click="connectWallet()" :disabled="!mnemonicInput">
										<Icon name="mdi:login-variant" class="" size="16" />
										<span>Login</span>
									</DropdownMenuItem>
								</DropdownMenuGroup>
								<DropdownMenuSeparator />
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</div>
			</header>

			<!-- Content Grid -->
			<div class="flex-1 grid grid-cols-2 gap-6 p-6 overflow-hidden">
				<!-- Left Panel - HTLC Sender Form -->
				<Card class="flex flex-col">
					<CardHeader class="p-0 -m-[1px]">
						<CardTitle class="text-center bg-purple-500 text-white py-8 rounded-t-lg"> SENDER </CardTitle>
					</CardHeader>
					<CardContent class="flex-1 flex flex-col gap-4 p-4">
						<FormHtlcSender />
					</CardContent>
				</Card>

				<!-- Right Panel - HTLC UTXOs List -->
				<HtlcUtxos :utxos="htlcUtxos" />
			</div>
		</div>
	</div>
</template>

<style lang="scss" scoped></style>
