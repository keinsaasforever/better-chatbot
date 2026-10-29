const OGG_CAPTURE_PATTERN = Buffer.from("OggS");
const OPUS_HEAD = Buffer.from("OpusHead");
const OPUS_TAGS = Buffer.from("OpusTags");
const OGG_CRC_POLYNOMIAL = 0x04c11db7;

const crcTable = new Uint32Array(256);
for (let i = 0; i < crcTable.length; i++) {
  let value = i << 24;
  for (let bit = 0; bit < 8; bit++) {
    value =
      value & 0x80000000
        ? ((value << 1) ^ OGG_CRC_POLYNOMIAL) >>> 0
        : (value << 1) >>> 0;
  }
  crcTable[i] = value >>> 0;
}

function oggCrc(buffer: Buffer) {
  let crc = 0;
  for (const byte of buffer) {
    crc = ((crc << 8) ^ crcTable[((crc >>> 24) & 0xff) ^ byte]) >>> 0;
  }
  return crc >>> 0;
}

function writeUInt64LE(buffer: Buffer, value: number, offset: number) {
  buffer.writeUInt32LE(value >>> 0, offset);
  buffer.writeUInt32LE(Math.floor(value / 0x100000000) >>> 0, offset + 4);
}

function packetLacing(packet: Uint8Array) {
  const segments: number[] = [];
  let remaining = packet.byteLength;
  while (remaining >= 255) {
    segments.push(255);
    remaining -= 255;
  }
  segments.push(remaining);
  return segments;
}

function createPage({
  packets,
  headerType,
  granulePosition,
  serial,
  sequence,
}: {
  packets: Uint8Array[];
  headerType: number;
  granulePosition: number;
  serial: number;
  sequence: number;
}) {
  const segments = packets.flatMap(packetLacing);
  if (segments.length > 255) {
    throw new Error("Ogg page has too many segments");
  }

  const payloadLength = packets.reduce(
    (sum, packet) => sum + packet.byteLength,
    0,
  );
  const page = Buffer.alloc(27 + segments.length + payloadLength);
  OGG_CAPTURE_PATTERN.copy(page, 0);
  page[4] = 0;
  page[5] = headerType;
  writeUInt64LE(page, granulePosition, 6);
  page.writeUInt32LE(serial >>> 0, 14);
  page.writeUInt32LE(sequence >>> 0, 18);
  page.writeUInt32LE(0, 22);
  page[26] = segments.length;

  let offset = 27;
  for (const segment of segments) {
    page[offset++] = segment;
  }
  for (const packet of packets) {
    Buffer.from(packet).copy(page, offset);
    offset += packet.byteLength;
  }

  page.writeUInt32LE(oggCrc(page), 22);
  return page;
}

function createOpusHead(inputSampleRate: number, channels: number) {
  const packet = Buffer.alloc(19);
  OPUS_HEAD.copy(packet, 0);
  packet[8] = 1;
  packet[9] = channels;
  packet.writeUInt16LE(0, 10);
  packet.writeUInt32LE(inputSampleRate, 12);
  packet.writeInt16LE(0, 16);
  packet[18] = 0;
  return packet;
}

function createOpusTags() {
  const vendor = Buffer.from("keinsaas-navigator");
  const packet = Buffer.alloc(8 + 4 + vendor.byteLength + 4);
  OPUS_TAGS.copy(packet, 0);
  packet.writeUInt32LE(vendor.byteLength, 8);
  vendor.copy(packet, 12);
  packet.writeUInt32LE(0, 12 + vendor.byteLength);
  return packet;
}

export function createOggOpusBuffer({
  packets,
  inputSampleRate = 16000,
  channels = 1,
  frameDurationMs = 60,
}: {
  packets: Uint8Array[];
  inputSampleRate?: number;
  channels?: number;
  frameDurationMs?: number;
}) {
  if (packets.length === 0) {
    throw new Error("Cannot create Ogg Opus audio without packets");
  }

  const serial = Math.floor(Math.random() * 0xffffffff) >>> 0;
  const pages: Buffer[] = [];
  let sequence = 0;

  pages.push(
    createPage({
      packets: [createOpusHead(inputSampleRate, channels)],
      headerType: 0x02,
      granulePosition: 0,
      serial,
      sequence: sequence++,
    }),
  );
  pages.push(
    createPage({
      packets: [createOpusTags()],
      headerType: 0,
      granulePosition: 0,
      serial,
      sequence: sequence++,
    }),
  );

  const samplesPerPacketAt48k = (48000 * frameDurationMs) / 1000;
  let granulePosition = 0;
  for (let index = 0; index < packets.length; index += 40) {
    const pagePackets = packets.slice(index, index + 40);
    granulePosition += samplesPerPacketAt48k * pagePackets.length;
    pages.push(
      createPage({
        packets: pagePackets,
        headerType: index + 40 >= packets.length ? 0x04 : 0,
        granulePosition,
        serial,
        sequence: sequence++,
      }),
    );
  }

  return Buffer.concat(pages);
}
