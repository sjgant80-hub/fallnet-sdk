# @ai-native-solutions/fallnet-sdk

**Sovereign peer-to-peer mesh SDK.** WebRTC datachannel + BroadcastChannel discovery. Zero servers, browser-to-browser.

- Real WebRTC `RTCPeerConnection` with manual offer/answer flow (paper-QR-safe, no signaling server needed)
- BroadcastChannel(`fall-signal`) for same-origin peer discovery
- Google STUN servers (100+ countries)
- Peer announce/find: *"I serve `<tool>`, who wants it?"*
- Message bus (`onMessage`), `send`, `broadcast`

## Install

```bash
npm install @ai-native-solutions/fallnet-sdk
```

## Browser usage

```js
import fallnet from '@ai-native-solutions/fallnet-sdk';

// Peer A: create offer, hand the blob to Peer B (any channel — chat, email, paper QR)
const { peerId, sdp, pc } = await fallnet.createOffer({ seedName: 'my-tool' });
console.log('send this blob to peer:', sdp);

// Peer B: accept the offer, hand answer back
const answer = await fallnet.acceptOffer(offerBlob, { seedName: 'peer-b' });
console.log('send this blob back:', answer.sdp);

// Peer A: complete the handshake
await fallnet.completeOffer(pc, answerBlob);

// Messaging
fallnet.onMessage(m => console.log('got:', m));
fallnet.send(peerId, { hello: 'world' });
```

## Same-origin mesh (multi-tab)

```js
fallnet.meshStart({ seedName: 'my-tool' });
fallnet.announce('shadowcompass');
const peer = await fallnet.find('fallmap');   // returns { peerId, seedName } or null
```

## Node usage

Provide a WebRTC polyfill (`wrtc` or `node-datachannel`):

```js
import fallnet from '@ai-native-solutions/fallnet-sdk';
import wrtc from 'wrtc';
fallnet.configure({ RTCPeerConnection: wrtc.RTCPeerConnection });
```

## API

| Function | Purpose |
|---|---|
| `createOffer({ seedName, meta })` | Peer A: returns `{ peerId, sdp, pc }`. `sdp` is base64 blob. |
| `acceptOffer(sdp, { seedName })` | Peer B: returns `{ peerId, sdp, pc }`. |
| `completeOffer(pc, sdp)` | Peer A: finalizes handshake. |
| `send(peerId, msg)` | Send to one peer. Returns `true` on success. |
| `broadcast(msg)` | Send to all open peers. Returns count sent. |
| `onMessage(fn)` | Subscribe. Returns unsubscribe fn. |
| `peers()` | List `{ id, state, meta }`. |
| `meshStart({ seedName })` | Same-origin BroadcastChannel mesh. |
| `meshPost(kind, payload)` | Post to mesh. |
| `announce(tool)` | Announce this node serves `<tool>`. |
| `find(tool, timeoutMs)` | Find a peer serving `<tool>`. |

## The n=∞ defense

| Threat | fallnet response |
|---|---|
| All CDNs and GitHub Pages dark | Browser-to-browser still works · operators serve each other |
| National firewall blocks all hosting | WebRTC P2P bypasses firewall · STUN in 100+ countries |
| Trackers / signaling servers blocked | Manual offer/answer via paper QR · works offline |
| Air-gapped operator at an event | Local-only via BroadcastChannel · same-machine multi-tab mesh |

## License

MIT · part of [AI Native Solutions](https://ai-nativesolutions.com)
