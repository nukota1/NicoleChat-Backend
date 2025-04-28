// Durable Object: チャットルームごとの会話履歴管理
export class ChatRoomDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.memoryHistory = [];
    this.initialized = false;
  }

  // 1週間より古い履歴を削除
  pruneOldHistory() {
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    this.memoryHistory = this.memoryHistory.filter(msg => msg.timestamp >= oneWeekAgo);
  }

  async initialize() {
    if (this.initialized) return;
    const stored = await this.state.storage.get("history");
    console.log("[DO initialize] ストレージから復元:", stored);
    this.memoryHistory = stored || [];
    this.pruneOldHistory();
    console.log("[DO initialize] prune後:", this.memoryHistory);
    this.initialized = true;
  }

  async fetch(request) {
    await this.initialize();
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/history") {
      // 新しいメッセージを追加
      const data = await request.json();
      console.log("[DO POST] 受信データ:", data);
      this.memoryHistory.push(data);
      this.pruneOldHistory();
      console.log("[DO POST] 保存直前の履歴:", this.memoryHistory);
      await this.state.storage.put("history", this.memoryHistory);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (request.method === "GET" && url.pathname === "/history") {
      // 履歴を返す
      this.pruneOldHistory();
      console.log("[DO GET] 返却履歴:", this.memoryHistory);
      return new Response(JSON.stringify(this.memoryHistory), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("Not found", { status: 404 });
  }
}// Durable Objectバインディング用エクスポート



// import { Room } from './objects/room.js';

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // CORSプリフライト対応
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    const url = new URL(request.url);

    // Durable Object: 履歴の保存・取得
    if (url.pathname === '/api/room/history') {
      // 部屋IDはクエリやヘッダで指定する設計も可能。ここでは仮で "default" 固定。
      // クエリパラメータからroomIdを取得（なければ"default"）
      const roomId = url.searchParams.get("roomId") || "default";
      const id = env.ROOM_DO.idFromName(roomId);
      const obj = env.ROOM_DO.get(id);
      // Durable Objectのfetchへリクエストを転送
      const doUrl = new URL(request.url);
      doUrl.pathname = '/history';
      const doRequest = new Request(doUrl, request);
      const resp = await obj.fetch(doRequest);
      // CORSヘッダ付与
      const newResp = new Response(await resp.text(), resp);
      corsHeaders['Content-Type'] = 'application/json';
      for (const [k, v] of Object.entries(corsHeaders)) newResp.headers.set(k, v);
      return newResp;
    }
    if (request.method === 'POST' && new URL(request.url).pathname === '/api/message') {
      try {
        const { text } = await request.json();
        console.log('受信メッセージ:', text);
        const reply = `「${text}」を受け取りました。`;
        return new Response(JSON.stringify({ reply }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Invalid request' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }
    return new Response('Not found', { status: 404, headers: corsHeaders });
  }
};