import Web3 from 'web3';
import { AbiItem } from 'web3-utils';
import { Contract } from 'web3-eth-contract'
import { NetworkBackend } from './network';

const EthDater = require('ethereum-block-by-date');

export class EvmNetwork implements NetworkBackend {
    contract: Contract;
    token: Contract;
    rpcUrl: string;
    web3: Web3;
    dater: any;

    constructor(rpcUrl: string) {
        this.rpcUrl = rpcUrl;

        this.web3 = new Web3(rpcUrl);

        this.dater = new EthDater(this.web3);

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

    // result in wei
    public async tokenTransferedAmount(tokenAddress: string, from: string, to: string): Promise<bigint> {
        this.token.options.address = tokenAddress;

        const dayAgo = new Date();
        dayAgo.setDate(dayAgo.getDate() - 1);
        let dateBlock = await this.dater.getDate(dayAgo, true, false);
        const fromBlock = dateBlock.block;
        const toBlock =await this.web3.eth.getBlockNumber();

        let totalTokensTranferred = BigInt(0);
        const pastEvents = await this.token.getPastEvents('Transfer', {
            'filter': { from, to },
            'fromBlock': fromBlock,
            'toBlock': toBlock,
        });

        for (let pastEvent of pastEvents) {
            totalTokensTranferred += BigInt(pastEvent.returnValues.value);
        }
        
        console.log(`Fetched transfers from block ${fromBlock}, to block ${toBlock}: ${totalTokensTranferred} wei in ${pastEvents.length} transactions`);

        return totalTokensTranferred;
    }
}