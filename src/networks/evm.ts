import Web3 from 'web3';
import { AbiItem } from 'web3-utils';
import { Contract } from 'web3-eth-contract'

import { NetworkBackend } from './network';

export class EvmNetwork implements NetworkBackend {
    contract: Contract;
    rpcUrl: string;

    constructor(rpcUrl: string) {
        this.rpcUrl = rpcUrl;

        const web3 = new Web3(rpcUrl);

        const abi: AbiItem[] = [
            {
                constant: true,
                inputs: [],
                name: 'denominator',
                outputs: [
                    {
                        name: '',
                        type: 'uint256',
                    }
                ],
                payable: false,
                type: 'function',
            }
        ];

        this.contract = new web3.eth.Contract(abi) as Contract;
    }

    async getDenominator(contractAddress: string): Promise<string> {
        this.contract.options.address = contractAddress;
        return await this.contract.methods.denominator().call();
    }

    isSignatureCompact(): boolean {
        return true;
    }

    defaultNetworkName(): string {
        return 'ethereum';
    }

    getRpcUrl(): string {
        return this.rpcUrl;
    }
}