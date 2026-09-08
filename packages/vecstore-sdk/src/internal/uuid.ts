import { createHash } from "node:crypto";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export const isUuid = (value: string): boolean => UUID_PATTERN.test(value);

const UUID_BYTES = 16;
const VERSION_BYTE = 6;
const VARIANT_BYTE = 8;
const LOW_NIBBLE = 16;
const VERSION_8 = 0x80;
const VARIANT_BITS = 64;
const VARIANT_RFC4122 = 0x80;
const SEPARATOR = String.fromCodePoint(0);

export const deterministicUuid = (namespace: string, name: string): string => {
  const hash = createHash("sha256")
    .update(`${namespace}${SEPARATOR}${name}`, "utf-8")
    .digest()
    .subarray(0, UUID_BYTES);
  hash.writeUInt8(
    (hash.readUInt8(VERSION_BYTE) % LOW_NIBBLE) + VERSION_8,
    VERSION_BYTE
  );
  hash.writeUInt8(
    (hash.readUInt8(VARIANT_BYTE) % VARIANT_BITS) + VARIANT_RFC4122,
    VARIANT_BYTE
  );
  const hex = hash.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
