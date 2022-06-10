export const ZEROPOOL_PURPOSE = 2448;
// Using strings here for better debuggability
export var NetworkType;
(function (NetworkType) {
    NetworkType["ethereum"] = "ethereum";
    NetworkType["xdai"] = "xdai";
    NetworkType["aurora"] = "aurora";
    NetworkType["near"] = "near";
    NetworkType["waves"] = "waves";
    NetworkType["polkadot"] = "polkadot";
    NetworkType["kusama"] = "kusama";
})(NetworkType || (NetworkType = {}));
(function (NetworkType) {
    function derivationPath(network, account) {
        return NetworkType.chainPath(network) + NetworkType.accountPath(network, account);
    }
    NetworkType.derivationPath = derivationPath;
    function chainPath(network) {
        return `m/44'/${NetworkType.coinNumber(network)}'`;
    }
    NetworkType.chainPath = chainPath;
    function privateDerivationPath(network) {
        return `m/${ZEROPOOL_PURPOSE}'/${NetworkType.coinNumber(network)}'`;
    }
    NetworkType.privateDerivationPath = privateDerivationPath;
    function accountPath(network, account) {
        switch (network) {
            case NetworkType.ethereum:
            case NetworkType.xdai:
            case NetworkType.aurora:
                return `/0'/0/${account}`;
            case NetworkType.near:
                return `/${account}'`;
            case NetworkType.waves:
                return `/${account}'/0'/0'`;
            case NetworkType.polkadot:
            case NetworkType.kusama:
                return `/${account}'`;
        }
    }
    NetworkType.accountPath = accountPath;
    // TODO: Use a full list of coins.
    function coinNumber(network) {
        switch (network) {
            case NetworkType.ethereum:
                return 60;
            case NetworkType.xdai:
                return 700;
            case NetworkType.aurora:
                return 2570;
            case NetworkType.near:
                return 397;
            case NetworkType.waves:
                return 5741564;
            case NetworkType.polkadot:
                return 354;
            case NetworkType.kusama:
                return 434;
        }
    }
    NetworkType.coinNumber = coinNumber;
})(NetworkType || (NetworkType = {}));
//# sourceMappingURL=network-type.js.map