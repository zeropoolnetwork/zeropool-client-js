"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EvmNetwork = void 0;
const web3_1 = __importDefault(require("web3"));
class EvmNetwork {
    constructor(rpcUrl) {
        this.rpcUrl = rpcUrl;
        const web3 = new web3_1.default(rpcUrl);
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
exports.EvmNetwork = EvmNetwork;
//# sourceMappingURL=evm.js.map