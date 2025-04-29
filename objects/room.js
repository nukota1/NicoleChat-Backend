export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    // 直近1週間分の履歴をメモリ上に保持
    this.history = [];
  }

  // Durable Objectの初期化時にストレージから履歴を復元
  async initialize() {
    const stored = await this.state.storage.get('history');
    if (stored) this.history = stored;
  }

  // POST: メッセージ追加
  async addMessage(message) {
    console.log("[addMessage] called", message);
    // 1週間より古いメッセージを削除
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    this.history = this.history.filter(m => m.timestamp > oneWeekAgo);
    this.history.push(message);
    await this.state.storage.put('history', this.history);
    console.log("[addMessage] history saved to Durable Object storage");
    // D1に保存
    if (this.env.ROOM_DB) {
      try {
        console.log("[addMessage] saving to D1...");
        await this.env.ROOM_DB.prepare(
          "INSERT INTO chat_memory (original, written_by, written_at, room_id) VALUES (?, ?, ?, ?)"
        ).bind(
          message.text,
          message.user,
          new Date(message.timestamp).toISOString().replace('T', ' ').replace('Z', ''),
          this.state.id.toString()
        ).run();
        console.log("[addMessage] saved to D1 successfully");
      } catch (e) {
        console.error("[addMessage] failed to save to D1", e);
      }
    } else {
      console.warn("[addMessage] ROOM_DB binding is missing");
    }
  }

  // GET: 履歴取得
  getHistory() {
    // 1週間より古いメッセージは返さない
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return this.history.filter(m => m.timestamp > oneWeekAgo);
  }

  // Durable Objectのリクエストハンドラ
  async fetch(request) {
    if (!this.initialized) {
      await this.initialize();
      this.initialized = true;
    }
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/api/room/message') {
      const { user, text } = await request.json();
      const message = {
        user,
        text,
        timestamp: Date.now()
      };
      await this.addMessage(message);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/room/history') {
      return new Response(JSON.stringify(this.getHistory()), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response('Not found', { status: 404 });
  }
}
