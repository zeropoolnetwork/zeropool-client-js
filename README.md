# zeropool-client-js

TypeScript/JavaScript client library for creating and sending shielded ZeroPool transactions.

## Setup
The default Webpack 5 configuration should be sufficient for this library. The only requirement is that it must properly process the `new URL('...', import.meta.url)` syntax.

## Multithread version
Enable the following headers on your server to enable the multithreaded mode:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```
On average, this will speed up the transaction creation process by about 2.5-3 times.

## Usage example
```js
import { init, ZeropoolClient } from 'zeropool-client-js';
import { EvmNetwork } from 'zeropool-client-js/lib/networks/evm';

// Use https://github.com/zeropoolnetwork/libzeropool CLI to generate theese files
const snarkParams = {
  transferParamsUrl: '/path/to/transfer/params',
  treeParamsUrl: '/path/to/tree/params',
  transferVkUrl: '/path/to/transfer/vk',
  treeVkUrl: '/path/to/tree/vk',
};

// Initialize the library.
init(snarkParams)
  .then(async (ctx) => {
      // Spending key
      const sk = new Uint8Array(32);

      // Configurations for each supported token.
      const tokens = {
        'token address': {
          poolAddress: '...',
          relayerUrl: '...',
        }
      };

      const evmRpcUrl = '...';
      const network = new EvmNetwork(evmRpcUrl);
      const client = await ZeropoolClient.create({
        sk,
        tokens,
        snarkParams: ctx.snarkParams,
        worker: ctx.worker,
        networkName: 'ethereum',
        network,
      });

      const signFunction = (data) => sign(data);

      await client.deposit(tokenAddress, amountWei, signFunction);
  });
```
