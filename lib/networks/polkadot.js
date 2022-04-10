"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PolkadotNetwork = void 0;
class PolkadotNetwork {
    async getDenominator(contractAddress) {
        return '1000'; // FIXME
    }
    isSignatureCompact() {
        return false;
    }
    defaultNetworkName() {
        return 'polkadot';
    }
    getRpcUrl() {
        return '';
    }
}
exports.PolkadotNetwork = PolkadotNetwork;
//# sourceMappingURL=polkadot.js.map