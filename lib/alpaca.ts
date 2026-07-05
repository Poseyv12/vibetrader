const TRADING_BASE = "https://paper-api.alpaca.markets/v2";
const DATA_BASE = "https://data.alpaca.markets/v2";
const CRYPTO_BASE = "https://data.alpaca.markets/v1beta3/crypto/us";

import { resolved } from "./settings";

function headers() {
  const key = resolved.alpacaKey();
  const secret = resolved.alpacaSecret();
  if (!key || !secret) {
    throw new Error(
      "Alpaca keys missing — set them on the /settings page or in .env.local"
    );
  }
  return {
    "APCA-API-KEY-ID": key,
    "APCA-API-SECRET-KEY": secret,
    "Content-Type": "application/json",
  };
}

export class AlpacaError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: headers(),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new AlpacaError(res.status, body || res.statusText);
  }
  // DELETE endpoints return 204 with no body
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const trading = {
  get: <T>(path: string) => request<T>(TRADING_BASE, path),
  post: <T>(path: string, body: unknown) =>
    request<T>(TRADING_BASE, path, { method: "POST", body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(TRADING_BASE, path, { method: "DELETE" }),
};

export const data = {
  get: <T>(path: string) => request<T>(DATA_BASE, path),
};

export const crypto = {
  get: <T>(path: string) => request<T>(CRYPTO_BASE, path),
};

/** v1beta1 data APIs: news + screeners (movers, most-actives). */
const BETA_BASE = "https://data.alpaca.markets/v1beta1";
export const beta = {
  get: <T>(path: string) => request<T>(BETA_BASE, path),
};

/** Free-tier accounts get the IEX feed. */
export const FEED = "iex";

/** Crypto symbols use pair notation: BTC/USD, ETH/USD, … */
export const isCryptoSymbol = (s: string) => s.includes("/");
