/*!
 * @ai-native-solutions/fallnet-sdk v1.0.0
 * Sovereign peer-to-peer mesh · WebRTC + BroadcastChannel
 * MIT · AI Native Solutions
 *
 * REAL feature extraction from fallnet:
 *  - WebRTC RTCPeerConnection with datachannel
 *  - Manual offer/answer flow (paper-QR-safe, no signaling server)
 *  - BroadcastChannel('fall-signal') for same-origin peer discovery
 *  - Google STUN servers (100+ countries)
 *  - Peer announce/find: "I serve <tool>, who wants it?"
 *  - onMessage event bus
 *
 * Works in browsers natively. In Node use `wrtc` or `node-datachannel`
 * as a polyfill and pass it via `configure({ RTCPeerConnection })`.
 */

const MESH_CHANNEL = 'fall-signal';
const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' }
];

// ─── Runtime polyfills (browser has these; Node needs adapters) ─────
let _RTCPeerConnection = typeof RTCPeerConnection !== 'undefined' ? RTCPeerConnection : null;
let _BroadcastChannel  = typeof BroadcastChannel  !== 'undefined' ? BroadcastChannel  : null;
let _btoa = typeof btoa !== 'undefined' ? btoa : (s) => Buffer.from(s, 'utf8').toString('base64');
let _atob = typeof atob !== 'undefined' ? atob : (s) => Buffer.from(s, 'base64').toString('utf8');

export function configure(opts = {}) {
  if (opts.RTCPeerConnection) _RTCPeerConnection = opts.RTCPeerConnection;
  if (opts.BroadcastChannel)  _BroadcastChannel  = opts.BroadcastChannel;
}

// ─── State ──────────────────────────────────────────────────────────
const STATE = {
  peers: new Map(),      // id -> { id, pc, dc, meta }
  bc: null,              // BroadcastChannel
  seedId: null,
  seedName: 'seed',
  serves: new Set(),     // tools this node serves
  handlers: [],          // message listeners
};

// ─── Utility ────────────────────────────────────────────────────────
function randId() {
  return Math.random().toString(36).slice(2, 10);
}

function pack(obj) { return _btoa(JSON.stringify(obj)); }
function unpack(str) { return JSON.parse(_atob(str)); }

function newPC() {
  if (!_RTCPeerConnection) {
    throw new Error('fallnet-sdk: RTCPeerConnection not available. In Node call configure({ RTCPeerConnection }).');
  }
  return new _RTCPeerConnection({ iceServers: STUN_SERVERS });
}

// Wait for all ICE candidates (simple non-trickle mode - paper-QR-safe)
function waitIceComplete(pc) {
  return new Promise(resolve => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const check = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', check);
    // Fallback timer: 3s should be enough for STUN
    setTimeout(resolve, 3000);
  });
}

function wireDataChannel(peerId, dc) {
  dc.onmessage = e => {
    let m;
    try { m = JSON.parse(e.data); } catch { m = { raw: e.data }; }
    m.__peerId = peerId;
    STATE.handlers.forEach(h => { try { h(m); } catch (err) { /* isolate handler errors */ } });
  };
  dc.onopen = () => {
    STATE.handlers.forEach(h => { try { h({ kind: 'fallnet:open', __peerId: peerId }); } catch {} });
  };
  dc.onclose = () => {
    STATE.peers.delete(peerId);
    STATE.handlers.forEach(h => { try { h({ kind: 'fallnet:close', __peerId: peerId }); } catch {} });
  };
}

// ─── Peer A: create offer ───────────────────────────────────────────
export async function createOffer(opts = {}) {
  const pc = newPC();
  const dc = pc.createDataChannel('fallnet', { ordered: true });
  const peerId = opts.peerId || randId();
  wireDataChannel(peerId, dc);
  STATE.peers.set(peerId, { id: peerId, pc, dc, meta: opts.meta || {} });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitIceComplete(pc);

  const sdp = pack({
    v: 1,
    kind: 'offer',
    peerId,
    seedName: opts.seedName || STATE.seedName,
    sdp: pc.localDescription,
    ts: Date.now()
  });
  return { peerId, sdp, pc };
}

// ─── Peer B: accept offer, produce answer ───────────────────────────
export async function acceptOffer(offerBlob, opts = {}) {
  const parsed = unpack(offerBlob);
  if (parsed.kind !== 'offer') throw new Error('fallnet-sdk: not an offer blob');

  const pc = newPC();
  const peerId = parsed.peerId;
  let dc;
  pc.ondatachannel = e => {
    dc = e.channel;
    wireDataChannel(peerId, dc);
    const entry = STATE.peers.get(peerId);
    if (entry) entry.dc = dc;
  };
  STATE.peers.set(peerId, { id: peerId, pc, dc: null, meta: { seedName: parsed.seedName } });

  await pc.setRemoteDescription(parsed.sdp);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitIceComplete(pc);

  const sdp = pack({
    v: 1,
    kind: 'answer',
    peerId,
    seedName: opts.seedName || STATE.seedName,
    sdp: pc.localDescription,
    ts: Date.now()
  });
  return { peerId, sdp, pc };
}

