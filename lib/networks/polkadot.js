export class PolkadotNetwork {
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
//# sourceMappingURL=polkadot.js.map