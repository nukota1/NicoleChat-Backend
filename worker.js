// Durable Object: チャットルームごとの会話履歴管理
import { d1_manager } from './objects/d1_manager.js';
export class ChatRoomDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.memoryHistory = [];
    this.initialized = false;
  }

  // 1週間より古い履歴を削除
  pruneOldHistory() {
    const oneWeekAgo = (Date.now()+ 9 * 60 * 60 * 1000) - 7 * 24 * 60 * 60 * 1000;
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

    // CORSプリフライトリクエスト対応
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    await this.initialize();
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/history") {
      console.log('[POST]', url.pathname);

      const data = await request.json();
      const roomId = url.searchParams.get("roomId") || "default";
      await this.saveMessage(data, roomId, this.env);
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

    // Durable Object: 履歴の保存・取得
    console.log('[Durable Object]', "取得doUrl");

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
      corsHeaders['Content-Type'] = 'application/json'
      for (const [k, v] of Object.entries(corsHeaders)) newResp.headers.set(k, v);
      return newResp;
    }

    // submitしたときに通る
    if (request.method === 'POST' && new URL(request.url).pathname === '/api/message') {

      try {
        const { text } = await request.json();
        console.log('受信メッセージ:', text);

        // OpenRouter API へ問い合わせ
        const openrouterRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + this.env.OPENROUTER_API_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'deepseek/deepseek-chat-v3-0324:free',
            messages: [
              {
                role: 'system',
                content: 'あなたはBUMP OF CHICKENという日本のロックバンドのマスコットキャラクター「ニコル（Nicole）」です。親しみやすく、明るく、バンドや音楽の話題が得意です。'
              },
              {
                role: 'user',
                content: text
              }
            ]
          })
        });
        if (!openrouterRes.ok) {
          throw new Error('OpenRouter API error');
        }
        const openrouterData = await openrouterRes.json();
        const reply = openrouterData.choices?.[0]?.message?.content || '（AI返答取得失敗）';
            
        // AI返答もDurable ObjectとD1に保存する
        try {
          const aiUser = 'ニコル'; // AIのユーザー名
          const timestamp = Date.now();
          const roomId = url.searchParams.get("roomId") || "default";

          // Durable Objectのインスタンス取得
          const id = this.env.ROOM_DO.idFromName(roomId);
          const obj = this.env.ROOM_DO.get(id);

          request.text = reply;
          request.user = aiUser;

          console.log("request.text",request.text);
          console.log("request.user",request.user);
         

          await this.saveMessage(request, roomId,this.env);
          
        } catch (e) {
          console.error('AI返答の保存に失敗', e);
        }

        return new Response(JSON.stringify({ reply }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (e) {
        console.error('AI問い合わせ失敗', e);
        return new Response(JSON.stringify({ error: 'AI問い合わせ失敗' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }


    return new Response("Not found", { status: 404 });
  }

  // ユーザー・AI共通の保存ロジック
  async saveMessage(data, roomId, env) {
    console.log("[DO saveMessage] 受信データ:", data);
    this.memoryHistory.push(data);
    this.pruneOldHistory();
    console.log("[DO saveMessage] 保存直前の履歴:", this.memoryHistory);
    await this.state.storage.put("history", this.memoryHistory);

    const timestamp = Date.now();
    console.log("[D1Object] D1書き込み開始", { text: data.text, user: data.user, roomId });

    const db = env.ROOM_DB; // Cloudflare Workers 環境なら env に DB バインディングがある前提
    const d1 = new d1_manager(db);
    // 例：saveMessage の呼び出し
    await d1.saveMessage({
      text: data.text,
      user: data.user,
      roomId: roomId,
      timestamp: new Date(timestamp).toISOString().replace('T', ' ').replace('Z', '')
    });
    console.log("[D1Object] D1書き込み成功");

  }

}



// CORSヘッダ定義
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // ルーティング: /api/room/history
    if (url.pathname === '/api/room/history') {

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
      for (const [k, v] of Object.entries(corsHeaders)) newResp.headers.set(k, v);

      return newResp;
    }

    // ルーティング: /api/message
    if (url.pathname === '/api/message') {
      try{
        const roomId = url.searchParams.get("roomId") || "default";
        const id = env.ROOM_DO.idFromName(roomId);
        const obj = env.ROOM_DO.get(id);
        const doUrl = new URL(request.url);
        doUrl.pathname = '/api/message';
        const doRequest = new Request(doUrl, request);
        const resp = await obj.fetch(doRequest);
        const newResp = new Response(await resp.text(), resp);
        for (const [k, v] of Object.entries(corsHeaders)) newResp.headers.set(k, v);

        return newResp;
      } catch (e) {
        console.error("エラー", e);
      }

    }
    // その他のルートは404
    return new Response("Not found", { status: 404, headers: corsHeaders });
  }
};

