import crypto from "node:crypto";

function buffer(value) {
  return Buffer.from(String(value ?? ""), "utf8");
}

export function safeSecretEqual(left, right) {
  const a = buffer(left);
  const b = buffer(right);
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function bearerToken(headers = {}) {
  const value = headers.authorization || headers.Authorization || "";
  const [scheme, token] = String(value).split(" ");
  return scheme?.toLowerCase() === "bearer" ? token || "" : "";
}
