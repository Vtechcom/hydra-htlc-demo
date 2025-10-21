import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { faucetWallet, htlcContract, hydraHeads } from './configs/index';
import {
  CardanoCliWallet,
  DatumUtils,
  Deserializer,
  NETWORK_ID,
  ParserUtils,
  UTxOObject,
} from '@hydra-sdk/core';
import { HydraBridge } from '@hydra-sdk/bridge';
import { CardanoWASM } from '@hydra-sdk/cardano-wasm';
import { TxBuilder } from '@hydra-sdk/transaction';
import axios from 'axios';

type Transaction = {
  cborHex: string;
  description: string;
  txId: string;
  type: 'Tx ConwayEra' | 'Witnessed Tx ConwayEra' | 'Unwitnessed Tx ConwayEra';
};

type HtlcContract = typeof htlcContract;

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
      submitTx: (txCborHex: string) => Promise<string>;
    }
  >();

  onModuleInit() {
    console.log('AppService has been initialized.');

    this.initListeners();
  }

  initListeners() {
    // Logic to initialize the watcher
    for (const head of this.hydraHeads) {
      void this.initWatcher(head, this.watcherWallet, this.htlcContract);
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

  async initWatcher(
    head: (typeof hydraHeads)[number],
    watcherWallet: CardanoCliWallet,
    htlcContract: HtlcContract,
  ) {
    // Logic to initialize a watcher for a specific Hydra head
    try {
      const bridge = new HydraBridge({
        url: head.wsUrl,
      });
      await bridge.connect();

      bridge.events.on('onMessage', (payload) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
        if (payload.tag === 'SnapshotConfirmed') {
          const deserializedTx = Deserializer.deserializeTx(
            payload.snapshot.confirmed[0].cborHex,
          );
          const outputs = deserializedTx.body().outputs().to_js_value();
          if (
            outputs.find((output) => output.address === htlcContract.address)
          ) {
            console.log('Watched output found:', outputs);
            // Send to other heads
            void this.buildCrossHeadTx(head, deserializedTx);
          }
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
        submitTx: async (txCborHex: string) => {
          const deserializedTx = Deserializer.deserializeTx(txCborHex);
          const txId = deserializedTx.transaction_hash().to_hex();
          const { isConfirmed, isValid } = await bridge.submitTxSync({
            cborHex: txCborHex,
            description: `Submitted by watcher for head ${head.name}`,
            txId,
            type: 'Witnessed Tx ConwayEra',
          });
          if (!isConfirmed) {
            throw new Error(`Transaction ${txId} was not confirmed.`);
          }
          if (!isValid) {
            throw new Error(`Transaction ${txId} is not valid.`);
          }
          return txId;
        },
        headId,
      });
    } catch (error) {
      console.error('Error initializing watcher:', error);
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
      if (!inlineDatum) {
        console.log('No inline datum found in the contract output.');
        return;
      }
      const tx = await txBuilder
        .setInputs(watcherWalletUTxOs) //
        .addOutput({
          address: htlcContract.address,
          amount: [{ unit: 'lovelace', quantity: lovelaceAmount || '0' }],
        })
        .txOutInlineDatumValue(inlineDatum)
        .changeAddress(watcherWallet.getAddressBech32())
        .complete();

      const txCborHex = tx.to_hex();
      const signedTxCborHex = await watcherWallet.signTx(txCborHex);

      const submitTx = this.crossHeadApis.get(head.name)?.submitTx;
      if (!submitTx) {
        return;
      }
      const txId = await submitTx(signedTxCborHex);
      console.log(
        `Cross-head transaction submitted to head ${head.name}: ${txId}`,
      );
    } catch (error) {
      console.error(
        `Error building/submitting cross-head transaction to head ${head.name}:`,
        error,
      );
    }
  }
}