// ─── Peer A: finalize with answer ───────────────────────────────────
export async function completeOffer(pcOrPeerId, answerBlob) {
  const parsed = unpack(answerBlob);
  if (parsed.kind !== 'answer') throw new Error('fallnet-sdk: not an answer blob');
  const pc = (pcOrPeerId && typeof pcOrPeerId === 'object' && pcOrPeerId.setRemoteDescription)
    ? pcOrPeerId
    : STATE.peers.get(pcOrPeerId)?.pc;
  if (!pc) throw new Error('fallnet-sdk: no PeerConnection found');
  await pc.setRemoteDescription(parsed.sdp);
  return { peerId: parsed.peerId };
}

// ─── Messaging ──────────────────────────────────────────────────────
export function send(peerId, msg) {
  const p = STATE.peers.get(peerId);
  if (!p || !p.dc || p.dc.readyState !== 'open') return false;
  const payload = typeof msg === 'string' ? msg : JSON.stringify(msg);
  p.dc.send(payload);
  return true;
}

export function broadcast(msg) {
  let n = 0;
  for (const p of STATE.peers.values()) {
    if (p.dc && p.dc.readyState === 'open') {
      p.dc.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
      n++;
    }
  }
  return n;
}

export function onMessage(handler) {
  STATE.handlers.push(handler);
  return () => {
    const i = STATE.handlers.indexOf(handler);
    if (i >= 0) STATE.handlers.splice(i, 1);
  };
}

export function peers() {
  return Array.from(STATE.peers.values()).map(p => ({
    id: p.id,
    state: p.dc ? p.dc.readyState : 'connecting',
    meta: p.meta
  }));
}

// ─── BroadcastChannel same-origin mesh ──────────────────────────────
export function meshStart(opts = {}) {
  if (STATE.bc) return { seedId: STATE.seedId };
  if (!_BroadcastChannel) {
    throw new Error('fallnet-sdk: BroadcastChannel not available in this runtime');
  }
  const seedId = opts.seedId || randId();
  STATE.seedId = seedId;
  STATE.seedName = opts.seedName || STATE.seedName;
  STATE.bc = new _BroadcastChannel(MESH_CHANNEL);
  STATE.bc.onmessage = e => {
    const m = e.data;
    if (!m || !m.kind || m.peerId === seedId) return;
    STATE.handlers.forEach(h => { try { h(m); } catch {} });
  };
  STATE.bc.postMessage({
    kind: 'fallnet:hello',
    peerId: seedId,
    seedName: STATE.seedName,
    ts: Date.now()
  });
  return { seedId };
}

export function meshPost(kind, payload) {
  if (!STATE.bc) return false;
  STATE.bc.postMessage({
    kind,
    peerId: STATE.seedId,
    seedName: STATE.seedName,
    ts: Date.now(),
    payload
  });
  return true;
}

export function meshStop() {
  if (STATE.bc) { STATE.bc.close(); STATE.bc = null; }
}

// ─── Announce / find (tool-serving discovery) ───────────────────────
export function announce(tool) {
  STATE.serves.add(tool);
  return meshPost('fallnet:announce', { tool, serves: Array.from(STATE.serves) });
}

export function find(tool, timeoutMs = 1500) {
  return new Promise(resolve => {
    if (!STATE.bc) return resolve(null);
    const off = onMessage(m => {
      if (m.kind === 'fallnet:offer-tool' && m.payload?.tool === tool) {
        off();
        clearTimeout(timer);
        resolve({ peerId: m.peerId, seedName: m.seedName, tool });
      }
    });
    meshPost('fallnet:find', { tool });
    // Auto-respond to finds we can serve
    const respOff = onMessage(m => {
      if (m.kind === 'fallnet:find' && STATE.serves.has(m.payload?.tool)) {
        meshPost('fallnet:offer-tool', { tool: m.payload.tool });
      }
    });
    const timer = setTimeout(() => { off(); respOff(); resolve(null); }, timeoutMs);
  });
}

// ─── Info ───────────────────────────────────────────────────────────
export const VERSION = '1.0.0';
export const CHANNEL = MESH_CHANNEL;
export const STUN = STUN_SERVERS;

export default {
  VERSION, CHANNEL, STUN,
  configure,
  createOffer, acceptOffer, completeOffer,
  send, broadcast, onMessage, peers,
  meshStart, meshPost, meshStop,
  announce, find
};
