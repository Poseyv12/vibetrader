import WebSocket from "ws";
import { isCryptoSymbol } from "./alpaca";
import { checkAlerts, alertSymbols, Alert } from "./alerts";
import { autoResearch } from "./auto-research";
import { queueNewsTriage, NewsItem } from "./news-watchdog";
import { getSettings } from "./settings";

/**
 * Server-side streaming hub. Holds ONE upstream websocket per Alpaca stream
 * (stocks/iex, crypto, trade updates) — free tier allows a single data
 * connection per account — and fans messages out to every connected SSE
 * client. Survives dev HMR via a globalThis singleton.
 */

const STOCK_URL = "wss://stream.data.alpaca.markets/v2/iex";
const CRYPTO_URL = "wss://stream.data.alpaca.markets/v1beta3/crypto/us";
const TRADE_URL = "wss://paper-api.alpaca.markets/stream";
const NEWS_URL = "wss://stream.data.alpaca.markets/v1beta1/news";

type Controller = ReadableStreamDefaultController<Uint8Array>;
const enc = new TextEncoder();

function creds() {
  return {
    key: process.env.ALPACA_API_KEY ?? "",
    secret: process.env.ALPACA_SECRET_KEY ?? "",
  };
}

class Upstream {
  ws: WebSocket | null = null;
  subs = new Set<string>();
  authed = false;

  constructor(
    private url: string,
    private label: "stocks" | "crypto" | "trades" | "news",
    private hub: Hub
  ) {}

  ensure() {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    )
      return;

    const ws = new WebSocket(this.url);
    this.ws = ws;
    this.authed = false;

    ws.on("open", () => {
      const { key, secret } = creds();
      ws.send(
        this.label === "trades"
          ? JSON.stringify({
              action: "authenticate",
              data: { key_id: key, secret_key: secret },
            })
          : JSON.stringify({ action: "auth", key, secret })
      );
    });

    ws.on("message", (raw) => this.onMessage(raw.toString()));

    ws.on("close", () => {
      this.ws = null;
      this.authed = false;
      // reconnect while anyone still cares
      if (this.hub.clients.size) setTimeout(() => this.ensure(), 5000);
    });

    ws.on("error", (e) => {
      console.error(`[stream:${this.label}]`, e.message);
      try {
        ws.close();
      } catch {}
    });
  }

  private onMessage(text: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return; // binary/malformed frame — ignore
    }

    if (this.label === "trades") {
      const m = parsed as { stream?: string; data?: Record<string, unknown> };
      if (m.stream === "authorization" && (m.data as { status?: string })?.status === "authorized") {
        this.authed = true;
        this.ws?.send(
          JSON.stringify({ action: "listen", data: { streams: ["trade_updates"] } })
        );
      } else if (m.stream === "trade_updates" && m.data) {
        const d = m.data as {
          event?: string;
          order?: {
            symbol?: string;
            side?: string;
            status?: string;
            filled_qty?: string;
            filled_avg_price?: string;
          };
        };
        this.hub.broadcast(
          JSON.stringify({
            T: "trade_update",
            event: d.event,
            symbol: d.order?.symbol,
            side: d.order?.side,
            status: d.order?.status,
            qty: d.order?.filled_qty,
            price: d.order?.filled_avg_price,
          })
        );
        if (d.event === "fill" || d.event === "partial_fill") {
          import("./trade-log")
            .then((m) =>
              m.recordFill({
                symbol: d.order?.symbol,
                side: d.order?.side,
                qty: d.order?.filled_qty,
                price: d.order?.filled_avg_price,
                event: d.event,
              })
            )
            .catch((e) => console.error("[trade-log]", e instanceof Error ? e.message : e));
        }
      }
      return;
    }

    // data streams deliver arrays of {T, ...}
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of items as Array<Record<string, unknown>>) {
      if (item.T === "success" && item.msg === "authenticated") {
        this.authed = true;
        if (this.label === "news") {
          this.ws?.send(JSON.stringify({ action: "subscribe", news: ["*"] }));
        } else {
          this.resubscribe();
        }
      } else if (item.T === "n") {
        this.hub.handleNews(item as unknown as NewsItem);
      } else if (item.T === "t" || item.T === "b") {
        this.hub.broadcast(JSON.stringify(item));
        const sym = item.S as string;
        const price = (item.T === "t" ? item.p : item.c) as number;
        for (const a of checkAlerts(sym, price)) {
          console.log(`[alert] ${a.symbol} ${a.op} ${a.price} — hit ${price}`);
          this.hub.broadcast(
            JSON.stringify({
              T: "alert",
              id: a.id,
              symbol: a.symbol,
              op: a.op,
              price: a.price,
              hit: price,
            })
          );
          this.hub.queueAutoResearch(a, price);
        }
      } else if (item.T === "error") {
        console.error(`[stream:${this.label}]`, item.msg);
      }
    }
  }

  subscribe(symbols: string[]) {
    const fresh = symbols.filter((s) => !this.subs.has(s));
    fresh.forEach((s) => this.subs.add(s));
    this.ensure();
    if (fresh.length && this.authed && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({ action: "subscribe", trades: fresh, bars: fresh })
      );
    }
  }

  private resubscribe() {
    if (this.subs.size && this.ws?.readyState === WebSocket.OPEN) {
      const all = [...this.subs];
      this.ws.send(JSON.stringify({ action: "subscribe", trades: all, bars: all }));
    }
  }
}

