import { HydraBridge } from '@hydra-sdk/bridge';
import { CardanoWASM } from '@hydra-sdk/cardano-wasm';
import {
  CardanoCliWallet,
  Converter,
  DatumUtils,
  Deserializer,
  ParserUtils,
  SLOT_CONFIG_NETWORK,
  TimeUtils,
  UTxOObject,
} from '@hydra-sdk/core';
import { TxBuilder } from '@hydra-sdk/transaction';
import axios from 'axios';
import { blake2b } from 'blakejs';
import chalk from 'chalk';
import { chunk } from 'lodash-es';
import { getStartupTimeMs, htlcContract, HydraHeadConfig } from 'src/configs';

type Transaction = {
  cborHex: string;
  description: string;
  txId: string;
  type: 'Tx ConwayEra' | 'Witnessed Tx ConwayEra' | 'Unwitnessed Tx ConwayEra';
};

type HtlcContract = typeof htlcContract;

const hexToStr = (hex: string) => hex.replace(/^0x/, '');

export class HydraCrossHeadHTLC {
  private srcHeadConf: HydraHeadConfig;
  private destHeadConf: HydraHeadConfig;

  private htlcContract: HtlcContract;
  private htlcWallet: CardanoCliWallet;

  private headBridgeMap = new Map<HydraHeadConfig['name'], HydraBridge>();
  private headIdMap = new Map<string, HydraHeadConfig>();

  private snapshotUtxo = new Map<HydraHeadConfig['name'], UTxOObject>();
  private refundIntervalId?: NodeJS.Timeout;

  constructor(
    srcHeadConf: HydraHeadConfig,
    destHeadConf: HydraHeadConfig,
    htlcContract: HtlcContract,
    htlcWallet: CardanoCliWallet,
  ) {
    this.srcHeadConf = srcHeadConf;
    this.destHeadConf = destHeadConf;
    this.htlcContract = htlcContract;
    this.htlcWallet = htlcWallet;

    const srcBridge = new HydraBridge({
      url: this.srcHeadConf.wsUrl,
    });
    const destBridge = new HydraBridge({
      url: this.destHeadConf.wsUrl,
    });
    this.headBridgeMap.set(this.srcHeadConf.name, srcBridge);
    this.headBridgeMap.set(this.destHeadConf.name, destBridge);
  }

  async init() {
    this.headBridgeMap
      .get(this.srcHeadConf.name)!
      .connect()
      .then(() => {
        console.log(`${this.srcHeadConf.name}: connected to source Hydra head`);
      });
    this.headBridgeMap
      .get(this.destHeadConf.name)!
      .connect()
      .then(() => {
        console.log(
          `${this.destHeadConf.name}: connected to destination Hydra head`,
        );
      });

    // query head IDs
    const { data: srcHeadData } = await axios.get('/head', {
      baseURL: this.srcHeadConf.httpUrl,
    });
    const srcHeadId = (srcHeadData as Record<string, any>).contents
      .headId as string;
    this.headIdMap.set(srcHeadId, this.srcHeadConf);
    console.log(`Source head ID for ${this.srcHeadConf.name}: ${srcHeadId}`);

    const { data: destHeadData } = await axios.get('/head', {
      baseURL: this.destHeadConf.httpUrl,
    });
    const destHeadId = (destHeadData as Record<string, any>).contents
      .headId as string;
    this.headIdMap.set(destHeadId, this.destHeadConf);
    console.log(
      `Destination head ID for ${this.destHeadConf.name}: ${destHeadId}`,
    );

    this.initSrcWatcher();

    // Set up interval to refund timeout UTxOs every 10 seconds
    this.refundIntervalId = setInterval(() => {
      this.refundAllTimeoutUTxOs(this.destHeadConf);
    }, 10000);
  }

  initSrcWatcher() {
    const srcBridge = this.headBridgeMap.get(this.srcHeadConf.name)!;
    srcBridge.events.on('onMessage', (payload) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
      if (payload.tag === 'SnapshotConfirmed') {
        this.snapshotUtxo.set(
          this.srcHeadConf.name,
          payload.snapshot.utxo || {},
        );
        payload.snapshot.confirmed.forEach((tx) => {
          this.handleTransaction(
            this.srcHeadConf,
            this.destHeadConf,
            tx,
            payload.snapshot.utxo || {},
          );
        });
        // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
      } else if (payload.tag === 'Greetings') {
        // Handle Greetings message
        this.snapshotUtxo.set(
          this.srcHeadConf.name,
          payload.snapshotUtxo || {},
        );
      }
    });
    srcBridge
      .querySnapshotUtxo()
      .then((rs) => this.snapshotUtxo.set(this.srcHeadConf.name, rs || {}));

