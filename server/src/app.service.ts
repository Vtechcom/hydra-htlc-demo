import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  faucetWallet,
  htlcContract,
  HydraHeadConfig,
  hydraHeads,
} from './configs/index';
import {
  CardanoCliWallet,
  Converter,
  DatumUtils,
  Deserializer,
  NETWORK_ID,
  ParserUtils,
  TxHash,
  UTxOObject,
} from '@hydra-sdk/core';
import { HydraBridge } from '@hydra-sdk/bridge';
import { CardanoWASM } from '@hydra-sdk/cardano-wasm';
import { TxBuilder } from '@hydra-sdk/transaction';
import axios from 'axios';
import { blake2b } from 'blakejs';

type Transaction = {
  cborHex: string;
  description: string;
  txId: string;
  type: 'Tx ConwayEra' | 'Witnessed Tx ConwayEra' | 'Unwitnessed Tx ConwayEra';
};

type HtlcContract = typeof htlcContract;

const hexToStr = (hex: string) => hex.replace(/^0x/, '');
class HydraCrossHeadHTLC {
  private srcHeadConf: HydraHeadConfig;
  private destHeadConf: HydraHeadConfig;

  private htlcContract: HtlcContract;
  private htlcWallet: CardanoCliWallet;

  private headBridgeMap = new Map<HydraHeadConfig['name'], HydraBridge>();
  private headIdMap = new Map<string, HydraHeadConfig>();

