import Web3 from 'web3';
import { NetworkBackend } from './network';
export declare class EvmNetwork implements NetworkBackend {
    web3: Web3;
    static create(rpcUrl: string, contractAddress: string): Promise<void>;
    getDenominator(contractAddress: string): Promise<string>;
    isSignatureCompact(): boolean;
    defaultNetworkName(): string;
}
