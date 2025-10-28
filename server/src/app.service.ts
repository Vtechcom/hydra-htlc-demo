import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  faucetWallet,
  getStartupTimeMs,
  htlcContract,
  hydraHeads,
} from './configs/index';
import { CardanoCliWallet, NETWORK_ID } from '@hydra-sdk/core';
import { HydraBridge } from '@hydra-sdk/bridge';
import { HydraCrossHeadHTLC } from './hydra-htlc';

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

  async onModuleInit() {
    console.log('AppService has been initialized.');
    console.log('Starting HydraCrossHeadHTLC...');
    console.log('Hydra head startEpoch time (ms): ', await getStartupTimeMs());

    // this.initListeners();
    const htlcWallet = new CardanoCliWallet({
      skey: faucetWallet.skey,
      vkey: faucetWallet.vkey,
      networkId: NETWORK_ID.PREPROD,
    });
    new HydraCrossHeadHTLC(
      this.hydraHeads[0],
      this.hydraHeads[1],
      this.htlcContract,
      htlcWallet,
    )
      .init()
      .then(() => {
        console.log('HydraCrossHeadHTLC initialized.');
      });
    new HydraCrossHeadHTLC(
      this.hydraHeads[1],
      this.hydraHeads[2],
      this.htlcContract,
      htlcWallet,
    )
      .init()
      .then(() => {
        console.log('HydraCrossHeadHTLC initialized.');
      });
    new HydraCrossHeadHTLC(
      this.hydraHeads[2],
      this.hydraHeads[0],
      this.htlcContract,
      htlcWallet,
    )
      .init()
      .then(() => {
        console.log('HydraCrossHeadHTLC initialized.');
      });
  }

  onModuleDestroy() {
    console.log('AppService is being destroyed.');
    // Logic to clean up resources
  }
}
