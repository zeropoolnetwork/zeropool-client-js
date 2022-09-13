import Web3 from 'web3';
import { AbiItem } from 'web3-utils';
import { Contract } from 'web3-eth-contract'
import { NetworkBackend } from './network';

export class EvmNetwork implements NetworkBackend {
    contract: Contract;
    token: Contract;
    rpcUrl: string;
    web3: Web3;

    constructor(rpcUrl: string) {
        this.rpcUrl = rpcUrl;

        this.web3 = new Web3(rpcUrl);

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
            },
        ];
        this.contract = new this.web3.eth.Contract(abi) as Contract;

        // just the Transfer() event definition is sufficient in this case
        const abiTokenJson: AbiItem[] = [
            {
                anonymous: false,
                inputs: [
                    {
                        indexed: true,
                        name: 'from',
                        type: 'address'
                    },
                    {
                        indexed: true,
                        name: 'to',
                        type: 'address'
                    },
                    {
                        indexed: false,
                        name: 'value',
                        type: 'uint256'
                    }
                ],
                name: 'Transfer',
                type: 'event'
            }
        ];
        this.token = new this.web3.eth.Contract(abiTokenJson) as Contract;
    }

    public async getChainId(): Promise<number> {
        return await this.web3.eth.getChainId();
    }

    public async getDenominator(contractAddress: string): Promise<bigint> {
        this.contract.options.address = contractAddress;
        return BigInt(await this.contract.methods.denominator().call());
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