  private snapshotUtxo = new Map<HydraHeadConfig['name'], UTxOObject>();

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
        console.log(`Connected to source Hydra head: ${this.srcHeadConf.name}`);
      });
    this.headBridgeMap
      .get(this.destHeadConf.name)!
      .connect()
      .then(() => {
        console.log(
          `Connected to destination Hydra head: ${this.destHeadConf.name}`,
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
  }

  initSrcWatcher() {
    this.headBridgeMap
      .get(this.srcHeadConf.name)!
      .events.on('onMessage', (payload) => {
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
    this.headBridgeMap
      .get(this.destHeadConf.name)!
      .events.on('onMessage', (payload) => {
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
  }

  async handleTransaction(
    currentHead: HydraHeadConfig,
    htlcHead: HydraHeadConfig,
    tx: Transaction,
    snapshotUtxo: UTxOObject,
  ) {
    const deserializedTx = Deserializer.deserializeTx(tx.cborHex);
    const body = deserializedTx.body();
    const inputs = body.inputs().to_js_value();

    const outputs = body.outputs().to_js_value();

    // Check if any output is to the HTLC contract address (pusher)
    if (
      outputs.find((output) => output.address === this.htlcContract.address)
    ) {
      // Build cross-head transaction to destination head
      // only build if exist toHeadId in metadata
      const toHeadId = this.extractHeadIdFromMetadata(deserializedTx);
      if (toHeadId) {
        const toHeadConf = this.headIdMap.get(toHeadId);
        if (toHeadConf && toHeadConf.name !== currentHead.name) {
          await this.buildTxPusherHtlc(toHeadConf, deserializedTx);
        } else {
          console.log(`No head configuration found for head ID: ${toHeadId}`);
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
        await this.buildTxClaimHtlc(htlcHead, preimage);
      }
    } catch (error) {
      console.error('Error checking HTLC claim redeemers:', error);
    }
  }

  async buildTxPusherHtlc(
    headConf: HydraHeadConfig,
    triggerTx: CardanoWASM.FixedTransaction,
  ) {
    try {
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
      const newDatum = this.buildNewHtlcDatum(inlineDatum);
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
      const htlcHashBytes = blake2b(preimage, undefined, 32);
      const htlcHashHex = ParserUtils.bytesToHex(htlcHashBytes);

      const snapshotUtxo = this.snapshotUtxo.get(headConf.name);

      const snapshotUtxoArr = Converter.convertUTxOObjectToUTxO(
        snapshotUtxo || {},
      );
      // Find the UTxO at the HTLC contract address with matching hash in datum
      const htlcUtxoEntries = snapshotUtxoArr.filter((utxo) => {
        return (
          this.extractHtlcHashFromDatum(utxo.output.inlineDatum) === htlcHashHex
        );
      });
      console.log(
        '>>> / app.service.ts:423 / htlcUtxoEntries:',
        htlcUtxoEntries,
      );
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

  extractHeadIdFromMetadata(tx: CardanoWASM.FixedTransaction) {
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
      const toHeadIdHex = metadataObj['1']?.toHeadId as string;
      const toHeadId = toHeadIdHex.replace('0x', '');
      return toHeadId;
    } catch (e) {
      return null;
    }
  }

  extractHtlcHashFromDatum(datum?: CardanoWASM.PlutusData | null) {
    try {
      if (!datum) return null;
      const datumJson = CardanoWASM.decode_plutus_datum_to_json_str(
        datum,
        CardanoWASM.PlutusDatumSchema.BasicConversions,
      );
      const datumObj = JSON.parse(datumJson) as Record<string, unknown>;
      return hexToStr(datumObj?.fields?.[0] as string);
    } catch (e) {
      return null;
    }
  }

  buildNewHtlcDatum(
    currentDatum?: CardanoWASM.PlutusData,
  ): CardanoWASM.PlutusData | null {
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
          DatumUtils.mkBytes(hexToStr(inlineDatumObj.fields[2] as string)),
          DatumUtils.mkBytes(hexToStr(inlineDatumObj.fields[3] as string)),
        ]);
      }
    }
    if (!newDatum) {
      console.log('Failed to create new datum for cross-head transaction.');
      return null;
    }
    return newDatum;
  }

  async cleanup() {
    this.headBridgeMap.forEach((bridge, headName) => {
      bridge.events.all.clear();
      bridge.disconnect().then(() => {
        console.log(`Disconnected from Hydra head: ${headName}`);
      });
    });
  }
}

@Injectable()
export class AppService implements OnModuleInit, OnModuleDestroy {
  private watcherWallet = new CardanoCliWallet({
    skey: faucetWallet.skey,
    vkey: faucetWallet.vkey,
    networkId: NETWORK_ID.PREPROD,
  });
  private hydraHeads = hydraHeads;
  private htlcContract = htlcContract;

  private crossHeadApis = new Map<
    (typeof hydraHeads)[number]['name'],
    {
      headId: string;
      bridge: HydraBridge;
    }
  >();

  onModuleInit() {
    console.log('AppService has been initialized.');

    // test

    // this.initListeners();
    const htlcWallet = new CardanoCliWallet({
      skey: faucetWallet.skey,
      vkey: faucetWallet.vkey,
      networkId: NETWORK_ID.PREPROD,
    });
    const hydraCrossHeadHtlc = new HydraCrossHeadHTLC(
      this.hydraHeads[0],
      this.hydraHeads[1],
      this.htlcContract,
      htlcWallet,
    );
    hydraCrossHeadHtlc
      .init()
      .then(() => {
        console.log('HydraCrossHeadHTLC initialized successfully.');
      })
      .catch((error) => {
        console.error('Error initializing HydraCrossHeadHTLC:', error);
      });
  }

  initListeners() {
    // Logic to initialize the watcher
    for (const head of this.hydraHeads) {
      void this.initWatcher(head);
    }
  }

  onModuleDestroy() {
    console.log('AppService is being destroyed.');
    // Logic to clean up resources
  }

  extractHydraPayload(message: string) {
    try {
      const payload = JSON.parse(message) as Record<string, any>;
      if (payload.tag === 'Greetings') {
        return payload;
      } else if (payload.tag === 'TxValid') {
        return {
          tag: 'TxValid',
          txId: payload.transactionId as string,
        };
      } else if (payload.tag === 'SnapshotConfirmed') {
        const snapshot = payload.snapshot as Record<string, any>;
        return {
          tag: 'SnapshotConfirmed',
          confirmed: snapshot.confirmed as Transaction[],
          utxo: snapshot.utxo as UTxOObject[],
        };
      } else {
        throw new Error('Unknown Hydra payload tag');
      }
    } catch (error) {
      console.error('Error parsing Hydra payload:', error);
      return null;
    }
  }

  async initWatcher(head: (typeof hydraHeads)[number]) {
    // Logic to initialize a watcher for a specific Hydra head
    try {
      const bridge = new HydraBridge({
        url: head.wsUrl,
      });
      await bridge.connect();

      bridge.events.on('onMessage', (payload) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
        if (payload.tag === 'SnapshotConfirmed') {
          payload.snapshot.confirmed.forEach((tx) => {
            this.handleTransaction(
              head,
              payload.snapshot.utxo || {},
              tx.cborHex,
            );
          });
        }
      });
      console.log(`Watcher initialized for Hydra head: ${head.name}`);
      const { data } = await axios.get('/head', {
        baseURL: head.httpUrl,
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const headId = (data as Record<string, any>).contents.headId as string;
      console.log('>>> / app.service.ts:120 / headId:', headId);

      this.crossHeadApis.set(head.name, {
        bridge,
        headId,
      });
    } catch (error) {
      console.error('Error initializing watcher:', error);
    }
  }
  handleTransaction(
    currentHead: (typeof hydraHeads)[number],
    snapshotUtxo: UTxOObject,
    cborHex: string,
  ) {
    const deserializedTx = Deserializer.deserializeTx(cborHex);
    const body = deserializedTx.body();
    const inputs = body.inputs().to_js_value();
    const outputs = body.outputs().to_js_value();
    if (outputs.find((output) => output.address === htlcContract.address)) {
      // Send to other heads
      void this.buildCrossHeadTx(currentHead, deserializedTx);
    }
    if (
      inputs.find(
        (input) =>
          snapshotUtxo[`${input.transaction_id}#${input.index}`].address ===
          htlcContract.address,
      )
    ) {
      // HTLC claim detected
      // Extract preimage from redeemers
      const witnesses = deserializedTx.witness_set();
      const redeemers = witnesses.redeemers();
      if (!redeemers) {
        console.log('No redeemers found in the transaction.');
        return;
      }
      // preimage is in the 2nd redeemer (index 1)
      // constructor 0 with field: [ preimage, ... ]
      const redeemer = redeemers.get(1);
      if (!redeemer) {
        console.log('No redeemer found at index 1.');
        return;
      }
      const redeemerData = redeemer.data();
      const preimage = redeemerData
        .as_constr_plutus_data()
        ?.data()
        .get(0)
        ?.as_bytes()
        ?.toString();
      if (!preimage) {
        console.log('No preimage found in the redeemer data.');
        return;
      }
      void this.buildTxClaim(
        currentHead,
        deserializedTx.transaction_hash().to_hex(),
        snapshotUtxo,
        preimage,
        this.watcherWallet,
      );
    }
  }

  async buildCrossHeadTx(
    currentHead: (typeof hydraHeads)[number],
    deserializedTx: CardanoWASM.FixedTransaction,
  ) {
    // Logic to build and submit a transaction to other Hydra heads
    const metadata = deserializedTx.auxiliary_data()?.metadata()?.to_hex();
    if (!metadata) {
      console.log('No metadata found in the transaction.');
      return;
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
      console.log('No toHeadId found in the metadata.');
      return;
    }
    const toHeadIdHex = metadataObj['1']?.toHeadId as string;
    const toHeadId = toHeadIdHex.replace('0x', '');
    if (!toHeadId) {
      console.log('No toHeadId found in the metadata.');
      return;
    }
    if (toHeadId === this.crossHeadApis.get(currentHead.name)?.headId) {
      console.log(
        'Transaction is already on the target head. No cross-head transaction needed.',
      );
      return;
    }
    this.crossHeadApis.forEach((api, headName) => {
      if (api.headId === toHeadId) {
        const toHead = this.hydraHeads.find((h) => h.name === headName);
        if (!toHead) {
          console.log(`Target head ${headName} not found.`);
          return;
        }
        void this.buildTx(toHead, deserializedTx, this.watcherWallet);
      }
    });
  }

  async buildTx(
    head: (typeof hydraHeads)[number],
    deserializedTx: CardanoWASM.FixedTransaction,
    watcherWallet: CardanoCliWallet,
  ) {
    try {
      const bridge = this.crossHeadApis.get(head.name)?.bridge;
      if (!bridge) {
        return;
      }
      const watcherWalletUTxOs = await bridge?.queryAddressUTxO(
        watcherWallet.getAddressBech32(),
      );
      const txBuilder = new TxBuilder({
        isHydra: true,
        params: {
          minFeeA: 0,
          minFeeB: 0,
        },
      });

      const outputs = deserializedTx.body().outputs();
      const lovelaceAmount = outputs
        .to_js_value()
        .find((output) => output.address === htlcContract.address)?.amount.coin;

      // Check datum
      const contractOutputIndex = outputs
        .to_js_value()
        .findIndex((output) => output.address === htlcContract.address);

      const inlineDatum = outputs.get(contractOutputIndex).plutus_data();
      let newDatum: CardanoWASM.PlutusData | undefined = undefined;
      if (!inlineDatum) {
        console.log('No inline datum found in the contract output.');
        return;
      } else {
        // Get inline datum => set timeout lower than the HTLC deadline:
        // For demo purposes, we set it to a fixed value here.
        // In a real scenario, you would extract and adjust based on the actual HTLC datum.
        // For example, if the HTLC datum contains a deadline field, you would parse it and subtract a buffer time.
        // newDeadline = originalDeadline - bufferTime ( e.g., 5 minutes )
        const inlineDatumJson = CardanoWASM.decode_plutus_datum_to_json_str(
          inlineDatum,
          CardanoWASM.PlutusDatumSchema.BasicConversions,
        );
        const inlineDatumObj = JSON.parse(inlineDatumJson) as Record<
          string,
          unknown
        >;

        if (inlineDatumObj.fields && Array.isArray(inlineDatumObj.fields)) {
          console.log(
            '>>> / app.service.ts:228 / inlineDatumObj:',
            inlineDatumObj,
          );
          const currentDeadline = inlineDatumObj.fields[1] as number;
          const newDeadline = currentDeadline - 5 * 60 * 1000; // Subtract 5 minutes in milliseconds
          const hexToStr = (hex: string) => hex.replace(/^0x/, '');
          newDatum = DatumUtils.mkConstr(0, [
            DatumUtils.mkBytes(hexToStr(inlineDatumObj.fields[0] as string)),
            DatumUtils.mkInt(BigInt(newDeadline)),
            DatumUtils.mkBytes(hexToStr(inlineDatumObj.fields[2] as string)),
            DatumUtils.mkBytes(hexToStr(inlineDatumObj.fields[3] as string)),
          ]);
        }
      }
      if (!newDatum) {
        console.log('Failed to create new datum for cross-head transaction.');
        return;
      }

      const tx = await txBuilder
        .setInputs(watcherWalletUTxOs) //
        .addOutput({
          address: htlcContract.address,
          amount: [{ unit: 'lovelace', quantity: lovelaceAmount || '0' }],
        })
        .txOutInlineDatumValue(newDatum)
        .changeAddress(watcherWallet.getAddressBech32())
        .complete();

      const txCborHex = tx.to_hex();
      const signedTxCborHex = await watcherWallet.signTx(txCborHex);
      const txId = Deserializer.deserializeTx(signedTxCborHex)
        .transaction_hash()
        .to_hex();

      const { isConfirmed } = await bridge.submitTxSync({
        txId,
        cborHex: signedTxCborHex,
        type: 'Witnessed Tx ConwayEra',
        description: `Cross-head HTLC transaction to head ${head.name}`,
      });
      if (isConfirmed) {
        console.log(
          `Cross-head transaction submitted to head ${head.name}: ${txId}`,
        );
      } else {
        console.log(
          `Cross-head transaction to head ${head.name} not confirmed yet: ${txId}`,
        );
      }
    } catch (error) {
      console.error(
        `Error building/submitting cross-head transaction to head ${head.name}:`,
        error,
      );
    }
  }

  async buildTxClaim(
    head: (typeof hydraHeads)[number],
    txHash: string,
    snapshotUtxo: UTxOObject,
    preimage: string,
    watcherWallet: CardanoCliWallet,
  ) {
    // Logic to build a claim transaction
    try {
      // Implementation of claim transaction building
      const bridge = this.crossHeadApis.get(head.name)?.bridge;
      if (!bridge) {
        return;
      }
      const snapshotUTxO = Converter.convertUTxOObjectToUTxO(snapshotUtxo);

      const watcherWalletUTxOs = snapshotUTxO.filter(
        (utxo) => utxo.output.address === watcherWallet.getAddressBech32(),
      );
      const claimUtxo = snapshotUTxO.find(
        (utxo) =>
          txHash === `${utxo.input.txHash}#${utxo.input.outputIndex}` &&
          utxo.output.address === htlcContract.address,
      );
      if (!claimUtxo) {
        console.log('No claim UTxO found for the provided transaction hash.');
        return;
      }

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

      const tx = await txBuilder
        .setInputs(watcherWalletUTxOs) //
        .txIn(
          claimUtxo.input.txHash,
          claimUtxo.input.outputIndex,
          claimUtxo.output.amount,
          claimUtxo.output.address,
        )
        .txInScript(htlcContract.script.cborHex, 'V3')
        .txInRedeemerValue(redeemer)
        .changeAddress(watcherWallet.getAddressBech32())
        .complete();

      const txCborHex = tx.to_hex();
      const signedTxCborHex = await watcherWallet.signTx(txCborHex);
      const txId = Deserializer.deserializeTx(signedTxCborHex)
        .transaction_hash()
        .to_hex();

      const { isConfirmed } = await bridge.submitTxSync({
        txId,
        cborHex: signedTxCborHex,
        type: 'Witnessed Tx ConwayEra',
        description: `HTLC claim transaction to head ${head.name}`,
      });
      if (isConfirmed) {
        console.log(
          `HTLC claim transaction submitted to head ${head.name}: ${txId}`,
        );
      } else {
        console.log(
          `HTLC claim transaction to head ${head.name} not confirmed yet: ${txId}`,
        );
      }
    } catch (error) {
      console.error('Error building claim transaction:', error);
    }
  }
}
