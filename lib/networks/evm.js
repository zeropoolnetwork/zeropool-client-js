import Web3 from 'web3';
export class EvmNetwork {
    constructor(rpcUrl) {
        this.rpcUrl = rpcUrl;
        const web3 = new Web3(rpcUrl);
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
            }
        ];
        this.contract = new web3.eth.Contract(abi);
    }
    async getDenominator(contractAddress) {
        this.contract.options.address = contractAddress;
        return await this.contract.methods.denominator().call();
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
}
//# sourceMappingURL=evm.js.map