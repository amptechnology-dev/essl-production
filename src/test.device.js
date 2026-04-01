// Run: node test-device2.js
// Tests proper ZKTeco auth handshake

const net = require('net');

const DEVICE_IP = '192.168.1.201';
const DEVICE_PORT = 4370;
const DEVICE_PASSWORD = ''

let sessionId = 0;
let replyId = 0;

function calcChecksum(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i += 2) {
    sum += buf.readUInt16LE(i);
  }
  while (sum >> 16) sum = (sum & 0xffff) + (sum >> 16);
  return ~sum & 0xffff;
}

function makePacket(command, data = Buffer.alloc(0)) {
  const payload = Buffer.alloc(8 + data.length);
  payload.writeUInt16LE(command, 0);
  payload.writeUInt16LE(0, 2);          // checksum placeholder
  payload.writeUInt16LE(sessionId, 4);
  payload.writeUInt16LE(replyId, 6);
  data.copy(payload, 8);

  const checksum = calcChecksum(payload);
  payload.writeUInt16LE(checksum, 2);

  const header = Buffer.alloc(8);
  header.writeUInt32LE(0x50415a5a, 0);  // magic
  header.writeUInt16LE(payload.length, 4);
  header.writeUInt16LE(0, 6);

  replyId++;
  return Buffer.concat([header, payload]);
}

function parseResponse(data) {
  if (data.length < 16) return null;
  const magic = data.readUInt32LE(0);
  if (magic !== 0x50415a5a) return null;
  const payloadLen = data.readUInt16LE(4);
  const command = data.readUInt16LE(8);
  const checksum = data.readUInt16LE(10);
  const session = data.readUInt16LE(12);
  const reply = data.readUInt16LE(14);
  const payload = data.slice(16);
  return { command, checksum, session, reply, payload, payloadLen };
}

const CMD_CONNECT    = 1000;
const CMD_ACK_OK     = 2000;
const CMD_AUTH       = 1102;
const CMD_GET_INFO   = 11;
const CMD_ATTLOG_SIZE= 50;
const CMD_ATTLOG     = 13;

const socket = new net.Socket();
let step = 0;
let buffer = Buffer.alloc(0);

socket.connect(DEVICE_PORT, DEVICE_IP, () => {
  console.log('✅ TCP Connected');
  console.log('\nStep 1: Sending CMD_CONNECT (no password)...');
  socket.write(makePacket(CMD_CONNECT));
});

socket.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  if (buffer.length < 16) return;

  const res = parseResponse(buffer);
  buffer = Buffer.alloc(0);

  if (!res) {
    console.log('❌ Invalid response format');
    console.log('Raw hex:', chunk.toString('hex'));
    socket.destroy();
    return;
  }

  console.log(`\n--- Step ${step} Response ---`);
  console.log('Command:', res.command, '(ACK_OK=2000, ACK_FAIL=2001)');
  console.log('Session ID:', res.session);
  console.log('Buffer length:', buffer.length + 16 + res.payload.length);
  console.log('Payload hex:', res.payload.toString('hex'));

  if (step === 0) {
    if (res.command === CMD_ACK_OK) {
      sessionId = res.session;
      console.log('✅ Connect ACK OK! Session:', sessionId);
      console.log('\nStep 2: Sending CMD_GET_INFO...');
      socket.write(makePacket(CMD_GET_INFO));
      step++;
    } else {
      console.log('❌ Connect failed, trying CMD_AUTH with empty password...');
      const passData = Buffer.from('\x00\x00\x00\x00', 'binary');
      socket.write(makePacket(CMD_AUTH, passData));
      step = 10;
    }
  } else if (step === 1) {
    console.log('✅ Got getInfo response!');
    console.log('Full response hex:', chunk.toString('hex'));
    console.log('TOTAL RESPONSE LENGTH:', chunk.length);
    console.log('\n>>> KEY INFO: Library expects offset 24, your device sends', chunk.length, 'bytes');
    socket.write(makePacket(CMD_ATTLOG_SIZE));
    step++;
  } else if (step === 2) {
    console.log('✅ Got attendance size response!');
    console.log('Full response hex:', chunk.toString('hex'));
    console.log('TOTAL RESPONSE LENGTH:', chunk.length);
    socket.destroy();
    process.exit(0);
  } else if (step === 10) {
    console.log('Auth response:', res.command);
    if (res.command === CMD_ACK_OK) {
      sessionId = res.session;
      console.log('✅ Auth OK! Session:', sessionId);
    } else {
      console.log('❌ Auth also failed. Device may need specific password.');
    }
    socket.destroy();
    process.exit(0);
  }
});

socket.on('error', (err) => console.error('❌ Socket error:', err.message));
socket.on('close', () => console.log('\nConnection closed'));

setTimeout(() => {
  console.log('❌ Timeout');
  socket.destroy();
  process.exit(1);
}, 10000);