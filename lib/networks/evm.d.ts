import { Contract } from 'web3-eth-contract';
import { NetworkBackend } from './network';
export declare class EvmNetwork implements NetworkBackend {
    contract: Contract;
    constructor(rpcUrl: string);
    getDenominator(contractAddress: string): Promise<string>;
    isSignatureCompact(): boolean;
    defaultNetworkName(): string;
}
