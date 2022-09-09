import Web3 from 'web3';
import { Contract } from 'web3-eth-contract';
import { NetworkBackend } from './network';
export declare class EvmNetwork implements NetworkBackend {
    contract: Contract;
    token: Contract;
    rpcUrl: string;
    web3: Web3;
    constructor(rpcUrl: string);
    getChainId(): Promise<number>;
    getDenominator(contractAddress: string): Promise<bigint>;
    isSignatureCompact(): boolean;
    defaultNetworkName(): string;
    getRpcUrl(): string;
    poolLimits(contractAddress: string, address: string | undefined): Promise<any>;
}
