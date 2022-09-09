import Web3 from 'web3';
export class EvmNetwork {
    constructor(rpcUrl) {
        this.rpcUrl = rpcUrl;
        this.web3 = new Web3(rpcUrl);
        const abi = [
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
            {
                inputs: [{
                        internalType: 'address',
                        name: '_user',
                        type: 'address',
                    }],
                name: 'getLimitsFor',
                outputs: [{
                        components: [{
                                internalType: 'uint256',
                                name: 'tvlCap',
                                type: 'uint256',
                            }, {
                                internalType: 'uint256',
                                name: 'tvl',
                                type: 'uint256',
                            }, {
                                internalType: 'uint256',
                                name: 'dailyDepositCap',
                                type: 'uint256',
                            }, {
                                internalType: 'uint256',
                                name: 'dailyDepositCapUsage',
                                type: 'uint256',
                            }, {
                                internalType: 'uint256',
                                name: 'dailyWithdrawalCap',
                                type: 'uint256',
                            }, {
                                internalType: 'uint256',
                                name: 'dailyWithdrawalCapUsage',
                                type: 'uint256',
                            }, {
                                internalType: 'uint256',
                                name: 'dailyUserDepositCap',
                                type: 'uint256',
                            }, {
                                internalType: 'uint256',
                                name: 'dailyUserDepositCapUsage',
                                type: 'uint256',
                            }, {
                                internalType: 'uint256',
                                name: 'depositCap',
                                type: 'uint256',
                            }],
                        internalType: 'struct ZkBobAccounting.Limits',
                        name: '',
                        type: 'tuple'
                    }],
                stateMutability: 'view',
                type: 'function',
            }
        ];
        this.contract = new this.web3.eth.Contract(abi);
        // just the Transfer() event definition is sufficient in this case
        const abiTokenJson = [
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
        this.token = new this.web3.eth.Contract(abiTokenJson);
    }
    async getChainId() {
        return await this.web3.eth.getChainId();
    }
    async getDenominator(contractAddress) {
        this.contract.options.address = contractAddress;
        return BigInt(await this.contract.methods.denominator().call());
    }
    isSignatureCompact() {
        return true;
    }
    defaultNetworkName() {
        return 'ethereum';
    }
    getRpcUrl() {
        return this.rpcUrl;
    }
    async poolLimits(contractAddress, address) {
        this.contract.options.address = contractAddress;
        let addr = address;
        if (address === undefined) {
            addr = '0x0000000000000000000000000000000000000000';
        }
        return await this.contract.methods.getLimitsFor(addr).call();
    }
}
//# sourceMappingURL=evm.js.map