    const destBridge = this.headBridgeMap.get(this.destHeadConf.name)!;
    destBridge.events.on('onMessage', (payload) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
      if (payload.tag === 'SnapshotConfirmed') {
        this.snapshotUtxo.set(
          this.destHeadConf.name,
          payload.snapshot.utxo || {},
        );
        payload.snapshot.confirmed.forEach((tx) => {
          this.handleTransaction(
            this.destHeadConf,
            this.srcHeadConf,
            tx,
            payload.snapshot.utxo || {},
          );
        });
        // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
      } else if (payload.tag === 'Greetings') {
        // Handle Greetings message
        this.snapshotUtxo.set(
          this.destHeadConf.name,
          payload.snapshotUtxo || {},
        );
      }
    });
    destBridge
      .querySnapshotUtxo()
      .then((rs) => this.snapshotUtxo.set(this.destHeadConf.name, rs || {}));
  }

  async handleTransaction(
    currentHead: HydraHeadConfig,
    destinationHead: HydraHeadConfig,
    tx: Transaction,
    snapshotUtxo: UTxOObject,
  ) {
    const deserializedTx = Deserializer.deserializeTx(tx.cborHex);
    const body = deserializedTx.body();
    // const inputs = body.inputs().to_js_value();

    const outputs = body.outputs().to_js_value();

    // Check if any output is to the HTLC contract address (pusher)
    if (
      outputs.find((output) => output.address === this.htlcContract.address)
    ) {
      // Build cross-head transaction to destination head
      // only build if exist toHeadId and toAddress in metadata
      const metadata = this.extractDataFromMetadata(deserializedTx);
      if (metadata?.toHeadId && metadata?.toAddress) {
        const toHeadConf = this.headIdMap.get(metadata.toHeadId);
        if (toHeadConf && toHeadConf.name !== currentHead.name) {
          await this.buildTxPusherHtlc(
            toHeadConf,
            deserializedTx,
            metadata.toAddress,
          );
        } else {
          console.log(
            `No head configuration found for head ID: ${metadata.toHeadId}`,
          );
        }
      }
    }

    // Kiểm tra xem có phải tx claim HTLC không
    // không dùng snapshot ở đây được vì utxo đã bị spend do tx đã confirmed
    // Nếu xuất hiện tx claim tại đây (user) thì phải build tx claim tương ứng của watcher
    // Check redeemers for HTLC claim
    try {
      const redeemers = deserializedTx.witness_set().redeemers();
      const preimageJson = redeemers
        ?.get(0)
        ?.data()
        .to_json(CardanoWASM.PlutusDatumSchema.BasicConversions);
      if (!preimageJson) return;
      const preimage = JSON.parse(preimageJson)?.fields[0];
      if (preimage) {
        await this.buildTxClaimHtlc(destinationHead, preimage);
      }
    } catch (error) {
      console.error('Error checking HTLC claim redeemers:', error);
    }
  }

  async buildTxPusherHtlc(
    headConf: HydraHeadConfig,
    triggerTx: CardanoWASM.FixedTransaction,
    recipientAddress: string,
  ) {
    try {
      console.log(
        'Building pusher HTLC transaction to head:',
        chalk.green(headConf.name),
        ' to: ',
        chalk.green(recipientAddress),
      );
      const bridge = this.headBridgeMap.get(headConf.name)!;
      const htlcWalletAddr = this.htlcWallet.getAddressBech32();
      const htlcWalletUtxos = await bridge?.queryAddressUTxO(htlcWalletAddr);
      const txBuilder = new TxBuilder({
        isHydra: true,
        params: {
          minFeeA: 0,
          minFeeB: 0,
        },
      });

      const outputs = triggerTx.body().outputs();
      const lovelaceAmount = outputs
        .to_js_value()
        .find((output) => output.address === htlcContract.address)?.amount.coin;

      // Check datum
      const contractOutputIndex = outputs
        .to_js_value()
        .findIndex((output) => output.address === htlcContract.address);
      const inlineDatum = outputs.get(contractOutputIndex).plutus_data();
      if (!inlineDatum) return;
      const newDatum = this.buildNewHtlcDatum(
        inlineDatum,
        htlcWalletAddr,
        recipientAddress,
      );
      if (!newDatum) return;

      const tx = await txBuilder
        .setInputs(htlcWalletUtxos) //
        .addOutput({
          address: htlcContract.address,
          amount: [{ unit: 'lovelace', quantity: lovelaceAmount || '0' }],
        })
        .txOutInlineDatumValue(newDatum)
        .changeAddress(htlcWalletAddr)
        .complete();

      const txCborHex = tx.to_hex();
      const signedTxCborHex = await this.htlcWallet.signTx(txCborHex);
      const txId = Deserializer.deserializeTx(signedTxCborHex)
        .transaction_hash()
        .to_hex();

      const { isConfirmed } = await bridge.submitTxSync({
        txId,
        cborHex: signedTxCborHex,
        type: 'Witnessed Tx ConwayEra',
        description: `Cross-head HTLC transaction to head ${headConf.name}`,
      });
      if (isConfirmed) {
        console.log(
          `Cross-head pusher tx submitted to head ${headConf.name}: ${txId}`,
        );
      } else {
        throw new Error(`isConfirmed is false for tx ${txId}`);
      }
    } catch (error) {
      console.error('Error building pusher HTLC transaction:', error);
    }
  }

  async buildTxClaimHtlc(headConf: HydraHeadConfig, preimage: string) {
    try {
      console.log(
        `Building claim HTLC transaction on head ${headConf.name} with preimage: ${preimage}`,
      );
      const claimAddr = this.htlcWallet.getAddressBech32();
      const claimVkeyHash = CardanoWASM.Address.from_bech32(claimAddr)
        .payment_cred()
        ?.to_keyhash()
        ?.to_hex();
      const htlcHashBytes = blake2b(preimage, undefined, 32);
      const htlcHashHex = ParserUtils.bytesToHex(htlcHashBytes);

      const bridge = this.headBridgeMap.get(headConf.name)!;
      const snapshotUtxo = await bridge.querySnapshotUtxo();

      const snapshotUtxoArr = Converter.convertUTxOObjectToUTxO(
        snapshotUtxo || {},
      );
      const SLOT_CONFIG: (typeof SLOT_CONFIG_NETWORK)['PREPROD'] = {
        zeroTime: await getStartupTimeMs(),
        zeroSlot: 0,
        slotLength: 1000,
        epochLength: 432000,
        startEpoch: 0,
      } as const;

      // Find the UTxO at the HTLC contract address with matching hash in datum
      const htlcUtxoEntries = snapshotUtxoArr.filter((utxo) => {
        const data = this.extractHtlcDatum(utxo.output.inlineDatum);
        if (!data) return false;
        return (
          data.hash === htlcHashHex &&
          data.toAddr === claimVkeyHash &&
          Date.now() < data.timeout + 2 * 60 * 1000
        ); // within timeout + 2 minutes buffer
      });

      if (htlcUtxoEntries.length === 0) {
        console.log(chalk.red('No matching HTLC UTxO found'));
        return;
      } else {
        console.log(
          chalk.green(
            `Found ${htlcUtxoEntries.length} matching HTLC UTxO(s) for claim`,
          ),
        );
      }
      // Pick every 5 UTxO to claim in one transaction
      const utxoChunks = chunk(htlcUtxoEntries, 5);
      for (const utxoChunk of utxoChunks) {
        const transmitterUTxO = await bridge.queryAddressUTxO(claimAddr);
        if (transmitterUTxO.length === 0) {
          console.log(
            chalk.red('No UTxO found for HTLC wallet address: ', claimAddr),
          );
          return;
        }
        // Build claim transaction
        const txBuilder = new TxBuilder({
          isHydra: true,
          params: {
            minFeeA: 0,
            minFeeB: 0,
          },
        });
        const redeemer = CardanoWASM.Redeemer.new(
          CardanoWASM.RedeemerTag.new_spend(),
          CardanoWASM.BigNum.from_str('0'),
          DatumUtils.mkConstr(0, [
            DatumUtils.mkBytes(ParserUtils.stringToHex(preimage)), //
          ]), // claim redeemer
          CardanoWASM.ExUnits.new(
            CardanoWASM.BigNum.from_str('1000000'), //
            CardanoWASM.BigNum.from_str('20000000'),
          ),
        );
        txBuilder
          .setInputs(transmitterUTxO) //
          .txInCollateral(
            transmitterUTxO[0].input.txHash,
            transmitterUTxO[0].input.outputIndex,
            transmitterUTxO[0].output.amount,
            transmitterUTxO[0].output.address,
          );
        utxoChunk.forEach((utxo) => {
          txBuilder
            .txIn(
              utxo.input.txHash,
              utxo.input.outputIndex,
              utxo.output.amount,
              utxo.output.address,
            )
            .txInRedeemerValue(redeemer)
            .txInScript(this.htlcContract.script.cborHex, 'V3');
        });
        txBuilder
          .requiredSignerHash(claimVkeyHash!)
          .changeAddress(claimAddr)
          .invalidAfter(
            TimeUtils.unixTimeToEnclosingSlot(
              Date.now() + 1 * 60 * 1000,
              SLOT_CONFIG,
            ),
          )
          .invalidBefore(
            TimeUtils.unixTimeToEnclosingSlot(
              Date.now() - 1 * 60 * 1000,
              SLOT_CONFIG,
            ),
          );

        const tx = await txBuilder.complete();
        const txCborHex = tx.to_hex();
        const signedTxCborHex = await this.htlcWallet.signTx(txCborHex);
        const txId = Deserializer.deserializeTx(signedTxCborHex)
          .transaction_hash()
          .to_hex();

        const { isConfirmed } = await bridge.submitTxSync({
          txId,
          cborHex: signedTxCborHex,
          type: 'Witnessed Tx ConwayEra',
          description: `HTLC claim transaction on head ${headConf.name}`,
        });
        if (isConfirmed) {
          console.log(
            `HTLC claim transmitter:`,
            chalk.green('Claimed: ', htlcUtxoEntries.length),
            `tx submitted to head ${headConf.name}: ${txId}`,
          );
        } else {
          console.log(
            `HTLC claim transaction to head ${headConf.name} not confirmed yet: ${txId}`,
          );
        }
      }
    } catch (error) {
      console.error('Error building claim HTLC transaction:', error);
    }
  }

  async buildTxRefundHtlc() {
    try {
      //
    } catch (error) {
      console.error('Error building refund HTLC transaction:', error);
    }
  }

  async refundAllTimeoutUTxOs(headConf: HydraHeadConfig) {
    try {
      const bridge = this.headBridgeMap.get(headConf.name)!;

      const htlcWalletAddr = this.htlcWallet.getAddressBech32();
      const htlcWalletVkeyHash = CardanoWASM.Address.from_bech32(htlcWalletAddr)
        .payment_cred()
        ?.to_keyhash()
        ?.to_hex();
      const currentTime = Date.now();
      const snapshotUtxo = Converter.convertUTxOObjectToUTxO(
        this.snapshotUtxo.get(headConf.name) || {},
      );

      const timeoutUTxOs = snapshotUtxo.filter((utxo) => {
        if (utxo.output.address !== this.htlcContract.address) return false;
        const datum = this.extractHtlcDatum(utxo.output.inlineDatum);
        if (!datum) return false;
        return (
          currentTime > datum.timeout && datum.fromAddr === htlcWalletVkeyHash
        );
      });
      console.log(
        chalk.yellow(
          '[Cron] Checking for timeout HTLC UTxOs to refund on head: \n',
        ),
        'HEAD: ',
        chalk.green(headConf.name),
        '\n WALLET: ',
        chalk.blue(htlcWalletAddr),
        '\n CONTRACT: ',
        chalk.cyan(this.htlcContract.address),
        '\n UTxOs: ',
        chalk.yellow(snapshotUtxo.length),
        '\n REFUNDABLE: ',
        chalk.green(timeoutUTxOs.length),
        '\n DETAILS: \n   ',
        chalk.red(
          timeoutUTxOs
            .map((utxo) => `${utxo.input.txHash}#${utxo.input.outputIndex}`)
            .join('\n    ') || '---',
        ),
        '\n TIME: ',
        chalk.magenta(new Date().toLocaleTimeString()),
      );

      if (timeoutUTxOs.length === 0) return;
      const htlcWalletUtxos = snapshotUtxo.filter(
        (utxo) => utxo.output.address === htlcWalletAddr,
      );

      const txBuilder = new TxBuilder({
        isHydra: true,
        params: {
          minFeeA: 0,
          minFeeB: 0,
        },
      });
      const redeemer = CardanoWASM.Redeemer.new(
        CardanoWASM.RedeemerTag.new_spend(),
        CardanoWASM.BigNum.from_str('0'),
        DatumUtils.mkConstr(1, []), // empty redeemer
        CardanoWASM.ExUnits.new(
          CardanoWASM.BigNum.from_str('1000000'), //
          CardanoWASM.BigNum.from_str('20000000'),
        ),
      );
      const SLOT_CONFIG: (typeof SLOT_CONFIG_NETWORK)['PREPROD'] = {
        zeroTime: await getStartupTimeMs(),
        zeroSlot: 0,
        slotLength: 1000,
        epochLength: 432000,
        startEpoch: 0,
      } as const;

      txBuilder.setInputs(htlcWalletUtxos); //
      timeoutUTxOs.forEach((utxo) => {
        txBuilder
          .txIn(
            utxo.input.txHash,
            utxo.input.outputIndex,
            utxo.output.amount,
            utxo.output.address,
          )
          .txInRedeemerValue(redeemer)
          .txInScript(this.htlcContract.script.cborHex, 'V3');
      });

      txBuilder
        .txInCollateral(
          htlcWalletUtxos[0].input.txHash,
          htlcWalletUtxos[0].input.outputIndex,
          htlcWalletUtxos[0].output.amount,
          htlcWalletUtxos[0].output.address,
        )
        .changeAddress(htlcWalletAddr)
        .requiredSignerHash(htlcWalletVkeyHash!)
        .invalidAfter(
          TimeUtils.unixTimeToEnclosingSlot(
            currentTime + 1 * 60 * 1000,
            SLOT_CONFIG,
          ),
        )
        .invalidBefore(
          TimeUtils.unixTimeToEnclosingSlot(
            currentTime - 1 * 60 * 1000,
            SLOT_CONFIG,
          ),
        );

      const tx = await txBuilder.complete();
      const txCborHex = tx.to_hex();
      console.log('>>> / index.ts:557 / txCborHex:', txCborHex);

      const signedTxCborHex = await this.htlcWallet.signTx(txCborHex);
      const txId = Deserializer.deserializeTx(signedTxCborHex)
        .transaction_hash()
        .to_hex();

      const { isConfirmed } = await bridge.submitTxSync({
        txId,
        cborHex: signedTxCborHex,
        type: 'Witnessed Tx ConwayEra',
        description: `Refund timeout HTLC UTxOs on head ${headConf.name}`,
      });
      if (isConfirmed) {
        console.log(
          `Refund timeout HTLC UTxOs tx submitted to head ${headConf.name}: ${txId}`,
        );
      } else {
        throw new Error(`isConfirmed is false for tx ${txId}`);
      }
    } catch (error) {
      console.error(chalk.red('Error refunding timeout HTLC UTxOs:'), error);
    }
  }

  extractDataFromMetadata(
    tx: CardanoWASM.FixedTransaction,
  ): { toHeadId: string; toAddress: string } | null {
    try {
      const metadata = tx.auxiliary_data()?.metadata()?.to_hex();
      if (!metadata) {
        throw new Error('No metadata found in the transaction.');
      }
      const metadataJson = CardanoWASM.decode_metadatum_to_json_str(
        CardanoWASM.TransactionMetadatum.from_hex(metadata),
        CardanoWASM.MetadataJsonSchema.BasicConversions,
      );
      const metadataObj = JSON.parse(metadataJson) as Record<
        string,
        { [key: string]: unknown }
      >;
      if (!metadataObj['1']?.toHeadId) {
        throw new Error('No toHeadId found in the metadata.');
      }
      if (!metadataObj['1']?.toAddress) {
        throw new Error('No toAddress found in the metadata.');
      }
      const toHeadIdHex = metadataObj['1']?.toHeadId as string;
      const toHeadId = toHeadIdHex.replace('0x', '');
      const toAddressHex = metadataObj['1']?.toAddress as string;
      const toAddress = toAddressHex.replace('0x', '');
      const toAddressBech32 =
        CardanoWASM.Address.from_hex(toAddress).to_bech32();
      return { toHeadId, toAddress: toAddressBech32 };
    } catch (e) {
      return null;
    }
  }

  extractHtlcDatum(datum?: CardanoWASM.PlutusData | null) {
    try {
      if (!datum) return null;
      const datumJson = CardanoWASM.decode_plutus_datum_to_json_str(
        datum,
        CardanoWASM.PlutusDatumSchema.BasicConversions,
      );
      const datumObj = JSON.parse(datumJson) as Record<string, unknown>;
      /**
       * fields: [
       *  hash: bytes
       *  timeout: int
       *  from: bytes
       *  to: bytes
       * ]
       */
      const hash = hexToStr(datumObj?.fields?.[0] as string);
      const timeout = datumObj?.fields?.[1] as number;
      const fromAddr = hexToStr(datumObj?.fields?.[2] as string);
      const toAddr = hexToStr(datumObj?.fields?.[3] as string);
      if (!hash && !timeout && !fromAddr && toAddr) {
        throw new Error('Invalid datum');
      }
      return { hash, timeout, toAddr, fromAddr };
    } catch (e) {
      return null;
    }
  }

  buildNewHtlcDatum(
    currentDatum: CardanoWASM.PlutusData,
    transmitterAddress: string,
    recipientAddress: string,
  ): CardanoWASM.PlutusData | null {
    console.log(
      'Building new HTLC datum for cross-head transaction: from: ',
      transmitterAddress,
      ' to: ',
      recipientAddress,
    );
    let newDatum: CardanoWASM.PlutusData | undefined = undefined;
    if (!currentDatum) {
      console.log('No inline datum found in the triggerTx output.');
      return null;
    } else {
      // Get inline datum => set timeout lower than the HTLC deadline:
      // For demo purposes, we set it to a fixed value here.
      // In a real scenario, you would extract and adjust based on the actual HTLC datum.
      // For example, if the HTLC datum contains a deadline field, you would parse it and subtract a buffer time.
      // newDeadline = originalDeadline - bufferTime ( e.g., 5 minutes )
      const inlineDatumJson = CardanoWASM.decode_plutus_datum_to_json_str(
        currentDatum,
        CardanoWASM.PlutusDatumSchema.BasicConversions,
      );
      const inlineDatumObj = JSON.parse(inlineDatumJson) as Record<
        string,
        unknown
      >;

      if (inlineDatumObj.fields && Array.isArray(inlineDatumObj.fields)) {
        const currentDeadline = inlineDatumObj.fields[1] as number;
        const newDeadline = currentDeadline - 5 * 60 * 1000; // Subtract 5 minutes in milliseconds
        const hexToStr = (hex: string) => hex.replace(/^0x/, '');
        newDatum = DatumUtils.mkConstr(0, [
          DatumUtils.mkBytes(hexToStr(inlineDatumObj.fields[0] as string)),
          DatumUtils.mkInt(BigInt(newDeadline)),
          DatumUtils.mkBytes(this.buildVkeyHash(transmitterAddress)!),
          DatumUtils.mkBytes(this.buildVkeyHash(recipientAddress)!),
        ]);
      }
    }
    if (!newDatum) {
      console.log('Failed to create new datum for cross-head transaction.');
      return null;
    }
    return newDatum;
  }
  buildVkeyHash(bech32: string) {
    try {
      const vkeyHash = CardanoWASM.Address.from_bech32(bech32)
        ?.payment_cred()
        ?.to_keyhash()
        ?.to_hex();
      if (!vkeyHash) throw new Error('Invalid vkeyhash');
      return vkeyHash;
    } catch (e) {
      console.error('Error building vkeyhash:', e);
      return null;
    }
  }

  async cleanup() {
    // Clear refund interval
    if (this.refundIntervalId) {
      clearInterval(this.refundIntervalId);
      console.log('Cleared refund interval');
    }

    this.headBridgeMap.forEach((bridge, headName) => {
      bridge.events.all.clear();
      bridge.disconnect().then(() => {
        console.log(`Disconnected from Hydra head: ${headName}`);
      });
    });
  }
}
