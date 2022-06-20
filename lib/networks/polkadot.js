export class PolkadotNetwork {
    async getDenominator(contractAddress) {
        return '1000';
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
//# sourceMappingURL=polkadot.js.map