class Hub {
  clients = new Set<Controller>();
  stocks = new Upstream(STOCK_URL, "stocks", this);
  crypto = new Upstream(CRYPTO_URL, "crypto", this);
  trades = new Upstream(TRADE_URL, "trades", this);
  news = new Upstream(NEWS_URL, "news", this);
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  /** Symbols the terminal cares about right now (watchlist + chart + alerts), slashless. */
  private relevantSymbols(): Set<string> {
    const all = [...this.stocks.subs, ...this.crypto.subs, ...alertSymbols()];
    return new Set(all.map((s) => s.replace("/", "").toUpperCase()));
  }

  handleNews(item: NewsItem) {
    if (!getSettings().watchdog.enabled) return;
    const relevant = this.relevantSymbols();
    const touches = (item.symbols ?? []).some((s) => relevant.has(s.toUpperCase()));
    if (!touches) return;
    queueNewsTriage(item, [...relevant], (news, triage) => {
      this.broadcast(
        JSON.stringify({
          T: "news",
          headline: news.headline,
          symbols: news.symbols?.slice(0, 4),
          source: news.source,
          ...triage,
        })
      );
    });
  }

  private researching = new Set<string>();

  /**
   * A triggered alert kicks off background research on its symbol; the note
   * lands in the journal and clients get a research_note event. One at a
   * time per symbol — simultaneous alerts on the same name share a note.
   */
  queueAutoResearch(alert: Alert, hit: number) {
    if (this.researching.has(alert.symbol)) return;
    this.researching.add(alert.symbol);
    autoResearch(alert, hit)
      .then((note) =>
        this.broadcast(
          JSON.stringify({ T: "research_note", symbol: alert.symbol, id: note.id, title: note.title })
        )
      )
      .catch((e) => console.error("[auto-research]", e instanceof Error ? e.message : e))
      .finally(() => this.researching.delete(alert.symbol));
  }

  /** Subscribe upstream feeds to symbols, routed by asset class. */
  watch(symbols: string[]) {
    const stockSyms = symbols.filter((s) => !isCryptoSymbol(s));
    const cryptoSyms = symbols.filter(isCryptoSymbol);
    if (stockSyms.length) this.stocks.subscribe(stockSyms);
    if (cryptoSyms.length) this.crypto.subscribe(cryptoSyms);
  }

  addClient(controller: Controller, symbols: string[]) {
    this.clients.add(controller);
    this.sendTo(controller, `data: {"T":"hello"}\n\n`);

    // client's symbols + anything with a live alert on it
    this.watch([...symbols, ...alertSymbols()]);
    this.trades.ensure();
    if (getSettings().watchdog.enabled) this.news.ensure();

    if (!this.heartbeat) {
      this.heartbeat = setInterval(() => {
        for (const c of [...this.clients]) this.sendTo(c, `: hb\n\n`);
      }, 15_000);
    }
  }

  removeClient(controller: Controller) {
    this.clients.delete(controller);
    try {
      controller.close();
    } catch {}
    if (!this.clients.size && this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  broadcast(json: string) {
    for (const c of [...this.clients]) this.sendTo(c, `data: ${json}\n\n`);
  }

  private sendTo(c: Controller, chunk: string) {
    try {
      c.enqueue(enc.encode(chunk));
    } catch {
      this.clients.delete(c); // client went away mid-write
    }
  }
}

const g = globalThis as { __vtHub?: Hub };

export function getHub(): Hub {
  if (!g.__vtHub) g.__vtHub = new Hub();
  return g.__vtHub;
}
