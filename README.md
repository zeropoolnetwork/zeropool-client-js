# zeropool-client-js

## Example
```js
import { init, ZeropoolClient } from 'zeropool-js';

const snarkParams = {
  transferParamsUrl: '/path/to/transfer/params',
  treeParamsUrl: '/path/to/tree/params',
  transferVkUrl: '/path/to/transfer/vk',
  treeVkUrl: '/path/to/tree/vk',
};

// Initialize the library.
init('/path/to/wasm', '/path/to/worker.js', snarkParams)
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

      const client = await EvmZeropoolClient.create({
        sk,
        tokens,
        snarkParams: ctx.snarkParams,
        worker: ctx.worker,
        networkName: 'ethereum',
        compactSignature: true, // true for ethereum
      });

      const signFunction = (data) => sign(data);

      await client.deposit(tokenAddress, amountWei, signFunction);
  });
```
