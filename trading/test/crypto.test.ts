import { describe, expect, it } from "vitest";
import { base32Encode, decryptSecret, encryptSecret, hashPassword, totpCode, verifyPassword, verifyTotp } from "../src/lib/crypto.js";

describe("crypto", () => {
  it("TOTP matches RFC 6238 SHA-1 test vectors", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(totpCode(secret, 59_000)).toBe("287082");
    expect(totpCode(secret, 1_111_111_109_000)).toBe("081804");
    expect(verifyTotp(secret, "287082", 59_000)).toBe(true);
    expect(verifyTotp(secret, "000000", 59_000)).toBe(false);
  });
  it("hashes and verifies passwords", () => {
    const h = hashPassword("correct horse battery");
    expect(verifyPassword("correct horse battery", h)).toBe(true);
    expect(verifyPassword("wrong", h)).toBe(false);
  });
  it("encrypts secrets with authentication", () => {
    const enc = encryptSecret("JBSWY3DPEHPK3PXP", "k".repeat(40));
    expect(decryptSecret(enc, "k".repeat(40))).toBe("JBSWY3DPEHPK3PXP");
    expect(() => decryptSecret(enc, "x".repeat(40))).toThrow();
  });
});
