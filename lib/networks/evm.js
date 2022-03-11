"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EvmNetwork = void 0;
const web3_1 = __importDefault(require("web3"));
class EvmNetwork {
    static async create(rpcUrl, contractAddress) {
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
        const contract = new web3.eth.Contract(abi, contractAddress);
        const denominator = await contract.methods.denominator().call();
    }
    getDenominator(contractAddress) {
        throw new Error('Method not implemented.');
    }
    isSignatureCompact() {
        return true;
    }
    defaultNetworkName() {
        return 'ethereum';
    }
}
exports.EvmNetwork = EvmNetwork;
//# sourceMappingURL=evm.js.map