import Web3 from 'web3';
import { AbiItem } from 'web3-utils';
import { Contract } from 'web3-eth-contract'

import { NetworkBackend } from './network';

export class EvmNetwork implements NetworkBackend {
    web3: Web3;

    public static async create(rpcUrl: string, contractAddress: string) {
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

        const contract = new web3.eth.Contract(abi, contractAddress) as Contract;
        const denominator = await contract.methods.denominator().call();
    }

    getDenominator(contractAddress: string): Promise<string> {
        throw new Error('Method not implemented.');
    }

    isSignatureCompact(): boolean {
        return true;
    }

    defaultNetworkName(): string {
        return 'ethereum';
    }

}