import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { CloudClient } from '@dtelecom/server-sdk-js';
import { formatNode, getAllNode, getNodeByAddress } from '@dtelecom/server-sdk-js/contract';

const require = createRequire(import.meta.url);
assert.equal(require('@dtelecom/server-sdk-js').CloudClient, CloudClient);
assert.equal(require('@dtelecom/server-sdk-js/contract').getAllNode, getAllNode);

// The two PDAs were generated using web3.js v1 from 32-byte keys filled with 1, 2 and 3.
const program = '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi';
const authority = '8qbHbw2BbbTHBW1sbeqakYXVKRQM8Ne7pLK7m6CVfeR';
const key = 'CktRuQ2mttgRGkXJtyksdKHjUdc2C4TgDzyB98oEzy8';
const registry = 'AAz7y5LJta9XJBwwX7j22jYHMD3gzE4hHKoQqTdGN8Af';
const entry = 'DKRNe6z4o52BiQyGTZemfkg16i1saatVLn2PymoBo87b';
const domain = 'node.example';
const record = Buffer.alloc(334);
record.fill(3, 40, 72);
record.writeUInt32LE(domain.length, 72);
record.write(domain, 76);
const account = {
  data: [record.toString('base64'), 'base64'],
  owner: program,
  executable: false,
  lamports: 1,
  space: record.length,
};

const calls = [];
const server = createServer(async (request, response) => {
  const body = [];
  for await (const chunk of request) body.push(chunk);
  const { id, method, params } = JSON.parse(Buffer.concat(body));
  calls.push({ method, params });
  const result =
    method === 'getProgramAccounts'
      ? [{ pubkey: entry, account }]
      : { context: { slot: 1 }, value: account };
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
try {
  const config = {
    contractAddress: program,
    registryAuthority: authority,
    networkHost: 'http://127.0.0.1:' + server.address().port,
  };
  const expected = { domain, key };
  assert.deepEqual(await getAllNode(config), [expected]);
  assert.deepEqual(await getNodeByAddress(key, config), expected);
  assert.deepEqual(await formatNode({ domain, registered: { toBase58: () => key } }), expected);
  // Solana Kit omits finalized on the wire because it is the RPC server default.
  assert.deepEqual(calls, [
    {
      method: 'getProgramAccounts',
      params: [
        program,
        {
          encoding: 'base64',
          filters: [
            { memcmp: { offset: 8, encoding: 'base58', bytes: registry } },
            { dataSize: 334 },
          ],
        },
      ],
    },
    { method: 'getAccountInfo', params: [entry, { encoding: 'base64' }] },
  ]);
} finally {
  server.close();
}
